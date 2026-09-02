import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  session,
  /* O `net` do Electron (pilha do Chromium, respeita proxy do sistema) e o
     `net` do Node (sockets, usado para achar porta livre) são coisas
     diferentes com o mesmo nome. O alias evita a colisão e diz qual é qual. */
  net as redeChromium,
} from "electron";
import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";

import { criarLeitorDeSaida } from "./saidaBackend";
import * as cofre from "./cofre";
import * as sessao from "./sessao";
import * as segredos from "./segredos";
import * as conversa from "./conversa";
import * as openrouter from "./openrouter";
import { MODELOS, atualizarProvedoresZdr } from "./catalogo";
import type { Ocorrencia } from "./pseudonimos";

const execFileP = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
/** Credencial desta execução, lida da saída do backend. Nunca vai para disco. */
let tokenSessao = "";
const PYTHON_PORT = 8123;
/**
 * Onde o Vite serve a interface em desenvolvimento.
 *
 * Vive numa constante porque este valor é usado em dois lugares que precisam
 * concordar: a janela carrega esta URL e o backend recebe a mesma string como
 * origem permitida no CORS. Se os dois divergirem — `localhost` de um lado,
 * `127.0.0.1` do outro, ou uma porta diferente — o navegador reprova o
 * preflight e o app trava carregando, com o backend no ar e sem erro visível.
 */
const URL_DEV = "http://localhost:5173";

function getResourcePath(...segments: string[]): string {
  const isProd = app.isPackaged;
  if (isProd) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, "..", ...segments);
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      server.close(() => resolve(startPort));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

