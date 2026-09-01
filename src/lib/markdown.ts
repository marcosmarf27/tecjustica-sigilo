/**
 * O markdown que um modelo de linguagem escreve, e só ele.
 *
 * Não é um parser de markdown de propósito geral, e não deve virar um. O que
 * chega aqui é a resposta de um modelo sobre autos de processo: cabeçalhos,
 * negrito em rótulo de campo, listas, uma tabela ocasional e blocos de código
 * raros. Referência de nota de rodapé, HTML embutido e lista de definição não
 * aparecem, e suportá-las custaria complexidade sem leitor.
 *
 * Duas escolhas que divergem do CommonMark, as duas porque o gerador do texto
 * não é uma pessoa escrevendo markdown:
 *
 * 1. **Quebra simples é quebra de linha.** No CommonMark, duas linhas seguidas
 *    viram um parágrafo só. Modelos escrevem "**Juízo:** …\n**Partes:** …"
 *    contando que cada campo fique na sua linha, e juntá-las numa corrida só
 *    destrói justamente a estrutura que a resposta tinha. É o mesmo que o
 *    GitHub faz com `breaks`.
 *
 * 2. **`[PESSOA_1]` não é link.** O CommonMark trata `[texto]` como referência
 *    de link, e aqui colchete com underscore e número é a coisa mais comum do
 *    texto inteiro. Só vira link o que tiver `(url)` logo depois.
 *
 * A análise é separada da renderização (`componentes/Markdown.tsx`) porque é
 * ela que tem lógica e é ela que precisa de teste. O componente só escolhe
 * tipografia.
 */

export type Inline =
  | { tipo: "texto"; texto: string }
  | { tipo: "forte"; filhos: Inline[] }
  | { tipo: "enfase"; filhos: Inline[] }
  | { tipo: "riscado"; filhos: Inline[] }
  | { tipo: "codigo"; texto: string }
  /** O rótulo vai junto: um link não navega daqui, só mostra para onde iria. */
  | { tipo: "link"; texto: string; destino: string };

export type Bloco =
  | { tipo: "paragrafo"; filhos: Inline[] }
  | { tipo: "titulo"; nivel: number; filhos: Inline[] }
  | { tipo: "lista"; ordenada: boolean; itens: Inline[][]; inicio: number }
  | { tipo: "citacao"; filhos: Inline[] }
  | { tipo: "codigo"; texto: string; lingua: string }
  | { tipo: "tabela"; cabecalho: Inline[][]; linhas: Inline[][][] }
  | { tipo: "regra" };

