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
  /** Política de máscara; ausente no que foi guardado antes da v1.4.0. */
  politicaMascara?: string;
  paginasComErro: number;
  totalPaginas: number;
}

/* Espelho de `ConteudoDoCofre` em `electron/cofre.ts:66`. São duas declarações
   do mesmo tipo em lados opostos da ponte IPC, e elas não têm como se conferir:
   campo acrescentado de um lado só atravessa em silêncio e chega `undefined`.
   Mexeu num, mexa no outro. */
interface ConteudoDoCofre {
  textoOriginal: string;
  textoAnonimizado: string;
  ocorrencias: unknown[];
  caminhoOriginal: string;
  ocr?: unknown;
  politicaMascara?: string;
  valoresDistintos?: Record<string, number>;
  modoNlp?: string;
  entidadesSolicitadas?: string[];
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
  /** Regrava um documento guardado, mantendo id e data. `null` se ele já saiu. */
  atualizar: (
    id: string,
    entrada: Omit<EntradaDoCofre, "id" | "gravadoEm">,
    conteudo: ConteudoDoCofre
  ) => Promise<EntradaDoCofre | null>;
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
  /** Opcional porque fora do Electron não há barra de título para pintar. */
  janela?: {
    pintarBarra: (cores: { fundo: string; simbolo: string }) => Promise<void>;
  };
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
  segredo: SegredoAPI;
  chat: ChatAPI;
}

interface SegredoAPI {
  /** Nunca devolve a chave: só se existe e os quatro últimos caracteres. */
  resumo: () => Promise<{
    presente: boolean;
    ultimos4: string | null;
    gravadoEm: string | null;
  }>;
  guardar: (chave: string) => Promise<void>;
  apagar: () => Promise<void>;
}

interface ModeloDaNuvem {
  id: string;
  nome: string;
  contexto: number;
  entrada: number;
  saida: number;
  inteligencia?: number;
  faixaExtra?: { acimaDe: number; entrada: number; saida: number };
  reasoningObrigatorio?: boolean;
  observacao?: string;
}

/** Um pedaço de texto da conversa, já com os pseudônimos resolvidos. */
type TrechoDaConversa =
  | { tipo: "texto"; texto: string }
  | { tipo: "reposto"; rotulo: string; valor: string }
  | { tipo: "desconhecido"; rotulo: string };

interface TurnoDaConversa {
  papel: "usuario" | "assistente";
  trechos: TrechoDaConversa[];
  trocas?: { valor: string; rotulo: string }[];
}

interface EstadoDaConversa {
  id: string;
  documentos: { id: string; nome: string }[];
  avisos: { grave: boolean; texto: string }[];
  turnos: TurnoDaConversa[];
  parcial: TrechoDaConversa[];
  enviando: boolean;
  comprometida: boolean;
  erro: string | null;
  provedor: string | null;
  gastoDolares: number;
  tokensDoContexto: number;
  modelo: string;
}

/**
 * `abrir` recebe **ids do cofre**, nunca texto.
 *
 * É a fronteira do desenho: o renderer não tem como mandar conteúdo arbitrário
 * para a nuvem, porque não existe canal que aceite conteúdo. O mapa que liga
 * pseudônimo a nome real também não atravessa — as respostas chegam já
 * re-hidratadas, em pedaços prontos para desenhar.
 */
interface ChatAPI {
  modelos: () => Promise<ModeloDaNuvem[]>;
  abrir: (ids: string[], modelo?: string) => Promise<EstadoDaConversa>;
  estado: (id: string) => Promise<EstadoDaConversa | null>;
  orcamento: (id: string) => Promise<{
    tokensEntrada: number;
    dolares: number;
    faixaCara: boolean;
    excedeContexto: boolean;
  } | null>;
  previsualizar: (id: string) => Promise<string | null>;
  perguntar: (id: string, pergunta: string) => Promise<void>;
  cancelar: (id: string) => Promise<void>;
  fechar: (id: string) => Promise<void>;
  sondar: (modelo: string) => Promise<{
    provedor: string | null;
    zdr: boolean;
    erro: string | null;
  }>;
}

interface Window {
  /** Ausente quando a interface roda fora do Electron (dev no navegador). */
  electronAPI?: ElectronAPI;
}
