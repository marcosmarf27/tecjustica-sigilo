/**
 * Converte o markdown anonimizado em um DOCX que abre no Word.
 *
 * O extrator devolve markdown: `## Página N` como separador, tabelas em
 * pipes, o resto em parágrafos. Aqui isso vira um documento de verdade — não
 * um arquivo de texto com extensão trocada, que foi o defeito que motivou este
 * módulo.
 *
 * A conversão é deliberadamente conservadora. Um auto anonimizado é entregue
 * para conferência humana, e inventar estrutura que não estava lá atrapalha
 * mais do que ajuda: sem ênfase adivinhada, sem listas reconstruídas, sem
 * numeração automática. O que existe é o que dá para afirmar com o texto na
 * mão — página, tabela e parágrafo.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const SEPARADOR_TABELA = /^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)*\|?\s*$/;

function celulas(linha: string): string[] {
  return linha
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function montarTabela(linhas: string[]): Table {
  const corpo = linhas.filter((l) => !SEPARADOR_TABELA.test(l));
  const largura = Math.max(...corpo.map((l) => celulas(l).length), 1);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: corpo.map((linha, indice) => {
      const valores = celulas(linha);
      while (valores.length < largura) valores.push("");
      return new TableRow({
        children: valores.map(
          (valor) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: valor, bold: indice === 0 })],
                }),
              ],
            })
        ),
      });
    }),
  });
}

/**
 * O markdown vira blocos do DOCX.
 *
 * Trata só o que o extrator realmente produz. Marcação que ele não gera é
 * deixada como texto — melhor um `*` visível do que um trecho sumido.
 */
function blocos(markdown: string): (Paragraph | Table)[] {
  const saida: (Paragraph | Table)[] = [];
  const linhas = markdown.split(/\r?\n/);
  let tabela: string[] = [];

  const fecharTabela = () => {
    if (tabela.length) {
      saida.push(montarTabela(tabela));
      // O Word cola o parágrafo seguinte na tabela sem um respiro.
      saida.push(new Paragraph({ text: "" }));
      tabela = [];
    }
  };

  for (const linha of linhas) {
    const texto = linha.trimEnd();

    if (texto.trimStart().startsWith("|")) {
      tabela.push(texto);
      continue;
    }
    fecharTabela();

    if (!texto.trim()) {
      saida.push(new Paragraph({ text: "" }));
      continue;
    }

    const titulo = texto.match(/^(#{1,4})\s+(.*)$/);
    if (titulo) {
      const nivel = titulo[1].length;
      saida.push(
        new Paragraph({
          text: titulo[2],
          heading:
            nivel === 1
              ? HeadingLevel.HEADING_1
              : nivel === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        })
      );
      continue;
    }

    saida.push(
      new Paragraph({
        children: [new TextRun(texto)],
        alignment: AlignmentType.LEFT,
      })
    );
  }
  fecharTabela();
  return saida;
}

export interface CabecalhoDocx {
  nomeOriginal: string;
  ocorrencias: number;
  paginasOcr?: number;
  paginasComErro?: number;
}

/**
 * O cabeçalho existe para o documento não poder ser confundido com o original.
 *
 * Um auto anonimizado que circula sem dizer que é anonimizado é um problema de
 * outra natureza: quem recebe precisa saber que há texto mascarado, e que
 * página lida por reconhecimento pode ter erro.
 */
function cabecalho(info: CabecalhoDocx): Paragraph[] {
  const linhas = [
    `Documento anonimizado — ${info.nomeOriginal}`,
    `${info.ocorrencias} ${info.ocorrencias === 1 ? "ocorrência mascarada" : "ocorrências mascaradas"}.`,
  ];
  if (info.paginasOcr) {
    linhas.push(
      `${info.paginasOcr} ${info.paginasOcr === 1 ? "página lida" : "páginas lidas"} por reconhecimento de imagem — o reconhecimento erra; confira.`
    );
  }
  if (info.paginasComErro) {
    linhas.push(
      `ATENÇÃO: ${info.paginasComErro} ${info.paginasComErro === 1 ? "página não foi lida" : "páginas não foram lidas"}. O texto delas não está aqui.`
    );
  }

  return [
    ...linhas.map(
      (texto, i) =>
        new Paragraph({
          children: [new TextRun({ text: texto, bold: i === 0, size: 18 })],
          spacing: { after: i === linhas.length - 1 ? 240 : 40 },
        })
    ),
  ];
}

export async function gerarDocx(
  markdown: string,
  info: CabecalhoDocx
): Promise<Blob> {
  const documento = new Document({
    creator: "TecJustiça Sigilo",
    title: `${info.nomeOriginal} (anonimizado)`,
    description: "Documento com dados pessoais mascarados",
    sections: [
      {
        properties: {},
        children: [...cabecalho(info), ...blocos(markdown)],
      },
    ],
  });
  return Packer.toBlob(documento);
}
