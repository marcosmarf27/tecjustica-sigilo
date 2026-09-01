/**
 * O espaço de pseudônimos de uma conversa.
 *
 * O backend produz `[PESSOA_1]`, `[CPF_2]` e afins numerando **por documento**:
 * `Mascarador` é instanciado a cada chamada de `anonymize()` e descartado
 * (`engine.py:591`). Isso basta para ler um documento por vez, que é tudo o que
 * o aplicativo fazia até agora.
 *
 * Não basta para conversar sobre um processo. Juntar a petição inicial e a
 * procuração num só contexto entrega ao modelo um texto onde `[PESSOA_1]`
 * designa duas pessoas diferentes — e ele responderá com confiança sobre quem
 * assinou o quê, trocando as pessoas. É um erro que não parece erro: a resposta
 * sai bem escrita e plausível.
 *
 * Este módulo dá a todas as peças um espaço de numeração comum, **traduzindo
 * rótulo para rótulo**. A entrada é o texto já anonimizado e a saída é o mesmo
 * texto com outros números. O texto original não é lido em nenhum ponto deste
 * arquivo, e é por isso que o pior defeito possível aqui produz um rótulo
 * errado, não um vazamento.
 *
 * Ninguém importa `electron` aqui de propósito: o módulo é puro e os testes
 * rodam sobre ele sem interceptar `Module._load`, como em `saidaBackend.ts`.
 */

/** Uma ocorrência detectada, como o backend devolve em `entities_found`. */
export interface Ocorrencia {
  type: string;
  text: string;
  start: number;
  end: number;
  score?: number;
}

/**
 * Espelha `ROTULO_ENTIDADE` de `python-backend/mask_config.py:30-46`.
 *
 * É duplicação, e duplicação envelhece. A defesa não é lembrar de sincronizar —
 * é `conferir()`, abaixo, que compara os rótulos derivados daqui com os que
 * estão de fato no texto e **recusa o documento** quando divergem. Um rótulo
 * novo no Python vira uma recusa explícita, não um mapa silenciosamente errado.
 */
const ROTULO_ENTIDADE: Record<string, string> = {
  PERSON: "PESSOA",
  CPF_BR: "CPF",
  CNPJ_BR: "CNPJ",
  RG_BR: "RG",
  EMAIL_ADDRESS: "EMAIL",
  PHONE_NUMBER_BR: "TELEFONE",
  PHONE_NUMBER: "TELEFONE",
  LOCATION: "LOCAL",
  CEP_BR: "CEP",
  ENDERECO_BR: "ENDEREÇO",
  OAB_BR: "OAB",
  DATE_OF_BIRTH: "NASCIMENTO",
  NIT_PIS_PASEP: "NIT",
  NUMERO_PROCESSO_CNJ: "PROCESSO",
  CONTA_BANCARIA: "CONTA",
};

/** Um rótulo no texto: `[PESSOA_1]`. `ENDEREÇO` tem cedilha, daí `\p{Lu}`. */
const RE_ROTULO = /\[(\p{Lu}+(?:_\p{Lu}+)*)_(\d+)\]/gu;

export function rotuloDe(tipo: string): string {
  return ROTULO_ENTIDADE[tipo] ?? tipo;
}

/**
 * Forma comparável de um valor. Precisa casar com `_normalizar` de
 * `mask_config.py:239-247`: sem acento, minúsculas, espaços colapsados.
 *
 * É o que faz "JOÃO DA SILVA", "João da Silva" e "joao da silva" — as três
 * grafias que um mesmo documento produz entre cabeçalho, assinatura e OCR —
 * contarem como a mesma pessoa.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** O mapa de uma conversa: números atribuídos e o valor por trás de cada rótulo. */
export class MapaDeSessao {
  /** tipo de entidade → valor normalizado → número */
  private readonly numeros = new Map<string, Map<string, number>>();
  /** rótulo completo (`[PESSOA_1]`) → valor real, na primeira grafia vista */
  private readonly valores = new Map<string, string>();

  /**
   * Devolve o rótulo global para um valor, criando um número novo se for a
   * primeira vez que ele aparece nesta conversa.
   */
  rotularValor(tipo: string, texto: string): string {
    const rotulo = rotuloDe(tipo);
    const chave = normalizar(texto);

    let porTipo = this.numeros.get(rotulo);
    if (!porTipo) {
      porTipo = new Map();
      this.numeros.set(rotulo, porTipo);
    }

    let numero = porTipo.get(chave);
    if (numero === undefined) {
      numero = porTipo.size + 1;
      porTipo.set(chave, numero);
      /* A primeira grafia encontrada é a que a interface vai mostrar de volta.
         Guardar só a primeira mantém a exibição estável entre turnos. */
      this.valores.set(`[${rotulo}_${numero}]`, texto);
    }

    return `[${rotulo}_${numero}]`;
  }