const RE_TITULO = /^(#{1,6})\s+(.*)$/;
const RE_ITEM_SOLTO = /^\s*[-*+]\s+(.*)$/;
const RE_ITEM_NUMERADO = /^\s*(\d+)[.)]\s+(.*)$/;
const RE_CITACAO = /^\s*>\s?(.*)$/;
const RE_REGRA = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_CERCA = /^\s*```(.*)$/;
/** Linha de tabela: começa e termina em `|`, com pelo menos uma divisão. */
const RE_TABELA = /^\s*\|(.+)\|\s*$/;
/** A segunda linha de uma tabela, que só tem traços, dois-pontos e barras. */
const RE_TABELA_SEP = /^\s*\|[\s:|-]+\|\s*$/;

export function analisarBlocos(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const blocos: Bloco[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    if (linha.trim() === "") {
      i++;
      continue;
    }

    /* Cerca de código primeiro: dentro dela nada mais é sintaxe, e um `#` ou
       um `|` no meio de um trecho de código não pode virar título nem tabela. */
    const cerca = RE_CERCA.exec(linha);
    if (cerca) {
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !RE_CERCA.test(linhas[i])) {
        corpo.push(linhas[i]);
        i++;
      }
      /* Cerca sem fechamento acontece quando a resposta ainda está chegando —
         o bloco vale assim mesmo, senão o código pisca a cada pedaço novo. */
      if (i < linhas.length) i++;
      blocos.push({
        tipo: "codigo",
        texto: corpo.join("\n"),
        lingua: cerca[1].trim(),
      });
      continue;
    }

    if (RE_REGRA.test(linha)) {
      blocos.push({ tipo: "regra" });
      i++;
      continue;
    }

    const titulo = RE_TITULO.exec(linha);
    if (titulo) {
      blocos.push({
        tipo: "titulo",
        nivel: titulo[1].length,
        filhos: analisarInline(titulo[2].trim()),
      });
      i++;
      continue;
    }

    /* Tabela: exige a linha de separação logo abaixo. Sem ela, uma frase com
       barras verticais viraria uma tabela de uma coluna só. */
    if (RE_TABELA.test(linha) && i + 1 < linhas.length && RE_TABELA_SEP.test(linhas[i + 1])) {
      const cabecalho = celulas(linha);
      i += 2;
      const corpo: Inline[][][] = [];
      while (i < linhas.length && RE_TABELA.test(linhas[i])) {
        corpo.push(celulas(linhas[i]));
        i++;
      }
      blocos.push({ tipo: "tabela", cabecalho, linhas: corpo });
      continue;
    }

    const citacao = RE_CITACAO.exec(linha);
    if (citacao) {
      const corpo = [citacao[1]];
      i++;
      while (i < linhas.length) {
        const seguinte = RE_CITACAO.exec(linhas[i]);
        if (!seguinte) break;
        corpo.push(seguinte[1]);
        i++;
      }
      blocos.push({ tipo: "citacao", filhos: analisarInline(corpo.join("\n")) });
      continue;
    }

    if (RE_ITEM_SOLTO.test(linha) || RE_ITEM_NUMERADO.test(linha)) {
      const ordenada = RE_ITEM_NUMERADO.test(linha);
      const primeiro = RE_ITEM_NUMERADO.exec(linha);
      const inicio = primeiro ? Number(primeiro[1]) : 1;
      const itens: Inline[][] = [];

      while (i < linhas.length) {
        const solto = RE_ITEM_SOLTO.exec(linhas[i]);
        const numerado = RE_ITEM_NUMERADO.exec(linhas[i]);
        /* Um item de outra espécie encerra a lista: misturar "-" e "1." na
           mesma lista trocaria os marcadores no meio. */
        if (ordenada ? !numerado : !solto) break;
        itens.push(analisarInline((numerado ? numerado[2] : solto![1]).trim()));
        i++;
      }

      blocos.push({ tipo: "lista", ordenada, itens, inicio });
      continue;
    }

    /* Parágrafo: junta as linhas seguintes até esbarrar em linha vazia ou em
       algo que comece outro bloco. */
    const corpo = [linha];
    i++;
    while (i < linhas.length && linhas[i].trim() !== "" && !comecaBloco(linhas[i])) {
      corpo.push(linhas[i]);
      i++;
    }
    blocos.push({ tipo: "paragrafo", filhos: analisarInline(corpo.join("\n")) });
  }

  return blocos;
}

function comecaBloco(linha: string): boolean {
  return (
    RE_TITULO.test(linha) ||
    RE_ITEM_SOLTO.test(linha) ||
    RE_ITEM_NUMERADO.test(linha) ||
    RE_CITACAO.test(linha) ||
    RE_REGRA.test(linha) ||
    RE_CERCA.test(linha) ||
    RE_TABELA.test(linha)
  );
}

function celulas(linha: string): Inline[][] {
  const dentro = RE_TABELA.exec(linha)![1];
  return dentro.split("|").map((c) => analisarInline(c.trim()));
}

/* Ordem importa: o código cru vem primeiro porque dentro dele nada mais é
   sintaxe, e o negrito antes da ênfase porque `**` também casa `*`.

   `soltaSo` é a regra que o CommonMark tem para o sublinhado e não tem para o
   asterisco, e ela existe para não estragar `snake_case`. Aqui ela vale muito
   mais que isso: **`[PESSOA_1]` é snake_case**. Sem a regra, o `_` de
   `PESSOA_1` abre uma ênfase que se fecha no `_` de `CPF_2` — e a frase chega
   ao leitor como "[PESSOA1] e [CPF2]", com os dois pseudônimos adulterados e
   nenhum sinal de que algo deu errado. Foi o que a primeira versão fez, e o
   teste dos dois pseudônimos pegou. */
const MARCAS: {
  abre: string;
  fecha: string;
  tipo: "forte" | "enfase" | "riscado";
  /** Só marca quando as pontas não encostam em letra ou dígito. */
  soltaSo?: boolean;
}[] = [
  { abre: "**", fecha: "**", tipo: "forte" },
  { abre: "__", fecha: "__", tipo: "forte", soltaSo: true },
  { abre: "~~", fecha: "~~", tipo: "riscado" },
  { abre: "*", fecha: "*", tipo: "enfase" },
  { abre: "_", fecha: "_", tipo: "enfase", soltaSo: true },
];

