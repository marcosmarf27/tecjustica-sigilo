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
  content: string;
  size: number;
}

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