  /** O valor real por trás de um rótulo, ou `null` se ele não é desta conversa. */
  valorDe(rotulo: string): string | null {
    return this.valores.get(rotulo) ?? null;
  }

  /** Quantos valores distintos por tipo — para a interface dizer o que trafega. */
  resumo(): Record<string, number> {
    const saida: Record<string, number> = {};
    for (const [rotulo, porTipo] of this.numeros) saida[rotulo] = porTipo.size;
    return saida;
  }
}

/** Falha ao preparar um documento; a conversa não deve começar. */
export class DocumentoIncompativelError extends Error {}

/**
 * Confere que as ocorrências explicam os rótulos que estão no texto.
 *
 * O `Mascarador` numera na ordem de leitura (`engine.py:758-762` ordena os spans
 * por `start` e só a substituição vai de trás para frente). Logo, o k-ésimo
 * rótulo conhecido do texto tem de ser o rótulo do k-ésimo valor distinto, na
 * ordem em que os valores aparecem.
 *
 * Se não bater, alguma premissa deste módulo deixou de valer — mudou a ordem no
 * Python, mudou o mapa de rótulos, ou as ocorrências não são deste texto. Em
 * qualquer desses casos o mapa sairia errado **sem sintoma**, e é por isso que
 * aqui se recusa em vez de seguir.
 */
function conferir(textoAnonimizado: string, esperados: string[]): void {
  const conhecidos = new Set(Object.values(ROTULO_ENTIDADE));
  const encontrados: string[] = [];

  for (const achado of textoAnonimizado.matchAll(RE_ROTULO)) {
    /* Rótulo cujo prefixo não é de entidade veio do próprio documento — uma
       tabela com "[ITEM_1]", por exemplo. Não é nosso, não conta. */
    if (conhecidos.has(achado[1])) encontrados.push(achado[0]);
  }

  if (encontrados.length !== esperados.length) {
    throw new DocumentoIncompativelError(
      `o texto tem ${encontrados.length} pseudônimos e as ocorrências ` +
        `descrevem ${esperados.length}; o documento não pode entrar na conversa`
    );
  }

  for (let i = 0; i < esperados.length; i++) {
    if (encontrados[i] !== esperados[i]) {
      throw new DocumentoIncompativelError(
        `o ${i + 1}º pseudônimo do texto é ${encontrados[i]}, mas as ` +
          `ocorrências indicam ${esperados[i]}`
      );
    }
  }
}

/**
 * Traz um documento para o espaço de numeração da conversa.
 *
 * Devolve o texto com os rótulos já trocados. `mapa` é alterado no caminho: a
 * ordem em que os documentos passam por aqui é a ordem em que os números são
 * distribuídos.
 */
export function incorporar(
  textoAnonimizado: string,
  ocorrencias: Ocorrencia[],
  mapa: MapaDeSessao
): string {
  /* A ordem de leitura é a única que reproduz a numeração do backend. A lista
     que chega do detector não vem ordenada — sai por janela, e `_fundir_spans`
     resolve sobreposição, não ordem. */
  const ordenadas = [...ocorrencias].sort((a, b) => a.start - b.start);

  /* Numeração local do documento, para saber de qual rótulo local estamos
     falando; e a tradução dele para o rótulo global. */
  const contagemLocal = new Map<string, Map<string, number>>();
  const traducao = new Map<string, string>();
  const esperados: string[] = [];

  for (const oc of ordenadas) {
    const rotulo = rotuloDe(oc.type);
    const chave = normalizar(oc.text);

    let porTipo = contagemLocal.get(rotulo);
    if (!porTipo) {
      porTipo = new Map();
      contagemLocal.set(rotulo, porTipo);
    }

    let local = porTipo.get(chave);
    if (local === undefined) {
      local = porTipo.size + 1;
      porTipo.set(chave, local);
    }

    const rotuloLocal = `[${rotulo}_${local}]`;
    esperados.push(rotuloLocal);
    if (!traducao.has(rotuloLocal)) {
      traducao.set(rotuloLocal, mapa.rotularValor(oc.type, oc.text));
    }
  }

  conferir(textoAnonimizado, esperados);
  return traduzir(textoAnonimizado, traducao);
}

/**
 * Troca rótulos por rótulos numa passada só.
 *
 * Uma passada importa: aplicar as trocas em sequência faria `[PESSOA_1]` virar
 * `[PESSOA_2]` e, na troca seguinte, `[PESSOA_3]` — um efeito cascata que
 * embaralharia justamente o que este módulo existe para manter em ordem.
 */
function traduzir(texto: string, traducao: Map<string, string>): string {
  return texto.replace(RE_ROTULO, (achado) => traducao.get(achado) ?? achado);
}

/** Uma substituição feita na pergunta do usuário, para mostrar a ele. */
export interface Troca {
  valor: string;
  rotulo: string;
}

