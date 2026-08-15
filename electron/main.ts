import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { spawn, ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";

import { criarLeitorDeSaida } from "./saidaBackend";

const execFileP = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
/** Credencial desta execução, lida da saída do backend. Nunca vai para disco. */
let tokenSessao = "";
const PYTHON_PORT = 8123;

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
    // Em dev, usa o Python do venv local
    pythonPath = path.join(__dirname, "..", ".venv", "bin", "python");
    if (!fs.existsSync(pythonPath)) {
      pythonPath = "python3"; // fallback para python do sistema
    }
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

  pythonProcess = spawn(pythonPath, [serverPath, "--port", String(port)], {
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
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
    titleBarStyle: "default",
    backgroundColor: "#0c0f1a",
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
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

// ---------- CLI installer (Windows PATH + WSL shim) ----------

function backendResourcePath(): string {
  // Em prod: <install>\resources\python-backend. Em dev: ./resources/python-backend
  return app.isPackaged
    ? path.join(process.resourcesPath, "python-backend")
    : path.join(__dirname, "..", "resources", "python-backend");
}

async function getUserPath(): Promise<string> {
  if (process.platform !== "win32") return "";
  const ps =
    `[Environment]::GetEnvironmentVariable('PATH','User')`;
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile", "-Command", ps,
  ]);
  return (stdout || "").trim();
}

async function setUserPath(newValue: string): Promise<void> {
  const ps =
    `[Environment]::SetEnvironmentVariable('PATH', $args[0], 'User')`;
  await execFileP("powershell.exe", [
    "-NoProfile", "-Command", ps, "-Args", newValue,
  ]);
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
    "# Gerado pelo Presidio Anon — nao edite manualmente",
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
    const userPath = await getUserPath().catch(() => "");
    status.windows.onPath = userPath
      .split(";")
      .some((p) => path.normalize(p).toLowerCase() === path.normalize(backendDir).toLowerCase());
    status.windows.installed = status.windows.onPath;

    if (await wslAvailable()) {
      status.wsl.available = true;
      try {
        const home = await wslHomeBin();
        status.wsl.shimPath = `${home}/presidio-anon`;
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
  const current = await getUserPath();
  const parts = current.split(";").filter(Boolean);
  const already = parts.some(
    (p) => path.normalize(p).toLowerCase() === path.normalize(dir).toLowerCase()
  );
  if (already) return { ok: true, alreadyInstalled: true };

  const newValue = [...parts, dir].join(";");
  await setUserPath(newValue);
  return { ok: true, note: "PATH atualizado. Reabra o terminal para aplicar." };
});

ipcMain.handle("cli-uninstall-windows", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "Disponível apenas no Windows." };
  }
  const dir = backendResourcePath();
  const current = await getUserPath();
  const filtered = current
    .split(";")
    .filter((p) => p && path.normalize(p).toLowerCase() !== path.normalize(dir).toLowerCase());
  await setUserPath(filtered.join(";"));
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
  const shim = `${homeBin}/presidio-anon`;

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
      ? "Use 'presidio-anon' em qualquer terminal WSL."
      : `Adicione '${homeBin}' ao PATH do seu shell (ex.: em ~/.bashrc).`,
  };
});

ipcMain.handle("cli-uninstall-wsl", async () => {
  if (process.platform !== "win32" || !(await wslAvailable())) {
    return { ok: false, error: "WSL indisponível." };
  }
  const homeBin = await wslHomeBin();
  await execFileP("wsl.exe", ["bash", "-c", `rm -f '${homeBin}/presidio-anon'`]);
  return { ok: true };
});

// Silencia lint de imports opcionais não usados se os helpers forem podados
void os;

// ---------- fim CLI installer ----------

ipcMain.handle("select-files", async () => {
  if (!mainWindow) return [];

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documentos de texto", extensions: ["txt", "md", "rtf"] },
    ],
  });

  if (result.canceled) return [];

  return result.filePaths.slice(0, 10).map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
  }));
});

// Porta efetiva do backend, resolvida no boot e consultada pelo renderer.
let backendPort = PYTHON_PORT;

ipcMain.handle("get-backend-port", () => backendPort);
ipcMain.handle("get-backend-token", () => tokenSessao);

// App lifecycle
app.whenReady().then(async () => {
  backendPort = await findAvailablePort(PYTHON_PORT);
  await startPythonBackend(backendPort);
  createWindow();
});

app.on("window-all-closed", () => {
  stopPythonBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopPythonBackend();
});
