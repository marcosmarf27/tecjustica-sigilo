import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getBackendPort: (): Promise<number> => ipcRenderer.invoke("get-backend-port"),
  getBackendToken: (): Promise<string> => ipcRenderer.invoke("get-backend-token"),
  /** Caminho absoluto de um File vindo de drag-and-drop ou <input type="file">. */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  readFile: (path: string) => ipcRenderer.invoke("read-file", path),
  saveFile: (path: string, content: string) =>
    ipcRenderer.invoke("save-file", path, content),
  saveFileBinary: (path: string, base64: string) =>
    ipcRenderer.invoke("save-file-binary", path, base64),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  cofre: {
    disponivel: () => ipcRenderer.invoke("cofre-disponivel"),
    listar: () => ipcRenderer.invoke("cofre-listar"),
    gravar: (entrada: unknown, conteudo: unknown) =>
      ipcRenderer.invoke("cofre-gravar", entrada, conteudo),
    ler: (id: string) => ipcRenderer.invoke("cofre-ler", id),
    apagar: (id: string) => ipcRenderer.invoke("cofre-apagar", id),
    esvaziar: () => ipcRenderer.invoke("cofre-esvaziar"),
    expurgar: (dias: number) => ipcRenderer.invoke("cofre-expurgar", dias),
  },
  cli: {
    status: () => ipcRenderer.invoke("cli-status"),
    installWindows: () => ipcRenderer.invoke("cli-install-windows"),
    uninstallWindows: () => ipcRenderer.invoke("cli-uninstall-windows"),
    installWsl: () => ipcRenderer.invoke("cli-install-wsl"),
    uninstallWsl: () => ipcRenderer.invoke("cli-uninstall-wsl"),
  },
});
