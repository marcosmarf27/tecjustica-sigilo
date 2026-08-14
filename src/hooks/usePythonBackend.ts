import { useState, useEffect, useCallback, useRef } from "react";
import type { AnonymizeResponse, EntityType } from "../types";

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

  try {
    return await fetch(url, { ...init, signal: controller.signal });
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
    extractText,
    reconectar,
    adicionarNaDenyList,
  };
}