async function startPythonBackend(port: number): Promise<void> {
  const isDev = !app.isPackaged;

  let pythonPath: string;
  let serverPath: string;

  if (isDev) {
    // Em dev, usa o Python do venv local. O venv não tem o mesmo layout nas
    // duas plataformas: `Scripts/python.exe` no Windows, `bin/python` no
    // resto. Procurar só por `bin/python` fazia o caminho nunca existir
    // justamente no Windows, que é onde se desenvolve — e a execução caía no
    // fallback sem que nada avisasse.
    const raizVenv = path.join(__dirname, "..", ".venv");
    const candidatos = [
      path.join(raizVenv, "Scripts", "python.exe"),
      path.join(raizVenv, "bin", "python"),
    ];
    // O fallback no Windows é `python`, não `python3`: o `python3.exe` que
    // aparece no PATH costuma ser o atalho da Microsoft Store, que abre a loja
    // em vez de executar. Sem venv o backend falha de qualquer jeito, mas
    // falha com erro de importação em vez de silêncio.
    const fallback = process.platform === "win32" ? "python" : "python3";
    pythonPath = candidatos.find((caminho) => fs.existsSync(caminho)) ?? fallback;
    serverPath = path.join(__dirname, "..", "python-backend", "server.py");
  } else {
    // Em produção, usa o Python embutido (dentro de python-embed/)
    pythonPath = getResourcePath(
      "python-backend",
      "python-embed",
      "python.exe"
    );
    serverPath = getResourcePath("python-backend", "server.py");
  }

  console.log(`Iniciando Python: ${pythonPath} ${serverPath} --port ${port}`);

  // Em dev a interface é servida pelo Vite, numa origem diferente da do
  // backend, e o navegador exige CORS para deixar o renderer ler a resposta.
  // Quem declara a origem é aqui, não o backend: empacotado, a variável não é
  // passada, o backend não monta CORS nenhum e nada muda em produção.
  //
  // Sem isto o app ficava preso em "Carregando motor de anonimização" com o
  // backend perfeitamente no ar — o detalhe está comentado no `server.py`.
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (isDev) env.PRESIDIO_DEV_ORIGIN = URL_DEV;

  // Onde o backend guarda o registro de clientes pareados. Sem esta variável
  // ele grava ao lado do próprio módulo, o que serve a um processo efêmero
  // (CLI offline, teste) mas não ao aplicativo: um cliente pareado precisa
  // continuar pareado depois de fechar e abrir.
  env.PRESIDIO_DADOS = app.getPath("userData");

  pythonProcess = spawn(pythonPath, [serverPath, "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // O backend anuncia o segredo desta sessão numa linha da saída padrão. Ele
  // existe porque `/processar` abre arquivos do disco: sem credencial, qualquer
  // página aberta no navegador poderia pedir a leitura de um documento à porta
  // local. O token fica só em memória, dos dois lados.
  const leitor = criarLeitorDeSaida({
    aoReceberToken: (token) => {
      tokenSessao = token;
      console.log("[Python] token da sessão recebido");
    },
    aoRegistrar: (linha) => console.log(`[Python] ${linha}`),
  });

  pythonProcess.stdout?.on("data", (data: Buffer) => leitor.consumir(data.toString()));

  pythonProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[Python ERR] ${data.toString().trim()}`);
  });

  pythonProcess.on("exit", (code) => {
    console.log(`Python process exited with code ${code}`);
    pythonProcess = null;
  });
}

function stopPythonBackend(): void {
  if (pythonProcess) {
    console.log("Parando servidor Python...");
    pythonProcess.kill("SIGTERM");
    setTimeout(() => {
      if (pythonProcess) {
        pythonProcess.kill("SIGKILL");
        pythonProcess = null;
      }
    }, 5000);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    /* Barra de título do próprio aplicativo, com os controles da janela
       sobrepostos ao canto: é o que todo aplicativo de mesa atual faz, e o
       que separa "programa" de "página dentro de uma moldura". A cor
       acompanha o tema — o renderer avisa por `barra-de-titulo` a cada troca,
       e a inicial segue o sistema, como o `backgroundColor` abaixo. */
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: nativeTheme.shouldUseDarkColors ? "#0e1013" : "#e8e6df",
      symbolColor: nativeTheme.shouldUseDarkColors ? "#eceae4" : "#16181d",
      height: 40,
    },
    /* O menu nativo (File, Edit, View…) fica escondido. Ele continua
       acessível pelo Alt, para os atalhos de zoom e de DevTools em
       desenvolvimento, mas não ocupa uma faixa da janela em produção. */
    autoHideMenuBar: true,
    /* Cor pintada antes de o CSS carregar. Ficou para trás na troca de paleta
       (era o grafite `#0c0f1a`), e o efeito é um flash escuro na abertura de
       quem usa o tema papel. Segue `nativeTheme` porque a preferência padrão é
       "seguir o sistema": `--papel` no claro, `--papel` do tema noite no
       escuro. Quem fixou um tema vê o flash certo assim que o CSS entra. */
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#14161a" : "#f2f1ec",
  });

  const isDev = !app.isPackaged;

  trancarRenderer(isDev);

  if (isDev) {
    mainWindow.loadURL(URL_DEV);
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  /* Uma janela nova é uma saída para a internet que a CSP não cobre. Nada neste
     aplicativo precisa abrir janela, então o pedido é negado sem exceção. */
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  /* Navegar para fora troca o documento inteiro por uma página remota, e aí a
     política que vale passa a ser a dela. Só a origem que carregamos vale. */
  mainWindow.webContents.on("will-navigate", (evento, destino) => {
    const permitida = isDev ? URL_DEV : "file://";
    if (!destino.startsWith(permitida)) evento.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * A jaula do renderer.
 *
 * Até a v1.3.0 este aplicativo não falava com a internet, e a ausência de
 * política de segurança de conteúdo não custava nada. A conversa muda isso: a
 * partir de agora existe uma saída, e ela precisa ser **uma só** — o processo
 * principal, onde a verificação do que sai está implementada.
 *
 * `connect-src` restrito ao backend local é o que garante isso. Não é
 * desconfiança do código do renderer; é tirar da mesa a possibilidade de um
 * defeito futuro ali virar vazamento. Vale igual em desenvolvimento e em
 * produção — só `script-src` e `style-src` afrouxam em dev, por causa do
 * preâmbulo que o plugin do React injeta e do CSS que o Tailwind monta em
 * tempo de execução.
 *
 * **Isto é o teto, não o chão.** `onHeadersReceived` não é acionado de forma
 * confiável para respostas `file://`, que é exatamente como a janela carrega no
 * aplicativo empacotado. Sem a `<meta http-equiv="Content-Security-Policy">` do
 * `index.html`, a política existiria em desenvolvimento e sumiria justamente na
 * versão instalada — que é a que importa.
 */
function trancarRenderer(isDev: boolean): void {
  const local = "http://127.0.0.1:* http://localhost:*";
  const vite = isDev ? " ws://localhost:5173 http://localhost:5173" : "";
  const scripts = isDev ? "'self' 'unsafe-inline'" : "'self'";

  const politica = [
    "default-src 'self'",
    `script-src ${scripts}`,
    /* Atributo `style=` é bloqueado sem isto, e a tarja de redação depende
       dele para receber a cor do tipo de entidade em tempo de execução. */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${local}${vite}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((detalhes, responder) => {
    responder({
      responseHeaders: {
        ...detalhes.responseHeaders,
        "Content-Security-Policy": [politica],
      },
    });
  });
}

// IPC Handlers
ipcMain.handle("read-file", async (_event, filePath: string) => {
  // Tenta UTF-8 estrito; se o arquivo contiver bytes inválidos, cai para cp1252
  const buffer = fs.readFileSync(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return buffer.toString("latin1");
  }
});

ipcMain.handle(
  "save-file",
  async (_event, filePath: string, content: string) => {
    // Gravar por cima de um resultado anterior sem avisar destrói trabalho já
    // conferido — reprocessar o mesmo documento com outra configuração é
    // rotina, e o nome de saída é sempre o mesmo.
    if (fs.existsSync(filePath) && mainWindow) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Substituir", "Cancelar"],
        defaultId: 1,
        cancelId: 1,
        title: "Arquivo já existe",
        message: `Já existe um arquivo chamado ${path.basename(filePath)} nessa pasta.`,
        detail: "Substituir apaga o conteúdo anterior.",
      });
      if (response !== 0) {
        return { salvo: false, motivo: "cancelado" };
      }
    }
    fs.writeFileSync(filePath, content, "utf-8");
    return { salvo: true };
  }
);

// DOCX é um zip: não sobrevive a uma viagem como string UTF-8 pelo IPC. Vem em
// base64 e é decodificado aqui, na única camada que fala com o disco.
ipcMain.handle(
  "save-file-binary",
  async (_event, filePath: string, base64: string) => {
    if (fs.existsSync(filePath) && mainWindow) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Substituir", "Cancelar"],
        defaultId: 1,
        cancelId: 1,
        title: "Arquivo já existe",
        message: `Já existe um arquivo chamado ${path.basename(filePath)} nessa pasta.`,
        detail: "Substituir apaga o conteúdo anterior.",
      });
      if (response !== 0) {
        return { salvo: false, motivo: "cancelado" };
      }
    }
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    return { salvo: true };
  }
);

