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
  selectFiles: () => Promise<{ name: string; path: string }[]>;
  cli: CliAPI;
}

interface Window {
  /** Ausente quando a interface roda fora do Electron (dev no navegador). */
  electronAPI?: ElectronAPI;
}
