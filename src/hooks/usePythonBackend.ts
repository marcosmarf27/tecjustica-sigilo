import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AnonymizeResponse,
  EntityType,
  PoliticaMascara,
} from "../types";

type BackendStatus = "loading" | "ready" | "error";
type NlpMode = "transformer" | "spacy" | "unknown";

// Porta de partida. A porta real é resolvida pelo processo principal, que
// procura a primeira livre a partir daqui — por isso ela é consultada por IPC
// em vez de ficar fixa: com 8123 ocupada, o backend sobe em 8124 e uma
// constante fixa apontaria para uma porta morta.
const PORTA_PADRAO = 8123;

// Anonimizar um processo inteiro leva minutos; o limite existe para que uma
// falha do backend vire erro visível em vez de espera infinita.
const TIMEOUT_ANONIMIZACAO_MS = 30 * 60 * 1000;
const TIMEOUT_RAPIDO_MS = 30 * 1000;
// De quanto em quanto tempo perguntar como vai o processamento. Um segundo é
// o bastante para a barra parecer viva sem encher o backend de requisições.
const INTERVALO_PROGRESSO_MS = 1000;

/** Andamento de um processamento em curso, como o backend o descreve. */
export interface Progresso {
  estado: "extraindo" | "analisando" | "concluido" | "cancelado" | "erro";
  etapa: string;
  atual: number;
  total: number;
  erro: string | null;
  nome_arquivo: string;
}

/**
 * Credencial desta execução, entregue pelo processo principal.
 *
 * Existe porque o backend abre arquivos do disco a pedido da interface: sem
 * ela, qualquer página aberta no navegador poderia mandar a porta local ler um
 * documento e devolver o conteúdo. Vive só em memória.
 */
let tokenSessao = "";

/**
 * Garante que temos a credencial, buscando-a do processo principal se preciso.
 *
 * O backend só anuncia o token quando termina de carregar o modelo, e o
 * processo principal o captura da saída padrão — ou seja, ele aparece do outro
 * lado do IPC num instante que a interface não controla. Buscar uma vez só,
 * na montagem, é uma corrida: `/health` não exige credencial e responde
 * "pronto" mesmo com o token ainda vazio aqui, e a partir daí toda chamada real
 * levaria 403 sem nunca tentar de novo.
 */
async function garantirToken(): Promise<string> {
  if (tokenSessao) return tokenSessao;
  try {
    tokenSessao = (await window.electronAPI?.getBackendToken?.()) ?? "";
  } catch {
    // Sem IPC (interface aberta fora do Electron): segue sem credencial.
  }
  return tokenSessao;
}

async function comTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  externo?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const cancelar = () => controller.abort();
  externo?.addEventListener("abort", cancelar);

  const enviar = async (token: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), "X-Presidio-Token": token },
      signal: controller.signal,
    });

  try {
    const resposta = await enviar(await garantirToken());

    // 403 com credencial ausente ou vencida: o backend pode ter reiniciado e
    // sorteado outro segredo. Vale uma segunda tentativa com o token atual —
    // sem isso, a interface fica inutilizável até o aplicativo ser reaberto.
    if (resposta.status === 403) {
      const anterior = tokenSessao;
      tokenSessao = "";
      const renovado = await garantirToken();
      if (renovado && renovado !== anterior) return await enviar(renovado);
      tokenSessao = anterior;
    }

    return resposta;
  } finally {
    clearTimeout(timer);
    externo?.removeEventListener("abort", cancelar);
  }
}

/** Informado quando o motor pedido não pôde ser carregado e caiu para o leve. */
export interface AvisoDeModo {
  solicitado: string;
  efetivo: string;
  motivo: string;
}