function ehPalavra(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

export function analisarInline(texto: string): Inline[] {
  const saida: Inline[] = [];
  let acumulado = "";
  let i = 0;

  const despejar = () => {
    if (acumulado) {
      saida.push({ tipo: "texto", texto: acumulado });
      acumulado = "";
    }
  };

  while (i < texto.length) {
    const c = texto[i];

    if (c === "\\" && i + 1 < texto.length) {
      /* Escape: o próximo caractere é literal. Modelos usam para "\*" e "\_". */
      acumulado += texto[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const fim = texto.indexOf("`", i + 1);
      if (fim > i + 1) {
        despejar();
        saida.push({ tipo: "codigo", texto: texto.slice(i + 1, fim) });
        i = fim + 1;
        continue;
      }
    }

    /* Link só com destino entre parênteses logo depois. `[PESSOA_1]` sozinho é
       o pseudônimo mais comum do texto e não pode virar link nem sumir. */
    if (c === "[") {
      const fecha = texto.indexOf("]", i + 1);
      if (fecha !== -1 && texto[fecha + 1] === "(") {
        const fimUrl = texto.indexOf(")", fecha + 2);
        if (fimUrl !== -1) {
          despejar();
          saida.push({
            tipo: "link",
            texto: texto.slice(i + 1, fecha),
            destino: texto.slice(fecha + 2, fimUrl),
          });
          i = fimUrl + 1;
          continue;
        }
      }
    }

    const marca = MARCAS.find(
      (m) =>
        texto.startsWith(m.abre, i) && !(m.soltaSo && ehPalavra(texto[i - 1]))
    );
    if (marca) {
      const fim = texto.indexOf(marca.fecha, i + marca.abre.length);
      /* Precisa ter conteúdo: "**" colado não abre nada, e "a * b" também não
         — asterisco solto é multiplicação, não ênfase. */
      if (fim > i + marca.abre.length) {
        const dentro = texto.slice(i + marca.abre.length, fim);
        const depois = texto[fim + marca.fecha.length];
        if (dentro.trim() !== "" && !(marca.soltaSo && ehPalavra(depois))) {
          despejar();
          saida.push({ tipo: marca.tipo, filhos: analisarInline(dentro) });
          i = fim + marca.fecha.length;
          continue;
        }
      }
    }

    acumulado += c;
    i++;
  }

  despejar();
  return saida;
}

/* ------------------------------------------------------------------------ */

/** Um pedaço de texto, ou um pseudônimo a repor. */
export type Pedaco =
  | { tipo: "texto"; texto: string }
  | { tipo: "rotulo"; rotulo: string };

/**
 * Parte um texto nos pseudônimos que ele contém.
 *
 * Mora aqui, e não dentro do componente, porque é a peça que erra em silêncio:
 * quando ela pula um rótulo, a tela mostra `[PESSOA_1]` em vez do nome. Nada
 * estoura, ninguém é avisado, e a resposta continua parecendo correta — só sem
 * o nome de uma das pessoas.
 *
 * **A regex é criada a cada chamada, de propósito.** Com a flag `g`, uma regex
 * de módulo carrega `lastIndex` entre chamadas, e `String.matchAll` clona o
 * objeto **copiando esse índice**. Um `.test()` de atalho antes do laço — que é
 * o que a primeira versão fazia — deixava `lastIndex` depois do primeiro match,
 * e a varredura começava dali: **o primeiro pseudônimo de cada trecho ficava
 * cru**, os demais eram repostos. Custa uma compilação de regex por trecho e
 * elimina a classe inteira.
 */
export function partirPorRotulo(texto: string): Pedaco[] {
  const re = /\[(\p{Lu}+(?:_\p{Lu}+)*)_(\d+)\]/gu;
  const pedacos: Pedaco[] = [];
  let cursor = 0;

  for (const achado of texto.matchAll(re)) {
    const inicio = achado.index ?? 0;
    if (inicio > cursor) {
      pedacos.push({ tipo: "texto", texto: texto.slice(cursor, inicio) });
    }
    pedacos.push({ tipo: "rotulo", rotulo: achado[0] });
    cursor = inicio + achado[0].length;
  }

  if (cursor < texto.length) {
    pedacos.push({ tipo: "texto", texto: texto.slice(cursor) });
  }
  return pedacos;
}