// ---------- CLI installer (Windows PATH + WSL shim) ----------

function backendResourcePath(): string {
  // Em prod: <install>\resources\python-backend. Em dev: ./resources/python-backend
  return app.isPackaged
    ? path.join(process.resourcesPath, "python-backend")
    : path.join(__dirname, "..", "resources", "python-backend");
}

/*
 * O PATH do usuário, lido e gravado **cru**.
 *
 * ## Duas armadilhas, e as duas estavam aqui
 *
 * **1. `-Args` não existe em `-Command`.** A gravação era
 * `powershell -Command "…$args[0]…" -Args valor`, e o PowerShell não trata o
 * que vem depois de `-Command` como argumento: ele **concatena no texto do
 * script**. O comando executado virava `… -Args C:\…`, que é erro de sintaxe.
 * O botão "Ativar linha de comando" nunca funcionou — falhava com um erro de
 * parse que ninguém via. (`$args` só é populado com `-File`.)
 *
 * Aqui o valor vai por **variável de ambiente do processo filho**: não passa
 * pela linha de comando, então não há aspa, espaço, acento ou `;` que possa
 * quebrar a análise.
 *
 * **2. `[Environment]::GetEnvironmentVariable('PATH','User')` expande.** Um
 * PATH guardado como `REG_EXPAND_SZ` com `%USERPROFILE%in` dentro volta já
 * resolvido; gravar isso de volta **congela a expansão para sempre**, e o PATH
 * do usuário deixa de acompanhar o perfil. O conserto de uma coisa estragaria
 * outra, em silêncio. Por isso a leitura usa `DoNotExpandEnvironmentNames` e a
 * gravação preserva o tipo original do valor.
 *
 * Como isto mexe no registro direto, e não pela API do .NET, o
 * `WM_SETTINGCHANGE` precisa ser disparado à mão — sem ele, nenhum programa já
 * aberto (o Explorer inclusive) enxerga o PATH novo. É o mesmo aviso que o
 * `build/installer.nsh` dispara depois de instalar.
 */
