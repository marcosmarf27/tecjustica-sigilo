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

/* A regra de comparação vem da trava, não é reescrita aqui. As duas precisam
   concordar em que conta como valor e onde começa uma palavra: o que o
   arremate fechar com um critério e a trava medir com outro vira bloqueio numa
   ponta sem conserto na outra. `trava.ts` também é puro, então nada de
   `electron` entra por esta porta. */
import {
  MINIMO_VERIFICAVEL,
  ehLetraOuDigito,
  pesoVerificavel,
} from "./trava";

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

  /**
   * Todo valor que esta conversa já sabe ser dado pessoal, na forma comparável.
   *
   * Não devolve o valor real, e é de propósito: quem chama quer procurar
   * aparições e trocá-las pelo rótulo, e para isso a chave normalizada basta.
   * Menos uma função capaz de derramar a tabela de identidades.
   */
  conhecidos(): { chave: string; rotulo: string; tipo: string }[] {
    const lista: { chave: string; rotulo: string; tipo: string }[] = [];
    for (const [tipo, porTipo] of this.numeros) {
      for (const [chave, numero] of porTipo) {
        lista.push({ chave, rotulo: `[${tipo}_${numero}]`, tipo });
      }
    }
    return lista;
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

/**
 * Fecha as aparições que o motor deixou passar.
 *
 * O backend numera pseudônimos **por valor** e substitui **por span**: se o
 * detector achou "FORTALEZA" nas posições 10 e 500 mas perdeu a da 900, a
 * terceira continua em claro no texto que ele chama de anonimizado. É o
 * resíduo que o gate de acurácia mede — 2 escapes em 3.615 ocorrências — e que
 * até agora só importava para quem lia o documento.
 *
 * Passou a importar muito mais: a trava encontra esse resíduo antes do envio e
 * recusa a conversa inteira. Recusar é a resposta certa para um vazamento e a
 * resposta errada para este caso, porque o usuário não tem o que fazer com ela
 * — o dado já estava no arquivo que ele guardou.
 *
 * Então em vez de recusar, fecha-se: toda aparição de um valor **já
 * reconhecido como entidade** vira o rótulo que aquele valor já tem.
 *
 * Isto **não** é o "varredor de resíduo" que o `CLAUDE.md` descarta. Aquele
 * rodaria o motor outra vez, e por definição não acharia o que ele já não
 * achou. Aqui não se detecta nada: usa-se o que o motor decidiu ser entidade e
 * completa-se a aplicação da decisão dele. O que sai da máquina fica mais
 * anonimizado que o arquivo guardado, nunca menos.
 *
 * Trabalha sobre o mapa da conversa inteira, e isso é de propósito: um nome que
 * o detector só pegou na procuração é fechado também na petição.
 */
export interface Arremate {
  texto: string;
  /** Quantas aparições foram fechadas, por tipo. Para a interface dizer. */
  fechados: Record<string, number>;
  /**
   * O que virou o quê, um por rótulo.
   *
   * Existe para a pergunta: o arremate mexe no que o usuário digitou, e mexer
   * no texto de alguém sem mostrar o quê é como o produto perde a confiança de
   * quem assina o documento. Um falso positivo do motor — "os dados" marcado
   * como pessoa — troca uma palavra comum da pergunta por `[PESSOA_7]`, e sem
   * esta lista o usuário só veria o modelo responder coisa estranha.
   */
  trocas: Troca[];
}

export function arrematar(texto: string, mapa: MapaDeSessao): Arremate {
  const alvo = normalizarComIndice(texto);
  const fechados: Record<string, number> = {};

  /* Os rótulos já presentes são território proibido: um valor que por acaso
     casasse dentro de "[PESSOA_11]" partiria o rótulo em dois. */
  const rotulos: [number, number][] = [];
  for (const achado of texto.matchAll(RE_ROTULO)) {
    const inicio = achado.index ?? 0;
    rotulos.push([inicio, inicio + achado[0].length]);
  }

  /* Do mais longo para o mais curto, para que "João da Silva" seja fechado
     antes que "João" o parta pelo meio. `reservado` guarda o que já foi
     tomado, então o casamento curto dentro do longo simplesmente não cabe. */
  const candidatos = mapa
    .conhecidos()
    .filter(({ chave }) => pesoVerificavel(chave) >= MINIMO_VERIFICAVEL)
    .sort((a, b) => b.chave.length - a.chave.length);

  const reservado = new Uint8Array(alvo.texto.length);
  const achados: { de: number; ate: number; rotulo: string; tipo: string }[] = [];

  for (const { chave, rotulo, tipo } of candidatos) {
    let de = alvo.texto.indexOf(chave);
    while (de !== -1) {
      const ate = de + chave.length;
      if (cabe(de, ate, chave, alvo, reservado, rotulos)) {
        reservado.fill(1, de, ate);
        achados.push({
          de: alvo.inicio[de],
          ate: alvo.termino[ate - 1],
          rotulo,
          tipo,
        });
      }
      de = alvo.texto.indexOf(chave, de + 1);
    }
  }

  /* De trás para frente, pelo mesmo motivo de `_aplicar_mascaras`: o rótulo
     quase nunca tem o comprimento do valor. */
  achados.sort((a, b) => b.de - a.de);
  let saida = texto;
  const trocas: Troca[] = [];
  const jaListado = new Set<string>();

  for (const a of achados) {
    /* O recorte sai de `texto`, não de `saida`: os deslocamentos são do texto
       de entrada, e `saida` já encolheu nas substituições anteriores. */
    if (!jaListado.has(a.rotulo)) {
      jaListado.add(a.rotulo);
      trocas.push({ valor: texto.slice(a.de, a.ate), rotulo: a.rotulo });
    }
    saida = saida.slice(0, a.de) + a.rotulo + saida.slice(a.ate);
    fechados[a.tipo] = (fechados[a.tipo] ?? 0) + 1;
  }

  /* Os achados vieram de trás para frente; a lista é lida por gente. */
  trocas.reverse();
  return { texto: saida, fechados, trocas };
}

function cabe(
  de: number,
  ate: number,
  chave: string,
  alvo: TextoNormalizado,
  reservado: Uint8Array,
  rotulos: [number, number][]
): boolean {
  if (ehLetraOuDigito(alvo.texto[de - 1])) return false;
  if (ehLetraOuDigito(alvo.texto[ate])) return false;
  for (let k = de; k < ate; k++) if (reservado[k]) return false;

  const inicioReal = alvo.inicio[de];
  const fimReal = alvo.termino[ate - 1];
  return !rotulos.some(([a, b]) => inicioReal < b && fimReal > a);
}

interface TextoNormalizado {
  texto: string;
  /** Onde cada caractere normalizado começa no texto original. */
  inicio: number[];
  /** Onde cada caractere normalizado termina no texto original. */
  termino: number[];
}

/**
 * `normalizar`, mas guardando de onde veio cada caractere.
 *
 * Sem isso não dá para substituir: a busca acontece na forma comparável — sem
 * acento, minúscula, espaço colapsado — e o recorte tem de acontecer no texto
 * de verdade. Deduzir o deslocamento pela contagem falha exatamente onde a
 * normalização mexeu no comprimento, que é onde há acento ou espaço duplo: as
 * duas coisas que o OCR mais produz.
 */
function normalizarComIndice(texto: string): TextoNormalizado {
  const chars: string[] = [];
  const inicio: number[] = [];
  const termino: number[] = [];

  let i = 0;
  while (i < texto.length) {
    const bruto = String.fromCodePoint(texto.codePointAt(i)!);
    const fim = i + bruto.length;

    if (/^\s$/u.test(bruto)) {
      if (chars.length > 0 && chars[chars.length - 1] !== " ") {
        chars.push(" ");
        inicio.push(i);
        termino.push(fim);
      } else if (chars.length > 0) {
        /* Espaço seguido de espaço: estende o que já está lá, para que o
           recorte cubra a corrida inteira. */
        termino[termino.length - 1] = fim;
      }
    } else {
      const norm = bruto
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .toLowerCase();
      for (const c of norm) {
        chars.push(c);
        inicio.push(i);
        termino.push(fim);
      }
    }

    i = fim;
  }

  return { texto: chars.join(""), inicio, termino };
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
