/**
 * O cliente do OpenRouter.
 *
 * Sem SDK, de propósito. O requisito duro deste recurso é que **toda**
 * requisição carregue `provider.zdr: true`, e a tabela `ProviderPreferences` do
 * Agent SDK não documenta esse campo — allowFallbacks, requireParameters,
 * dataCollection, order, only, ignore, quantizations, sort, maxPrice e os dois
 * preferred* estão lá, `zdr` não. Para um requisito de conformidade, "não
 * documentado" já basta para não apostar: um cliente tipado que não conhece o
 * campo é um cliente que pode descartá-lo em silêncio. O corpo é JSON puro e
 * cabe numa função.
 *
 * ## `net.fetch`, não o `fetch` global
 *
 * O `fetch` do Node usa a pilha de rede do próprio Node: ignora o proxy do
 * sistema e traz seu próprio conjunto de certificados. `net.fetch` do Electron
 * usa a pilha do Chromium, que respeita os dois. A diferença decide se o
 * recurso funciona na máquina de uma vara — atrás de proxy corporativo, muitas
 * vezes com inspeção TLS — ou se falha lá com um erro de certificado que parece
 * problema do OpenRouter. É a mesma classe de defeito que a seção
 * *Portabilidade Windows* do CLAUDE.md registra: código que só roda no ambiente
 * de quem escreveu.
 *
 * O buscador é injetável para que os testes não precisem de rede nem do
 * Electron carregado.
 */

import type { CorpoVerificado } from "./trava";
import { PROVEDORES_ZDR } from "./catalogo";

const URL_CHAT = "https://openrouter.ai/api/v1/chat/completions";

/** Sem sinal por este tempo, a conexão é considerada morta. */
const SILENCIO_MAXIMO_MS = 90_000;

export type Buscador = (url: string, init: RequestInit) => Promise<Response>;

function buscadorPadrao(): Buscador {
  /* Carregado sob demanda para que este módulo possa ser testado sem o
     Electron no `require`. */
  const { net } = require("electron") as typeof import("electron");
  return (url, init) => net.fetch(url, init);
}

export interface Mensagem {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * O que deu errado, ou o que não pôde ser confirmado.
 *
 * `grave` marca a conversa como comprometida e bloqueia novos envios. É o
 * tratamento proporcional: o conteúdo desta resposta já viajou, e o que ainda
 * dá para fazer é não mandar mais nada até o usuário tomar ciência.
 */
export interface Alarme {
  grave: boolean;
  texto: string;
}

export interface Resultado {
  texto: string;
  /** Quem realmente atendeu, segundo o próprio OpenRouter. */
  provedor: string | null;
  modeloAtendido: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custo: number | null;
  alarmes: Alarme[];
}

export function montarCorpo(opcoes: {
  modelo: string;
  mensagens: Mensagem[];
  esforcoDeRaciocinio: "low" | "medium" | "high";
}): Record<string, unknown> {
  return {
    model: opcoes.modelo,
    messages: opcoes.mensagens,
    stream: true,
    /* A trava de conformidade. `zdr` restringe o roteamento a endpoints sem
       retenção; sem nenhum elegível a requisição falha, que é o desfecho certo
       — nunca cair para um provedor que guarda. `data_collection: "deny"`
       exclui, além disso, quem possa treinar com o conteúdo. */
    provider: {
      zdr: true,
      data_collection: "deny",
      sort: "price",
    },
    /* Raciocínio explícito, nunca herdado. Vários modelos elegíveis raciocinam
       por padrão no esforço máximo, e esses tokens são cobrados como saída — a
       conta de saída pode superar a de entrada mesmo com um processo inteiro no
       prompt. Para perguntar sobre um documento que já está todo no contexto,
       o esforço baixo dá conta. */
    reasoning: { effort: opcoes.esforcoDeRaciocinio },
    usage: { include: true },
  };
  /* Deliberadamente ausentes:
     - `plugins: [{id: "context-compression"}]`, que trunca o MEIO do prompt
       quando ele não cabe. Seria o pior modo de falha possível: resposta
       confiante sobre metade do processo. Sem o plugin, prompt grande demais
       falha com erro, que é o que se quer. Ele só é automático em endpoints de
       8 mil tokens ou menos, e todos os daqui têm um milhão.
     - `models: [...]`, a lista de reserva, que troca de modelo sem avisar.
     - `HTTP-Referer` e `X-Title`, que poriam o aplicativo no ranking público do
       OpenRouter. O que este app processa não é assunto de ranking. */
}

/**
 * Uma requisição minúscula, antes de mandar o processo.
 *
 * A verificação de quem atendeu só chega no último pedaço do stream — quando o
 * documento já viajou. Isso é auditoria, não prevenção. A sonda converte parte
 * disso em verificação prévia: um pedido de um token, com o mesmo bloco
 * `provider`, para ver qual endpoint o roteamento escolhe agora.
 *
 * Não é prova — o roteamento da próxima requisição pode ser outro. A garantia
 * continua sendo o `zdr: true`, que é decidido do lado do servidor. A sonda
 * serve para o usuário ver, antes de enviar os autos, que a exigência está
 * sendo honrada. Custa frações de centavo.
 */
export async function sondar(
  chave: string,
  modelo: string,
  buscar: Buscador = buscadorPadrao()
): Promise<{ provedor: string | null; zdr: boolean; erro: string | null }> {
  try {
    const resposta = await buscar(URL_CHAT, {
      method: "POST",
      headers: cabecalhos(chave),
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
        stream: false,
        provider: { zdr: true, data_collection: "deny", sort: "price" },
      }),
    });