const PS_LER_PATH = `
$chave = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if ($null -eq $chave) { '' ; exit 0 }
$valor = $chave.GetValue(
  'Path', '',
  [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
)
$tipo = try { $chave.GetValueKind('Path').ToString() } catch { 'ExpandString' }
[Console]::Out.Write($tipo + "\`n" + $valor)
`;

const PS_GRAVAR_PATH = `
$novo = $env:SIGILO_PATH_NOVO
$tipo = if ($env:SIGILO_PATH_TIPO -eq 'String') {
  [Microsoft.Win32.RegistryValueKind]::String
} else {
  [Microsoft.Win32.RegistryValueKind]::ExpandString
}
$chave = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$chave.SetValue('Path', $novo, $tipo)
$chave.Close()

# Sem este aviso, nada que já esteja aberto enxerga o PATH novo.
Add-Type -Namespace Win32 -Name Aviso -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
$res = [UIntPtr]::Zero
# HWND_BROADCAST = 0xffff, WM_SETTINGCHANGE = 0x1A, SMTO_ABORTIFHUNG = 0x2
[void][Win32.Aviso]::SendMessageTimeout(
  [IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$res
)
`;

interface PathDoUsuario {
  valor: string;
  /** `String` ou `ExpandString` — preservado na gravação. */
  tipo: string;
}

async function getUserPath(): Promise<PathDoUsuario> {
  if (process.platform !== "win32") return { valor: "", tipo: "ExpandString" };
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", PS_LER_PATH,
  ]);
  const [tipo, ...resto] = (stdout || "").split("\n");
  return { valor: resto.join("\n"), tipo: (tipo || "ExpandString").trim() };
}

async function setUserPath(novoValor: string, tipo: string): Promise<void> {
  await execFileP(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", PS_GRAVAR_PATH],
    { env: { ...process.env, SIGILO_PATH_NOVO: novoValor, SIGILO_PATH_TIPO: tipo } }
  );
}

/** As entradas do PATH, sem as vazias. */
function entradasDoPath(bruto: string): string[] {
  return bruto.split(";").filter(Boolean);
}

/**
 * Duas entradas de PATH apontam para a mesma pasta?
 *
 * Tira aspas (o Windows aceita entrada citada), normaliza separadores e ignora
 * barra final e caixa. Comparar as strings cruas faria a checagem de "já está
 * instalado" errar com `...{BS}python-backend{BS}` e acrescentar a pasta duas vezes.
 */
function mesmaPasta(a: string, b: string): boolean {
  const limpar = (valor: string) =>
    path.normalize(valor.trim().replace(/^"|"$/g, "")).replace(/[\\/]+$/, "").toLowerCase();
  return limpar(a) === limpar(b);
}

