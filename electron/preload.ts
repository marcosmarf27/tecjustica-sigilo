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
  /* A chave da API não tem canal de leitura, e isso é proposital: o processo
     principal a usa ao montar a requisição, e o renderer só precisa saber se
     ela existe. `ultimos4` basta para reconhecer qual chave está guardada. */
  segredo: {
    resumo: () => ipcRenderer.invoke("segredo-resumo"),
    guardar: (chave: string) => ipcRenderer.invoke("segredo-guardar", chave),
    apagar: () => ipcRenderer.invoke("segredo-apagar"),
  },
  /* `abrir` recebe ids do cofre, nunca texto: não há como o renderer mandar
     conteúdo arbitrário para a nuvem, porque o canal não aceita conteúdo. */
  chat: {
    modelos: () => ipcRenderer.invoke("chat-modelos"),
    abrir: (ids: string[], modelo?: string) =>
      ipcRenderer.invoke("chat-abrir", ids, modelo),
    estado: (id: string) => ipcRenderer.invoke("chat-estado", id),
    orcamento: (id: string) => ipcRenderer.invoke("chat-orcamento", id),
    previsualizar: (id: string) => ipcRenderer.invoke("chat-previsualizar", id),
    perguntar: (id: string, pergunta: string) =>
      ipcRenderer.invoke("chat-perguntar", id, pergunta),
    cancelar: (id: string) => ipcRenderer.invoke("chat-cancelar", id),
    fechar: (id: string) => ipcRenderer.invoke("chat-fechar", id),
    sondar: (modelo: string) => ipcRenderer.invoke("chat-sondar", modelo),
  },
  cli: {
    status: () => ipcRenderer.invoke("cli-status"),
    installWindows: () => ipcRenderer.invoke("cli-install-windows"),
    uninstallWindows: () => ipcRenderer.invoke("cli-uninstall-windows"),
    installWsl: () => ipcRenderer.invoke("cli-install-wsl"),
    uninstallWsl: () => ipcRenderer.invoke("cli-uninstall-wsl"),
  },
});