    if (!resposta.ok) {
      return { provedor: null, zdr: false, erro: await motivo(resposta) };
    }

    const corpo = (await resposta.json()) as Record<string, unknown>;
    const provedor = provedorDe(corpo);
    return {
      provedor,
      zdr: provedor !== null && PROVEDORES_ZDR.tem(provedor),
      erro: null,
    };
  } catch (erro) {
    return { provedor: null, zdr: false, erro: descrever(erro) };
  }
}

function cabecalhos(chave: string): Record<string, string> {
  return {
    Authorization: `Bearer ${chave}`,
    "Content-Type": "application/json",
    /* Sem isto a resposta não diz quem atendeu, e não haveria como conferir se
       o `zdr: true` foi honrado. */
    "X-OpenRouter-Metadata": "enabled",
  };
}

async function motivo(resposta: Response): Promise<string> {
  const bruto = await resposta.text().catch(() => "");
  try {
    const json = JSON.parse(bruto) as { error?: { message?: string } };
    if (json.error?.message) return `${resposta.status}: ${json.error.message}`;
  } catch {
    /* corpo não-JSON: o status já diz o suficiente */
  }
  if (resposta.status === 402) {
    return "402: sem crédito na conta do OpenRouter";
  }
  if (resposta.status === 404) {
    return (
      "404: nenhum endpoint atende a este modelo com a exigência de não-retenção " +
      "(ZDR). Escolha outro modelo — nada foi enviado a um provedor que retém."
    );
  }
  return `${resposta.status}${bruto ? `: ${bruto.slice(0, 200)}` : ""}`;
}