async function wslAvailable(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileP("wsl.exe", ["--status"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function wslPath(winPath: string): Promise<string> {
  // wslpath -u "C:\..." => /mnt/c/...
  const { stdout } = await execFileP("wsl.exe", [
    "wslpath", "-u", winPath,
  ]);
  return stdout.trim();
}

async function wslHomeBin(): Promise<string> {
  const { stdout } = await execFileP("wsl.exe", [
    "bash", "-c", "echo $HOME/.local/bin",
  ]);
  return stdout.trim();
}

function bashShimContent(wslRoot: string): string {
  // Script bash que chama o python.exe Windows via interop WSL.
  return [
    "#!/usr/bin/env bash",
    "# Gerado pelo TecJustiça Sigilo — nao edite manualmente",
    `PRESIDIO_ROOT='${wslRoot}'`,
    "exec \"${PRESIDIO_ROOT}/python-embed/python.exe\" \"${PRESIDIO_ROOT}/cli.py\" \"$@\"",
    "",
  ].join("\n");
}

ipcMain.handle("cli-status", async () => {
  const backendDir = backendResourcePath();
  const status = {
    backendDir,
    windows: { installed: false, onPath: false },
    wsl: { available: false, installed: false, shimPath: "" },
  };

  if (process.platform === "win32") {
    const userPath = await getUserPath().catch(() => ({ valor: "", tipo: "ExpandString" }));
    status.windows.onPath = entradasDoPath(userPath.valor).some((entrada) =>
      mesmaPasta(entrada, backendDir)
    );
    status.windows.installed = status.windows.onPath;

    if (await wslAvailable()) {
      status.wsl.available = true;
      try {
        const home = await wslHomeBin();
        status.wsl.shimPath = `${home}/tecjustica-sigilo`;
        const { stdout } = await execFileP("wsl.exe", [
          "bash", "-c", `test -x '${status.wsl.shimPath}' && echo ok || echo no`,
        ]);
        status.wsl.installed = stdout.trim() === "ok";
      } catch {
        // WSL presente mas sem user home acessível — ignora
      }
    }
  }

  return status;
});

ipcMain.handle("cli-install-windows", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "Disponível apenas no Windows." };
  }
  const dir = backendResourcePath();
  const atual = await getUserPath();
  const partes = entradasDoPath(atual.valor);
  if (partes.some((entrada) => mesmaPasta(entrada, dir))) {
    return { ok: true, alreadyInstalled: true };
  }

  await setUserPath([...partes, dir].join(";"), atual.tipo);
  return { ok: true, note: "PATH atualizado. Reabra o terminal para aplicar." };
});

ipcMain.handle("cli-uninstall-windows", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "Disponível apenas no Windows." };
  }
  const dir = backendResourcePath();
  const atual = await getUserPath();
  const restantes = entradasDoPath(atual.valor).filter(
    (entrada) => !mesmaPasta(entrada, dir)
  );
  await setUserPath(restantes.join(";"), atual.tipo);
  return { ok: true };
});

ipcMain.handle("cli-install-wsl", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "Disponível apenas quando o app roda no Windows." };
  }
  if (!(await wslAvailable())) {
    return { ok: false, error: "WSL não detectado." };
  }
  const backendWin = backendResourcePath();
  const backendWsl = await wslPath(backendWin);
  const shimContent = bashShimContent(backendWsl);

  const homeBin = await wslHomeBin();
  const shim = `${homeBin}/tecjustica-sigilo`;

  // Usa base64 para escapar qualquer caractere problemático no shell
  const b64 = Buffer.from(shimContent, "utf-8").toString("base64");
  const cmd = [
    `mkdir -p '${homeBin}'`,
    `echo '${b64}' | base64 -d > '${shim}'`,
    `chmod +x '${shim}'`,
  ].join(" && ");
  await execFileP("wsl.exe", ["bash", "-c", cmd]);

  const pathCheck = await execFileP("wsl.exe", [
    "bash", "-c", `echo "$PATH" | tr ':' '\\n' | grep -Fx '${homeBin}' || true`,
  ]);
  const onPath = Boolean(pathCheck.stdout.trim());

  return {
    ok: true,
    shimPath: shim,
    onPath,
    note: onPath
      ? "Use 'tecjustica-sigilo' em qualquer terminal WSL."
      : `Adicione '${homeBin}' ao PATH do seu shell (ex.: em ~/.bashrc).`,
  };
});

