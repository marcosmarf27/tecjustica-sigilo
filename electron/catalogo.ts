/**
 * Os modelos que podem receber um processo.
 *
 * Dois requisitos, e os dois são duros:
 *
 * 1. **Contexto de um milhão de tokens.** Um processo real do PJe medido em
 *    31/08 tem 242 mil caracteres (~70 mil tokens); o maior documento do corpus
 *    de acurácia tem 1,08 MB (~310 mil tokens). Com essa folga, o documento
 *    inteiro cabe no prompt e não é preciso construir busca vetorial — que
 *    seria mais uma estrutura guardando dado pessoal, exatamente o que o cofre
 *    custou tanto a justificar.
 * 2. **Endpoint sem retenção (ZDR).** É o que sustenta o argumento da Resolução
 *    CNJ 615/2025: o dado anonimizado pode ser processado fora, desde que quem
 *    processa não o guarde.
 *
 * A lista abaixo foi conferida em 01/09/2026 contra a API do OpenRouter, com o
 * filtro `zdr=true&context=1000000` — que devolve 99 modelos. Estes são os que
 * fazem sentido para ler autos.
 *
 * **A garantia real não é esta lista, é o `provider.zdr: true` no corpo da
 * requisição.** Quem decide é o OpenRouter, no momento do roteamento. A lista
 * de provedores serve para o alarme: se quem atendeu não estiver nela, a
 * conversa avisa em vez de seguir calada. Mesma lógica do `motivo_fallback` do
 * motor de NLP — pedir uma coisa e receber outra é o defeito que não faz
 * barulho sozinho.
 */

export interface Modelo {
  id: string;
  nome: string;
  /** Tokens de contexto do modelo. O endpoint servido pode ter menos. */
  contexto: number;
  /** US$ por milhão de tokens. */
  entrada: number;
  saida: number;
  /** Índice de inteligência da Artificial Analysis, quando publicado. */
  inteligencia?: number;
  /**
   * Sobretaxa por prompt grande. `gpt-5.6-luna` dobra o preço de entrada acima
   * de 272 mil tokens — e um único documento do corpus cruza esse limiar, então
   * o usuário precisa saber disso antes de mandar, não na fatura.
   */
  faixaExtra?: { acimaDe: number; entrada: number; saida: number };
  /** Modelos que sempre raciocinam cobram esses tokens como saída. */
  reasoningObrigatorio?: boolean;
  observacao?: string;
}

export const MODELOS: Modelo[] = [
  {
    id: "z-ai/glm-5.3-flash",
    nome: "GLM 5.3 Flash",
    contexto: 1_310_720,
    entrada: 0.075,
    saida: 0.25,
    inteligencia: 57.5,
    reasoningObrigatorio: true,
    observacao:
      "Padrão: o mais capaz da faixa barata, e o maior contexto da lista.",
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    nome: "DeepSeek V4 Flash 0731",
    contexto: 1_310_720,
    entrada: 0.065,
    saida: 0.18,
    inteligencia: 51.8,
    observacao: "O mais barato, e o mais usado do OpenRouter em agosto/2026.",
  },
  {
    id: "openai/gpt-5.6-luna",
    nome: "GPT-5.6 Luna",
    contexto: 1_050_000,
    entrada: 0.2,
    saida: 1.2,
    inteligencia: 52.3,
    faixaExtra: { acimaDe: 272_000, entrada: 0.4, saida: 1.8 },
  },
  {
    id: "google/gemini-3.7-flash",
    nome: "Gemini 3.7 Flash",
    contexto: 1_048_576,
    entrada: 0.75,
    saida: 3.75,
    inteligencia: 56.0,
    reasoningObrigatorio: true,
    observacao: "Cobra os tokens de raciocínio à parte, a US$ 3,75/M.",
  },
  {
    id: "z-ai/glm-5.3",
    nome: "GLM 5.3",
    contexto: 1_310_720,
    entrada: 1.4,
    saida: 4.4,
    inteligencia: 59.5,
    reasoningObrigatorio: true,
  },
  {
    id: "openai/gpt-5.6-sol",
    nome: "GPT-5.6 Sol",
    contexto: 1_050_000,
    entrada: 2.0,
    saida: 10.0,
    inteligencia: 60.9,
    faixaExtra: { acimaDe: 272_000, entrada: 4.0, saida: 15.0 },
  },
];

export const MODELO_PADRAO = MODELOS[0].id;

export function modeloPorId(id: string): Modelo | null {
  return MODELOS.find((m) => m.id === id) ?? null;
}