function descrever(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Lê `openrouter_metadata` e devolve o endpoint marcado como `selected`. */
function provedorDe(corpo: Record<string, unknown>): string | null {
  const meta = corpo["openrouter_metadata"] as
    | { endpoints?: { available?: { provider?: string; selected?: boolean }[] } }
    | undefined;

  const escolhido = meta?.endpoints?.available?.find((e) => e.selected);
  return escolhido?.provider ?? null;
}

/**
 * Manda a conversa e devolve a resposta, pedaço a pedaço.
 *
 * O corpo já vem carimbado pela trava — este módulo não monta requisição, só
 * envia o que passou pela verificação.
 */
export async function enviar(
  chave: string,
  corpo: CorpoVerificado,
  modeloPedido: string,
  aoPedaco: (acumulado: string) => void,
  sinal?: AbortSignal,
  buscar: Buscador = buscadorPadrao()
): Promise<Resultado> {
  const resposta = await buscar(URL_CHAT, {
    method: "POST",
    headers: cabecalhos(chave),
    body: corpo.json,
    signal: sinal,
  });

  if (!resposta.ok) throw new Error(await motivo(resposta));
  if (resposta.body === null) throw new Error("resposta sem corpo");

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();

  let texto = "";
  let pendente = "";
  let ultimoCorpo: Record<string, unknown> | null = null;
  let relogio = Date.now();

  for (;;) {
    /* Cão de guarda: um stream pode parar de emitir sem fechar a conexão, e aí
       a promessa nunca resolve e a tela fica esperando para sempre. */
    const pedaco = await Promise.race([
      leitor.read(),
      espera(SILENCIO_MAXIMO_MS - (Date.now() - relogio)),
    ]);
    if (pedaco === "silencio") {
      await leitor.cancel().catch(() => {});
      throw new Error("o servidor parou de responder no meio da resposta");
    }
    if (pedaco.done) break;
    relogio = Date.now();

    pendente += decodificador.decode(pedaco.value, { stream: true });
    const linhas = pendente.split("\n");
    /* A última linha pode estar cortada no meio; volta para o buffer. */
    pendente = linhas.pop() ?? "";

    for (const linha of linhas) {
      const limpa = linha.trim();
      if (!limpa.startsWith("data:")) continue;

      const dados = limpa.slice(5).trim();
      if (dados === "[DONE]") continue;

      let evento: Record<string, unknown>;
      try {
        evento = JSON.parse(dados) as Record<string, unknown>;
      } catch {
        continue;
      }

      ultimoCorpo = evento;

      const escolhas = evento["choices"] as
        | { delta?: { content?: string } }[]
        | undefined;
      const parte = escolhas?.[0]?.delta?.content;
      if (typeof parte === "string" && parte.length > 0) {
        texto += parte;
        /* Sempre o acumulado, nunca o pedaço: um pseudônimo pode chegar partido
           entre dois eventos (`[PESSOA_` num, `1]` no outro), e quem for
           re-hidratar por pedaço nunca casa o rótulo — o texto cru apareceria
           na tela. Sobre o acumulado o problema não existe. */
        aoPedaco(texto);
      }
    }
  }

  return concluir(texto, ultimoCorpo, modeloPedido);
}

function espera(ms: number): Promise<"silencio"> {
  return new Promise((resolve) =>
    setTimeout(() => resolve("silencio"), Math.max(ms, 0))
  );
}

function concluir(
  texto: string,
  ultimoCorpo: Record<string, unknown> | null,
  modeloPedido: string
): Resultado {
  const alarmes: Alarme[] = [];
  const provedor = ultimoCorpo ? provedorDe(ultimoCorpo) : null;

  if (provedor === null) {
    /* Sem saber quem atendeu, não dá para afirmar que a exigência de
       não-retenção foi honrada. A resposta certa é o alarme, não o silêncio:
       "na dúvida não afirme" é boa regra para afirmar fato e péssima para calar
       alarme — a lição que o contador de OCR já custou neste projeto. */
    alarmes.push({
      grave: true,
      texto:
        "o OpenRouter não informou qual provedor atendeu, então não foi " +
        "possível confirmar que a exigência de não-retenção foi respeitada",
    });
  } else if (!PROVEDORES_ZDR.tem(provedor)) {
    alarmes.push({
      grave: true,
      texto:
        `quem atendeu foi "${provedor}", que não está na lista de provedores ` +
        "sem retenção conhecidos por este aplicativo. Confira a política dele " +
        "antes de continuar",
    });
  }

  const modeloAtendido =
    typeof ultimoCorpo?.["model"] === "string"
      ? (ultimoCorpo["model"] as string)
      : null;

  if (modeloAtendido !== null && !modeloAtendido.startsWith(modeloPedido)) {
    alarmes.push({
      grave: false,
      texto: `foi pedido ${modeloPedido} e respondeu ${modeloAtendido}`,
    });
  }

  const uso = ultimoCorpo?.["usage"] as
    | { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    | undefined;

  return {
    texto,
    provedor,
    modeloAtendido,
    tokensEntrada: uso?.prompt_tokens ?? null,
    tokensSaida: uso?.completion_tokens ?? null,
    custo: uso?.cost ?? null,
    alarmes,
  };
}