export function usePythonBackend() {
  const [status, setStatus] = useState<BackendStatus>("loading");
  const [nlpMode, setNlpMode] = useState<NlpMode>("unknown");
  const [avisoDeModo, setAvisoDeModo] = useState<AvisoDeModo | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const baseRef = useRef(`http://127.0.0.1:${PORTA_PADRAO}`);

  useEffect(() => {
    let cancelado = false;
    let tentativas = 0;
    // Até 180s: na primeira execução o modelo pode precisar ser baixado.
    const maxTentativas = 180;

    const verificar = async () => {
      try {
        const res = await comTimeout(
          `${baseRef.current}/health`,
          {},
          TIMEOUT_RAPIDO_MS
        );
        const data = await res.json();
        if (!cancelado) {
          if (data.nlp_mode) setNlpMode(data.nlp_mode);
          // O motor pode ter caído para o modo leve sem que nada apareça na
          // tela. Quem confere um documento sigiloso precisa saber disso.
          if (data.motivo_fallback && data.nlp_mode_solicitado) {
            setAvisoDeModo({
              solicitado: data.nlp_mode_solicitado,
              efetivo: data.nlp_mode,
              motivo: data.motivo_fallback,
            });
          } else {
            setAvisoDeModo(null);
          }
          if (data.status === "ready") {
            setStatus("ready");
            return;
          }
        }
      } catch {
        // Servidor ainda não subiu — segue tentando.
      }

      tentativas++;
      if (!cancelado && tentativas < maxTentativas) {
        setTimeout(verificar, 1000);
      } else if (!cancelado) {
        setStatus("error");
      }
    };

    const iniciar = async () => {
      try {
        const porta = await window.electronAPI?.getBackendPort?.();
        if (porta) baseRef.current = `http://127.0.0.1:${porta}`;
      } catch {
        // Sem IPC (ex.: rodando no navegador em dev): usa a porta padrão.
      }
      verificar();
    };

    setStatus("loading");
    iniciar();

    return () => {
      cancelado = true;
    };
  }, [tentativa]);

  /** Refaz a conexão com o backend — usado pelo botão da tela de erro. */
  const reconectar = useCallback(() => setTentativa((n) => n + 1), []);

  const extractText = useCallback(
    async (content: string, format: string): Promise<string> => {
      const res = await comTimeout(
        `${baseRef.current}/extract-text`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, format }),
        },
        TIMEOUT_RAPIDO_MS
      );

      if (!res.ok) {
        throw new Error(`Não foi possível ler o arquivo (erro ${res.status})`);
      }

      const data = await res.json();
      return data.text;
    },
    []
  );

  /**
   * Processa um documento ou texto em segundo plano, informando progresso.
   *
   * O trabalho roda no backend numa thread própria; aqui só se acompanha o
   * andamento e se pede cancelamento. É o que permite mostrar em que etapa a
   * anonimização está e interrompê-la de verdade — a versão síncrona anterior
   * deixava a interface adivinhando.
   */
  const processar = useCallback(
    async (
      entrada: { caminho?: string; texto?: string; nomeArquivo: string },
      entities: EntityType[],
      politica: PoliticaMascara,
      aoProgredir?: (p: Progresso) => void,
      signal?: AbortSignal
    ): Promise<AnonymizeResponse & { texto_original: string }> => {
      const inicio = await comTimeout(
        `${baseRef.current}/processar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caminho: entrada.caminho,
            texto: entrada.texto,
            nome_arquivo: entrada.nomeArquivo,
            entities,
            language: "pt",
            politica_mascara: politica,
          }),
        },
        TIMEOUT_RAPIDO_MS
      );

      if (!inicio.ok) {
        throw new Error(`Não foi possível iniciar o processamento (${inicio.status})`);
      }

      const { job_id: jobId } = await inicio.json();

      const cancelar = () => {
        // Sem timeout curto aqui: cancelar é o pedido mais importante do fluxo.
        garantirToken()
          .then((token) =>
            fetch(`${baseRef.current}/processar/${jobId}/cancelar`, {
              method: "POST",
              headers: { "X-Presidio-Token": token },
            })
          )
          .catch(() => undefined);
      };
      signal?.addEventListener("abort", cancelar);

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise((r) => setTimeout(r, INTERVALO_PROGRESSO_MS));

          const res = await comTimeout(
            `${baseRef.current}/processar/${jobId}`,
            {},
            TIMEOUT_RAPIDO_MS
          );
          if (!res.ok) throw new Error("Perdi contato com o processamento");

          const estado: Progresso = await res.json();
          aoProgredir?.(estado);

          if (estado.estado === "cancelado") {
            throw new DOMException("Processamento cancelado", "AbortError");
          }
          if (estado.estado === "erro") {
            throw new Error(estado.erro || "O processamento falhou");
          }
          if (estado.estado === "concluido") break;
        }

        const res = await comTimeout(
          `${baseRef.current}/processar/${jobId}/resultado`,
          {},
          TIMEOUT_RAPIDO_MS
        );
        if (!res.ok) throw new Error("Não foi possível ler o resultado");
        return res.json();
      } finally {
        signal?.removeEventListener("abort", cancelar);
      }
    },
    []
  );

  const anonymize = useCallback(
    async (
      text: string,
      entities: EntityType[],
      signal?: AbortSignal
    ): Promise<AnonymizeResponse> => {
      const res = await comTimeout(
        `${baseRef.current}/anonymize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, entities, language: "pt" }),
        },
        TIMEOUT_ANONIMIZACAO_MS,
        signal
      );

      if (!res.ok) {
        throw new Error(`O motor de anonimização falhou (erro ${res.status})`);
      }

      return res.json();
    },
    []
  );

  /**
   * Marca um termo como "nunca mascarar". Usado quando o revisor identifica
   * um falso positivo — o backend recarrega a lista a quente, então a correção
   * vale já no próximo processamento, sem reiniciar o aplicativo.
   */
  const adicionarNaDenyList = useCallback(
    async (tipo: string, termo: string): Promise<void> => {
      const atual = await comTimeout(
        `${baseRef.current}/config/deny-list`,
        {},
        TIMEOUT_RAPIDO_MS
      );
      if (!atual.ok) throw new Error("Não foi possível ler a lista de exceções");

      const { deny_list: lista } = await atual.json();
      const doTipo: string[] = lista[tipo] ?? [];
      const normalizado = termo.trim();
      if (!normalizado) return;
      if (doTipo.some((t) => t.toLowerCase() === normalizado.toLowerCase())) return;

      const res = await comTimeout(
        `${baseRef.current}/config/deny-list`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deny_list: { ...lista, [tipo]: [...doTipo, normalizado] },
          }),
        },
        TIMEOUT_RAPIDO_MS
      );
      if (!res.ok) throw new Error("Não foi possível gravar a exceção");
    },
    []
  );

  return {
    status,
    nlpMode,
    avisoDeModo,
    anonymize,
    processar,
    extractText,
    reconectar,
    adicionarNaDenyList,
  };
}