/**
 * Provedores com política de retenção zero.
 *
 * Lista de **alarme**, não de filtro. Cravá-la como `provider.only` faria uma
 * rotação normal de provedor virar indisponibilidade que parece defeito do app.
 *
 * ## Por que ela é buscada em vez de cravada
 *
 * A primeira versão deste arquivo trazia dezesseis provedores, tirados à mão de
 * uma leitura da documentação. Na primeira sonda de verdade, o roteamento
 * mandou o DeepSeek V4 Flash para a **OpenInference** — que não estava na
 * lista — e o alarme disparou dizendo que a exigência de não-retenção talvez
 * não tivesse sido respeitada.
 *
 * Estava errado. A lista oficial (`/api/v1/endpoints/zdr`) tem **816 endpoints
 * de 50 provedores**, e a OpenInference tem exatamente um deles: justamente o
 * DeepSeek V4 Flash 0731. O `zdr: true` foi honrado; quem estava desatualizado
 * era o aplicativo.
 *
 * A lição não é "completar a lista" — é que uma lista embutida envelhece e
 * produz alarme falso, e **alarme falso é desligado na primeira semana**. Um
 * alarme em que ninguém acredita não protege de nada. Então a fonte é a API, e
 * o que está abaixo é só a reserva para quando não houver rede: o retrato de
 * 01/09/2026.
 */
const PROVEDORES_ZDR_CONHECIDOS = [
  "AkashML", "Amazon Bedrock", "Azure", "BaseTen", "Cerebras", "CoreWeave",
  "Crusoe", "Decart", "DeepInfra", "Deepgram", "DigitalOcean", "Fireworks",
  "Fish Audio", "Google", "Groq", "Inception", "Inceptron", "Io Net",
  "Ionstream", "Krea", "Makora", "Mancer 2", "Mara", "Minimax", "Mistral",
  "Modal", "ModelRun", "Moonshot AI", "Morph", "Nebius", "NextBit", "Novita",
  "OpenInference", "Parasail", "Perceptron", "Perplexity", "Phala", "Reka",
  "Relace", "Sail Research", "SambaNova", "Seed", "SiliconFlow", "Tencent",
  "Together", "Upstage", "Venice", "Wafer", "Z.AI", "xAI",
];

let provedoresZdr = new Set(PROVEDORES_ZDR_CONHECIDOS);

export const PROVEDORES_ZDR = {
  tem: (provedor: string) => provedoresZdr.has(provedor),
  /** Quantos são conhecidos agora — para a tela mostrar a data do retrato. */
  quantidade: () => provedoresZdr.size,
};

/**
 * Atualiza a lista a partir da fonte oficial.
 *
 * Falha em silêncio de propósito: sem rede, a reserva embutida continua
 * valendo. O que **não** pode acontecer é a atualização falhar e o aplicativo
 * passar a aceitar qualquer provedor — a reserva erra para o lado de alarmar
 * demais, nunca de menos.
 */
export async function atualizarProvedoresZdr(
  buscar: (url: string) => Promise<Response>
): Promise<number> {
  try {
    const resposta = await buscar("https://openrouter.ai/api/v1/endpoints/zdr");
    if (!resposta.ok) return provedoresZdr.size;

    const corpo = (await resposta.json()) as {
      data?: { provider_name?: string }[];
    };
    const nomes = (corpo.data ?? [])
      .map((e) => e.provider_name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    if (nomes.length > 0) provedoresZdr = new Set(nomes);
    return provedoresZdr.size;
  } catch {
    return provedoresZdr.size;
  }
}

export interface Estimativa {
  tokensEntrada: number;
  dolares: number;
  /** Verdadeiro quando a faixa cara do modelo se aplica a este envio. */
  faixaCara: boolean;
  /** Verdadeiro quando nem cabe: aí não é questão de preço. */
  excedeContexto: boolean;
}

/**
 * Quantos tokens um texto ocupa, aproximadamente.
 *
 * Português com tokenizadores modernos fica perto de 3,5 caracteres por token.
 * É estimativa para mostrar preço antes de enviar — a conta que vale é o
 * `usage` que volta na resposta, e é ele que alimenta o medidor da conversa.
 *
 * Um detalhe que engana: os pseudônimos custam caro. `[PESSOA_1]` são dez
 * caracteres e vários tokens, e um documento com milhares de ocorrências carrega
 * um volume que a regra dos 3,5 subestima. Daí a estimativa ser deliberadamente
 * conservadora.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 3.2);
}

export function estimar(
  modelo: Modelo,
  tokensEntrada: number,
  tokensSaidaEsperados = 1500
): Estimativa {
  const faixaCara =
    modelo.faixaExtra !== undefined && tokensEntrada > modelo.faixaExtra.acimaDe;

  const entrada = faixaCara ? modelo.faixaExtra!.entrada : modelo.entrada;
  const saida = faixaCara ? modelo.faixaExtra!.saida : modelo.saida;

  return {
    tokensEntrada,
    dolares:
      (tokensEntrada / 1_000_000) * entrada +
      (tokensSaidaEsperados / 1_000_000) * saida,
    faixaCara,
    excedeContexto: tokensEntrada > modelo.contexto,
  };
}
