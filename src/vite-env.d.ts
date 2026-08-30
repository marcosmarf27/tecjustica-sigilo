/// <reference types="vite/client" />

interface CliStatusResult {
  backendDir: string;
  windows: { installed: boolean; onPath: boolean };
  wsl: { available: boolean; installed: boolean; shimPath: string };
}

interface CliActionResult {
  ok: boolean;
  note?: string;
  error?: string;
  shimPath?: string;
  onPath?: boolean;
  alreadyInstalled?: boolean;
}

/** Uma linha do índice do cofre. Sem o conteúdo pesado. */
interface EntradaDoCofre {
  id: string;
  nome: string;
  /** ISO 8601. */
  gravadoEm: string;
  /** Número CNJ detectado, ou `null` para "Avulsos". */
  cnj: string | null;
  totalOcorrencias: number;
  porTipo: Record<string, number>;
  paginasComErro: number;
  totalPaginas: number;
}

interface ConteudoDoCofre {
  textoOriginal: string;
  textoAnonimizado: string;
  ocorrencias: unknown[];
  caminhoOriginal: string;
  ocr?: unknown;
}

/**
 * Cofre cifrado, no processo principal.
 *
 * `gravar` **rejeita** quando o sistema não oferece cifragem, em vez de gravar
 * em claro. Quem chama precisa tratar a rejeição: um `catch` vazio aqui
 * anunciaria "guardado" sobre um cofre que recusou.
 */
interface CofreAPI {
  disponivel: () => Promise<boolean>;
  listar: () => Promise<EntradaDoCofre[]>;
  gravar: (
    entrada: Omit<EntradaDoCofre, "id" | "gravadoEm">,
    conteudo: ConteudoDoCofre
  ) => Promise<EntradaDoCofre>;
  ler: (id: string) => Promise<ConteudoDoCofre | null>;
  apagar: (id: string) => Promise<void>;
  esvaziar: () => Promise<void>;
  /** Devolve quantos itens saíram. */
  expurgar: (dias: number) => Promise<number>;
}

interface CliAPI {
  status: () => Promise<CliStatusResult>;
  installWindows: () => Promise<CliActionResult>;
  uninstallWindows: () => Promise<CliActionResult>;
  installWsl: () => Promise<CliActionResult>;
  uninstallWsl: () => Promise<CliActionResult>;
}

interface ElectronAPI {
  /** Porta em que o backend Python realmente subiu (pode não ser a padrão). */
  getBackendPort: () => Promise<number>;
  /** Credencial da sessão; sem ela o backend recusa as requisições. */
  getBackendToken: () => Promise<string>;
  /** Caminho absoluto de um File — substitui o antigo File.path. */
  getPathForFile: (file: File) => string;
  readFile: (path: string) => Promise<string>;
  saveFile: (
    path: string,
    content: string
  ) => Promise<{ salvo: boolean; motivo?: string }>;
  /** DOCX é um zip — vai em base64 para não se corromper no caminho. */
  saveFileBinary: (
    path: string,
    base64: string
  ) => Promise<{ salvo: boolean; motivo?: string }>;
  selectFiles: () => Promise<{ name: string; path: string }[]>;
  /** Pasta de destino da anonimização. `null` quando o usuário cancela. */
  selectDirectory: () => Promise<string | null>;
  cofre: CofreAPI;
  cli: CliAPI;
}

interface Window {
  /** Ausente quando a interface roda fora do Electron (dev no navegador). */
  electronAPI?: ElectronAPI;
}