ipcMain.handle("cli-uninstall-wsl", async () => {
  if (process.platform !== "win32" || !(await wslAvailable())) {
    return { ok: false, error: "WSL indisponível." };
  }
  const homeBin = await wslHomeBin();
  await execFileP("wsl.exe", ["bash", "-c", `rm -f '${homeBin}/tecjustica-sigilo'`]);
  return { ok: true };
});

// Silencia lint de imports opcionais não usados se os helpers forem podados
void os;

// ---------- fim CLI installer ----------

ipcMain.handle("select-files", async () => {
  if (!mainWindow) return [];

  /* O filtro oferecia só `txt/md/rtf`, embora o backend leia PDF, DOCX, XLSX,
     PPTX e imagens digitalizadas — o caso normal em autos de processo. Quem
     abria por este diálogo simplesmente não enxergava os próprios PDFs na
     pasta, e o único caminho que funcionava para eles era arrastar e soltar.
     O primeiro filtro é o que o diálogo mostra pré-selecionado. */
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Documentos aceitos",
        extensions: [
          "pdf", "docx", "xlsx", "pptx",
          "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp",
          "txt", "md", "rtf",
        ],
      },
      { name: "PDF", extensions: ["pdf"] },
      { name: "Office", extensions: ["docx", "xlsx", "pptx"] },
      {
        name: "Imagem digitalizada",
        extensions: ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"],
      },
      { name: "Texto", extensions: ["txt", "md", "rtf"] },
      { name: "Todos os arquivos", extensions: ["*"] },
    ],
  });

  if (result.canceled) return [];

  return result.filePaths.slice(0, 10).map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
  }));
});

/**
 * Escolhe a pasta de destino da anonimização.
 *
 * `createDirectory` deixa criar uma pasta ali mesmo no macOS; no Windows o
 * diálogo já traz esse botão. Devolve `null` no cancelamento, que o chamador
 * interpreta como "manter o que estava" — e não como "voltar para o padrão".
 */
ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Onde salvar os arquivos anonimizados",
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Porta efetiva do backend, resolvida no boot e consultada pelo renderer.
let backendPort = PYTHON_PORT;

/**
 * A barra de título nativa acompanha o tema da interface.
 *
 * O renderer decide o tema (papel, noite ou o do sistema) e manda as duas
 * cores que a moldura da janela precisa: fundo e símbolos. Só hexadecimal de
 * seis dígitos passa — é o que o Electron aceita, e uma string arbitrária vinda
 * do renderer não é lugar para começar a confiar.
 */
ipcMain.handle(
  "barra-de-titulo",
  (_evento, cores: { fundo?: unknown; simbolo?: unknown }) => {
    const hex = /^#[0-9a-f]{6}$/i;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (typeof cores?.fundo !== "string" || typeof cores?.simbolo !== "string") return;
    if (!hex.test(cores.fundo) || !hex.test(cores.simbolo)) return;
    mainWindow.setTitleBarOverlay({
      color: cores.fundo,
      symbolColor: cores.simbolo,
      height: 40,
    });
  }
);
ipcMain.handle("get-backend-port", () => backendPort);
ipcMain.handle("get-backend-token", () => tokenSessao);

/* ==========================================================================
   Cofre
   ==========================================================================
   `safeStorage` só existe no processo principal, então é aqui que se grava. A
   chave nunca atravessa o IPC — o renderer manda o conteúdo e recebe o
   conteúdo, nunca a credencial que o protege.

   Os handlers deixam a exceção subir em vez de devolver um objeto de erro. Uma
   gravação que falhou **precisa** falhar do lado de lá: engolir o erro aqui
   faria a interface anunciar "documento guardado" sobre um cofre que recusou
   gravar, e a pessoa só descobriria ao tentar reabrir. */
