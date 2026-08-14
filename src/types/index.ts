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
  color: string;
}

export const ALL_ENTITIES: EntityInfo[] = [
  { id: "PERSON", label: "Nome", color: "#f59e0b" },
  { id: "CPF_BR", label: "CPF", color: "#ef4444" },
  { id: "CNPJ_BR", label: "CNPJ", color: "#f97316" },
  { id: "RG_BR", label: "RG", color: "#e11d48" },
  { id: "PHONE_NUMBER_BR", label: "Telefone", color: "#8b5cf6" },
  { id: "EMAIL_ADDRESS", label: "E-mail", color: "#06b6d4" },
  { id: "ENDERECO_BR", label: "Endereço", color: "#10b981" },
  { id: "CEP_BR", label: "CEP", color: "#059669" },
  { id: "LOCATION", label: "Cidade/Local", color: "#0ea5e9" },
  { id: "OAB_BR", label: "OAB", color: "#6366f1" },
  { id: "DATE_OF_BIRTH", label: "Data Nasc.", color: "#ec4899" },
  { id: "NIT_PIS_PASEP", label: "NIT/PIS", color: "#14b8a6" },
  { id: "NUMERO_PROCESSO_CNJ", label: "Nº Processo", color: "#a855f7" },
  { id: "CONTA_BANCARIA", label: "Conta Bancária", color: "#f43f5e" },
];

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

export interface AnonymizeResponse {
  anonymized_text: string;
  entities_found: EntityFound[];
}

export interface ProcessedFile {
  originalName: string;
  originalPath: string;
  originalContent: string;
  anonymizedContent: string;
  entitiesFound: EntityFound[];
}

export interface HistoryItem {
  id: string;
  date: string;
  fileNames: string[];
  totalEntities: number;
  entityBreakdown: Record<string, number>;
  results: ProcessedFile[];
}
