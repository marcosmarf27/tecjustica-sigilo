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
  cli: {
    status: () => ipcRenderer.invoke("cli-status"),
    installWindows: () => ipcRenderer.invoke("cli-install-windows"),
    uninstallWindows: () => ipcRenderer.invoke("cli-uninstall-windows"),
    installWsl: () => ipcRenderer.invoke("cli-install-wsl"),
    uninstallWsl: () => ipcRenderer.invoke("cli-uninstall-wsl"),
  },
});