ipcMain.handle("cofre-disponivel", () => cofre.disponivel());
ipcMain.handle("cofre-listar", () => cofre.listar());
ipcMain.handle(
  "cofre-gravar",
  (_e, entrada: Parameters<typeof cofre.gravar>[0], conteudo: cofre.ConteudoDoCofre) =>
    cofre.gravar(entrada, conteudo)
);
ipcMain.handle(
  "cofre-atualizar",
  (
    _e,
    id: string,
    entrada: Parameters<typeof cofre.atualizar>[1],
    conteudo: cofre.ConteudoDoCofre
  ) => cofre.atualizar(id, entrada, conteudo)
);
ipcMain.handle("cofre-ler", (_e, id: string) => cofre.ler(id));
ipcMain.handle("cofre-apagar", (_e, id: string) => cofre.apagar(id));
ipcMain.handle("cofre-esvaziar", () => cofre.esvaziar());
ipcMain.handle("cofre-expurgar", (_e, dias: number) => cofre.expurgar(dias));

/* ==========================================================================
   Chave da API e conversa
   ==========================================================================
   Duas regras estruturais, e as duas são visíveis na lista de handlers abaixo:

   1. **Nenhum canal devolve a chave.** `segredos.ler()` existe e é chamado
      daqui, ao montar a requisição — mas não está ligado a `handle` nenhum. O
      renderer só enxerga `resumo()`, que diz se há chave e mostra os últimos
      quatro caracteres.

   2. **Nenhum canal aceita texto para a conversa.** `chat-abrir` recebe ids do
      cofre. O caminho "mandar texto arbitrário para a nuvem" não existe, do
      mesmo jeito que `escopo_da_rota` no backend deixa rota não listada
      inacessível por omissão. */

ipcMain.handle("segredo-resumo", () => segredos.resumo());
ipcMain.handle("segredo-guardar", (_e, chave: string) => segredos.guardar(chave));
ipcMain.handle("segredo-apagar", () => segredos.apagar());

function exigirChave(): string {
  const chave = segredos.ler();
  if (chave === null) {
    throw new Error(
      "não há chave da API guardada. Cole a sua em Ajustes para conversar."
    );
  }
  return chave;
}

/**
 * Detecta dado pessoal na pergunta digitada, contra o backend local.
 *
 * Usa o `fetch` do Node de propósito, e não o `net.fetch` que fala com a
 * internet: este destino é `127.0.0.1`, e a pilha do Chromium poderia tentar
 * roteá-lo por um proxy corporativo configurado na máquina.
 *
 * Pede **todas** as entidades (`entities: []` faz o motor procurar tudo), e não
 * apenas as que o usuário marcou na receita. O filtro da receita é sobre o
 * documento que ele vai arquivar; o que sai da máquina é mascarado no máximo
 * que se sabe detectar.
 */