export interface PerguntaPreparada {
  texto: string;
  trocas: Troca[];
}

/**
 * Prepara a pergunta digitada pelo usuário para sair da máquina.
 *
 * Este é o vetor de vazamento mais provável do recurso inteiro: o documento foi
 * anonimizado com cuidado, e aí alguém digita "o CPF 123.456.789-00 do João
 * aparece?" e manda o dado cru.
 *
 * As `ocorrencias` vêm de `POST /anonymize` chamado sobre a pergunta — mas
 * **só o `entities_found` daquela resposta serve**. O `anonymized_text` dela
 * não: o `Mascarador` recomeça a numerar do 1 a cada chamada, então o
 * `[PESSOA_1]` da pergunta seria outra pessoa que o `[PESSOA_1]` do contexto, e
 * o modelo responderia sobre quem não foi perguntado.
 */
export function prepararPergunta(
  pergunta: string,
  ocorrencias: Ocorrencia[],
  mapa: MapaDeSessao
): PerguntaPreparada {
  /* As duas ordens são diferentes e ambas importam — a mesma separação que
     `_aplicar_mascaras` faz em `engine.py:756-760`.

     A numeração segue a ordem de LEITURA: quem aparece primeiro na pergunta
     pega o número menor, como no documento. A substituição vai de TRÁS PARA
     FRENTE, porque o rótulo quase nunca tem o comprimento do valor e trocar da
     esquerda para a direita deslocaria os offsets ainda não aplicados.

     Fundir as duas passadas numa só, numerando enquanto substitui, inverte a
     numeração de duas entidades na mesma pergunta. Foi o que a primeira versão
     deste arquivo fez, e o teste das entidades coladas pegou. */
  const porLeitura = [...ocorrencias].sort((a, b) => a.start - b.start);
  const rotulos = porLeitura.map((o) => mapa.rotularValor(o.type, o.text));

  let texto = pergunta;
  for (let i = porLeitura.length - 1; i >= 0; i--) {
    const { start, end } = porLeitura[i];
    texto = texto.slice(0, start) + rotulos[i] + texto.slice(end);
  }

  const trocas: Troca[] = porLeitura.map((o, i) => ({
    valor: o.text,
    rotulo: rotulos[i],
  }));

  return { texto, trocas };
}

/** Um pedaço da resposta, já pronto para a tela. */
export type Trecho =
  | { tipo: "texto"; texto: string }
  | { tipo: "reposto"; rotulo: string; valor: string }
  | { tipo: "desconhecido"; rotulo: string };

/**
 * Devolve a resposta do modelo em pedaços, com os pseudônimos resolvidos.
 *
 * O mapa nunca sai da máquina: o modelo respondeu `[PESSOA_1]` e é isso que
 * trafegou. A reposição é local e serve para o usuário ler um nome em vez de um
 * código.
 *
 * Rótulo que não é desta conversa sai marcado como desconhecido, e não some.
 * Modelo inventa `[PESSOA_9]` num processo de três pessoas; apagar em silêncio
 * esconderia a invenção, e trocar por um nome qualquer seria pior ainda.
 */
export function reidratar(resposta: string, mapa: MapaDeSessao): Trecho[] {
  const trechos: Trecho[] = [];
  let cursor = 0;

  for (const achado of resposta.matchAll(RE_ROTULO)) {
    const inicio = achado.index ?? 0;
    if (inicio > cursor) {
      trechos.push({ tipo: "texto", texto: resposta.slice(cursor, inicio) });
    }

    const rotulo = achado[0];
    const valor = mapa.valorDe(rotulo);
    trechos.push(
      valor === null
        ? { tipo: "desconhecido", rotulo }
        : { tipo: "reposto", rotulo, valor }
    );

    cursor = inicio + rotulo.length;
  }

  if (cursor < resposta.length) {
    trechos.push({ tipo: "texto", texto: resposta.slice(cursor) });
  }

  return trechos;
}

/**
 * A política com que o documento foi mascarado, inferida do texto.
 *
 * O cofre não guarda essa informação (`ConteudoDoCofre`, `cofre.ts:66-72`), e
 * `POST /anonymize` não a devolve — ela se perdia entre anonimizar e gravar.
 * Documentos gravados a partir de agora trazem o campo; para o acervo antigo,
 * a presença de um pseudônimo numerado é o que distingue `placeholder` de
 * `parcial` (`J**** d* S****`) e `total` (`*****`), que não servem para
 * conversar: nelas, duas pessoas com as mesmas iniciais viram a mesma coisa.
 */
export function pareceMascaradoComPlaceholder(texto: string): boolean {
  const conhecidos = new Set(Object.values(ROTULO_ENTIDADE));
  for (const achado of texto.matchAll(RE_ROTULO)) {
    if (conhecidos.has(achado[1])) return true;
  }
  return false;
}
