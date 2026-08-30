import type { FileItem, ProcessedFile } from "../types";

/**
 * Estado de sessão — o que morre quando o aplicativo fecha.
 *
 * O que **sobrevive** está em outros dois lugares, e a separação é a regra que
 * organiza tudo aqui:
 *
 * | | onde | por quê |
 * |---|---|---|
 * | escolhas de trabalho | `usePreferencias` (localStorage, claro) | não é dado pessoal |
 * | texto e ocorrências | cofre (`safeStorage`, cifrado) | é dado pessoal |
 * | fila, progresso, aviso | aqui | não faz sentido guardar |
 */

/** Os quatro destinos do trilho. Revisão não entra: não é destino, é o que
 *  abre ao escolher um documento. */
export type Destino = "mesa" | "documentos" | "conexoes" | "ajustes";

/** Estágio de um arquivo dentro do lote. */
export type EstadoArquivo =
  | "na-fila"
  | "lendo"
  | "anonimizando"
  | "pronto"
  | "falhou";

export interface ArquivoNaFila extends FileItem {
  estado: EstadoArquivo;
  /** Só quando `estado === "falhou"`. Dizer o motivo é o que torna acionável. */
  motivoDaFalha?: string;
}

export interface Progresso {
  atual: number;
  total: number;
  nomeArquivo: string;
  etapa: string;
}

export interface Aviso {
  mensagem: string;
  tipo: "sucesso" | "erro";
}

/**
 * A revisão aberta. `origem` importa porque muda o que "voltar" significa:
 * vindo do processamento, volta para a Mesa; vindo da biblioteca, volta para
 * Documentos.
 */
export interface RevisaoAberta {
  arquivos: ProcessedFile[];
  origem: "processamento" | "biblioteca";
  /** Id no cofre, quando veio da biblioteca. */
  idNoCofre?: string;
}

export interface EstadoApp {
  destino: Destino;
  /** Sobrepõe o destino quando presente. */
  revisao: RevisaoAberta | null;
  fila: ArquivoNaFila[];
  /** Não-nulo enquanto o lote roda. */
  progresso: Progresso | null;
  aviso: Aviso | null;
}

export const ESTADO_INICIAL: EstadoApp = {
  destino: "mesa",
  revisao: null,
  fila: [],
  progresso: null,
  aviso: null,
};

export type AcaoApp =
  | { tipo: "ir-para"; destino: Destino }
  | { tipo: "definir-fila"; arquivos: FileItem[] }
  | { tipo: "limpar-fila" }
  | {
      tipo: "estado-do-arquivo";
      caminho: string;
      estado: EstadoArquivo;
      motivo?: string;
    }
  | { tipo: "iniciar-lote"; total: number; primeiroNome: string }
  | { tipo: "progresso"; progresso: Progresso }
  | { tipo: "encerrar-lote" }
  | { tipo: "abrir-revisao"; revisao: RevisaoAberta }
  | { tipo: "fechar-revisao" }
  | { tipo: "avisar"; mensagem: string; tipoAviso?: "sucesso" | "erro" }
  | { tipo: "fechar-aviso" };