async function detectarNaPergunta(texto: string): Promise<Ocorrencia[]> {
  const resposta = await fetch(`http://127.0.0.1:${backendPort}/anonymize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Presidio-Token": tokenSessao,
    },
    body: JSON.stringify({
      text: texto,
      entities: [],
      language: "pt",
      politica_mascara: "placeholder",
    }),
  });

  if (!resposta.ok) {
    /* Detector mudo não é pergunta limpa: é pergunta não verificada. Deixar
       passar aqui seria calar o alarme exatamente na situação que ele existe
       para denunciar. */
    throw new Error(
      "não foi possível verificar a pergunta contra o motor de detecção " +
        `(HTTP ${resposta.status}); nada foi enviado`
    );
  }

  const corpo = (await resposta.json()) as { entities_found: Ocorrencia[] };
  return corpo.entities_found ?? [];
}

ipcMain.handle("chat-modelos", () => MODELOS);
ipcMain.handle("chat-abrir", (_e, ids: string[], modelo?: string) =>
  conversa.abrir(ids, modelo)
);
ipcMain.handle("chat-estado", (_e, id: string) => conversa.estado(id));
ipcMain.handle("chat-orcamento", (_e, id: string) => conversa.orcamento(id));
ipcMain.handle("chat-previsualizar", (_e, id: string) =>
  conversa.previsualizar(id)
);
ipcMain.handle("chat-cancelar", (_e, id: string) => conversa.cancelar(id));
ipcMain.handle("chat-fechar", (_e, id: string) => conversa.fechar(id));

/* Não devolve a resposta: dispara o envio e retorna. O renderer acompanha por
   `chat-estado`, que é o mesmo idioma que o progresso de processamento já usa
   (polling), e que aqui resolve um problema específico — um pseudônimo pode
   chegar partido entre dois pedaços do stream, e re-hidratar o acumulado, em
   vez do pedaço, faz o caso desaparecer. */
ipcMain.handle("chat-perguntar", async (_e, id: string, pergunta: string) => {
  const chave = exigirChave();
  /* Recusa chega ao renderer por aqui, aguardada. O envio em si roda solto —
     a resposta chega em pedaços e o renderer a acompanha por `chat-estado`. */
  conversa.exigirPodeEnviar(id);
  void conversa
    .perguntar(id, pergunta, detectarNaPergunta, chave)
    .catch((erro: unknown) => console.error("[chat] falha no envio:", erro));
});

ipcMain.handle("chat-sondar", async (_e, modelo: string) =>
  openrouter.sondar(exigirChave(), modelo)
);

// App lifecycle
app.whenReady().then(async () => {
  backendPort = await findAvailablePort(PYTHON_PORT);
  await startPythonBackend(backendPort);

  // Descoberta para programas locais: a porta é dinâmica e sem isto ninguém
  // de fora tem como achar o motor. Sem token dentro — ver `sessao.ts`.
  sessao.escrever(backendPort);

  /* Atualiza a lista de provedores sem retenção a partir da fonte oficial. A
     lista embutida é só reserva: cravada, ela envelhece e passa a acusar
     provedor legítimo — e alarme falso é desligado na primeira semana, o que
     destrói a defesa de verdade. Falha em silêncio; sem rede, a reserva vale. */
  void atualizarProvedoresZdr((url) => redeChromium.fetch(url));

  /* O expurgo do cofre roda no **renderer**, não aqui.
     Havia um `cofre.expurgar(30)` neste ponto, com o prazo padrão cravado. Só
     que o prazo é escolha do usuário e vive nas preferências, que o processo
     principal não lê: quem tivesse configurado 90 dias teria documentos
     apagados 60 dias antes da hora, sem aviso e sem desfazer. Um expurgo que
     não conhece o prazo configurado é pior do que nenhum.
     Quem chama é o `useBiblioteca`, que tem o valor certo em mãos. */

  /* A fila de remoções pendentes, essa sim, roda aqui — e a diferença em
     relação ao expurgo é exatamente o que motivou tirá-lo daqui. Expurgo
     depende do prazo escolhido pelo usuário; terminar uma remoção que ele já
     mandou fazer não depende de preferência nenhuma.
     O motivo é privacidade, não disco: um conteúdo que o usuário mandou apagar
     e não saiu (antivírus segurando o arquivo, tipicamente) é texto de processo
     com dado pessoal seguindo no perfil. */
  try {
    const removidos = cofre.limparPendentes();
    if (removidos > 0) {
      console.log(`[cofre] ${removidos} arquivo(s) pendente(s) removido(s).`);
    }
  } catch (erro) {
    // Nunca impede o aplicativo de abrir: é faxina, não pré-requisito.
    console.error("[cofre] limpeza de pendentes falhou:", erro);
  }

  createWindow();
});

app.on("window-all-closed", () => {
  stopPythonBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopPythonBackend();
  // Um `sessao.json` órfão aponta para uma porta que não responde mais — ou,
  // pior, para uma porta que outro programa pegou nesse meio-tempo.
  sessao.apagar();
});
