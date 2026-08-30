export type EntityTypeId =
  | "PERSON"
  | "CPF_BR"
  | "CNPJ_BR"
  | "RG_BR"
  | "PHONE_NUMBER_BR"
  | "EMAIL_ADDRESS"
  | "ENDERECO_BR"
  | "CEP_BR"
  | "LOCATION"
  | "OAB_BR"
  | "DATE_OF_BIRTH"
  | "NIT_PIS_PASEP"
  | "NUMERO_PROCESSO_CNJ"
  | "CONTA_BANCARIA";

export type EntityType = EntityTypeId;

export interface EntityInfo {
  id: EntityTypeId;
  label: string;
  /**
   * Sufixo do token CSS `--color-entity-*`. É um **nome**, não um valor: a cor
   * mora só em `src/styles/tokens.css`, onde muda com o tema.
   *
   * Este campo substitui um `color: "#f59e0b"` que existia aqui. Havia duas
   * paletas de entidade em desacordo — os 14 tokens `--color-entity-*` no CSS,
   * documentados e sem nenhum uso, e 14 cores default do Tailwind 3 cravadas
   * neste arquivo, que eram as que o usuário via de verdade. Cor em constante
   * de TypeScript não sabe que existe modo noturno.
   */
  token: string;
}

export const ALL_ENTITIES: EntityInfo[] = [
  { id: "PERSON", label: "Nome", token: "person" },
  { id: "CPF_BR", label: "CPF", token: "cpf" },
  { id: "CNPJ_BR", label: "CNPJ", token: "cnpj" },
  { id: "RG_BR", label: "RG", token: "rg" },
  { id: "PHONE_NUMBER_BR", label: "Telefone", token: "phone" },
  { id: "EMAIL_ADDRESS", label: "E-mail", token: "email" },
  { id: "ENDERECO_BR", label: "Endereço", token: "address" },
  { id: "CEP_BR", label: "CEP", token: "cep" },
  { id: "LOCATION", label: "Cidade/Local", token: "location" },
  { id: "OAB_BR", label: "OAB", token: "oab" },
  { id: "DATE_OF_BIRTH", label: "Data Nasc.", token: "birthdate" },
  { id: "NIT_PIS_PASEP", label: "NIT/PIS", token: "nit" },
  { id: "NUMERO_PROCESSO_CNJ", label: "Nº Processo", token: "process" },
  { id: "CONTA_BANCARIA", label: "Conta Bancária", token: "bank" },
];

/**
 * Referência CSS para a cor de um tipo de entidade, pronta para entrar em
 * `style` ou numa custom property.
 *
 * Aceita `string` porque o backend devolve o tipo como texto livre em
 * `EntityFound.type` — um recognizer novo pode chegar antes de o front
 * conhecê-lo, e nesse caso a cor cai no cinza de metadado em vez de sumir.
 */
export const corDaEntidade = (tipo: string): string => {
  const info = ALL_ENTITIES.find((e) => e.id === tipo);
  return info ? `var(--color-entity-${info.token})` : "var(--toner-3)";
};

/** Rótulo em português de um tipo, com o próprio tipo como reserva. */
export const rotuloDaEntidade = (tipo: string): string =>
  ALL_ENTITIES.find((e) => e.id === tipo)?.label ?? tipo;

export interface FileItem {
  name: string;
  path: string;
  /** Vazio para documentos que o backend lê do disco (PDF, DOCX, imagem). */
  content: string;
  size: number;
  /** True quando o texto só existe depois da extração/OCR no backend. */
  precisaExtracao?: boolean;
}

/**
 * Como o dado detectado é substituído no documento.
 *
 * O compromisso é real e por isso a escolha é do operador: o marcador não
 * deixa nada para trás, a máscara parcial permite conferência visual mas
 * preserva iniciais e dígitos, e a cobertura total esconde até o formato.
 */
export type PoliticaMascara = "placeholder" | "parcial" | "total";

export interface OpcaoPolitica {
  id: PoliticaMascara;
  titulo: string;
  descricao: string;
  exemplo: string;
}

export const POLITICAS_MASCARA: OpcaoPolitica[] = [
  {
    id: "placeholder",
    titulo: "Marcador",
    descricao:
      "Nada do dado permanece. A numeração é estável, então dá para acompanhar quem é quem na leitura.",
    exemplo: "[PESSOA_1], [CPF_1]",
  },
  {
    id: "parcial",
    titulo: "Máscara parcial",
    descricao:
      "Mantém pistas para conferir de relance. Em documento longo, os fragmentos somados podem reidentificar.",
    exemplo: "J**** d* S****, 123.***.***-09",
  },
  {
    id: "total",
    titulo: "Cobertura total",
    descricao: "Esconde inclusive o formato do dado. É o mais fechado dos três.",
    exemplo: "*************",
  },
];

export interface EntityFound {
  type: string;
  text: string;
  start: number;
  end: number;
  score: number;
}

/**
 * Como o documento foi lido. Só existe quando a entrada foi um arquivo — texto
 * colado não passa por reconhecimento.
 *
 * `paginasComErro` é o campo que não pode ser escondido: são páginas que
 * precisavam de OCR e não voltaram. O texto delas não está no resultado, e
 * quem revisa precisa saber disso antes de assinar embaixo.
 */
export interface InfoOcr {
  houve_ocr: boolean;
  paginas_ocr: number;
  paginas_com_erro: number;
  erros: string[];
  total_paginas: number;
}

export interface AnonymizeResponse {
  anonymized_text: string;
  entities_found: EntityFound[];
  ocr?: InfoOcr;
}

export interface ProcessedFile {
  originalName: string;
  originalPath: string;
  originalContent: string;
  anonymizedContent: string;
  entitiesFound: EntityFound[];
  ocr?: InfoOcr;
}

/* `HistoryItem` foi removido junto com o `useHistory` e a `Sidebar`.
   O histórico guardava até 50 entradas de metadados em `localStorage`, enquanto
   os `results` viviam num `useRef` de sessão — então o item continuava clicável
   depois de reiniciar e respondia com um toast pedindo para processar o arquivo
   de novo. Quem faz esse papel agora é `EntradaDoCofre` (em `vite-env.d.ts`),
   sobre o cofre cifrado: ou o documento reabre inteiro, ou não é listado. */
