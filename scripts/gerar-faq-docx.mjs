/**
 * Gera o DOCX do FAQ institucional a partir de `docs/faq-institucional.md`.
 *
 *   node scripts/gerar-faq-docx.mjs [saida.docx]
 *
 * O markdown é a fonte da verdade e o DOCX é derivado — nunca o contrário. Quem
 * corrigir uma resposta mexe no `.md` e roda isto de novo; editar o DOCX à mão
 * cria a segunda cópia que envelhece em silêncio, que é o defeito que o
 * `AGENTS.md` deste repositório descreve.
 *
 * Por que não reusar `src/lib/gerarDocx.ts`: aquele módulo é o escritor de
 * documento ANONIMIZADO do produto. Ele carimba de propósito um cabeçalho
 * dizendo "Documento anonimizado — N ocorrências mascaradas", que é exatamente o
 * que não pode aparecer num FAQ, e devolve `Blob` (navegador) em vez de
 * `Buffer` (Node). O que os dois têm em comum — markdown vira parágrafo,
 * título e tabela — é pequeno perto do que os separa.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRADA = resolve(RAIZ, "docs/faq-institucional.md");
const SAIDA = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(RAIZ, "FAQ-TecJustica-Sigilo.docx");

const SEPARADOR_TABELA = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const CINZA = "F2F0EB";

/**
 * Quebra uma linha em pedaços com formatação.
 *
 * Trata só o que o FAQ usa — negrito, `código` e [texto](url) —, e devolve
 * `TextRun`/`ExternalHyperlink`. Marcação não reconhecida fica como texto
 * literal: melhor um asterisco visível do que um trecho sumido.
 */
function trechos(texto, base = {}) {
  const saida = [];
  const padrao = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let fim = 0;

  for (const achado of texto.matchAll(padrao)) {
    if (achado.index > fim) {
      saida.push(new TextRun({ ...base, text: texto.slice(fim, achado.index) }));
    }
    const [, negrito, codigo, rotulo, url] = achado;
    if (negrito !== undefined) {
      saida.push(new TextRun({ ...base, text: negrito, bold: true }));
    } else if (codigo !== undefined) {
      saida.push(
        new TextRun({ ...base, text: codigo, font: "Consolas", size: 19 })
      );
    } else {
      saida.push(
        new ExternalHyperlink({
          link: url,
          children: [
            new TextRun({ ...base, text: rotulo, style: "Hyperlink" }),
          ],
        })
      );
    }
    fim = achado.index + achado[0].length;
  }
  if (fim < texto.length) {
    saida.push(new TextRun({ ...base, text: texto.slice(fim) }));
  }
  return saida.length ? saida : [new TextRun({ ...base, text: "" })];
}

function celulas(linha) {
  return linha
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * A primeira linha só é cabeçalho se tiver conteúdo.
 *
 * Várias tabelas do FAQ abrem com `| | |` de propósito — são pares
 * rótulo/valor, não tabelas com título de coluna. Sombrear uma faixa vazia
 * anuncia um cabeçalho que não existe.
 */
function montarTabela(linhas) {
  const corpo = linhas.filter((l) => !SEPARADOR_TABELA.test(l));
  const largura = Math.max(...corpo.map((l) => celulas(l).length), 1);
  const temCabecalho = celulas(corpo[0] ?? "").some((c) => c !== "");

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: corpo.map((linha, indice) => {
      const valores = celulas(linha);
      while (valores.length < largura) valores.push("");
      const cabecalho = temCabecalho && indice === 0;
      return new TableRow({
        tableHeader: cabecalho,
        children: valores.map(
          (valor) =>
            new TableCell({
              shading: cabecalho
                ? { type: ShadingType.CLEAR, fill: CINZA }
                : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  spacing: { before: 20, after: 20 },
                  children: trechos(valor, cabecalho ? { bold: true } : {}),
                }),
              ],
            })
        ),
      });
    }),
  });
}

function blocos(markdown) {
  const saida = [];
  const linhas = markdown.split(/\r?\n/);
  let tabela = [];
  let codigo = null;

  const fecharTabela = () => {
    if (!tabela.length) return;
    saida.push(montarTabela(tabela));
    // O Word cola o parágrafo seguinte na tabela sem um respiro.
    saida.push(new Paragraph({ text: "", spacing: { after: 120 } }));
    tabela = [];
  };

  for (const bruta of linhas) {
    const linha = bruta.trimEnd();

    if (linha.trimStart().startsWith("```")) {
      if (codigo === null) {
        fecharTabela();
        codigo = [];
      } else {
        for (const l of codigo) {
          saida.push(
            new Paragraph({
              spacing: { before: 0, after: 0 },
              shading: { type: ShadingType.CLEAR, fill: CINZA },
              children: [new TextRun({ text: l, font: "Consolas", size: 18 })],
            })
          );
        }
        saida.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        codigo = null;
      }
      continue;
    }
    if (codigo !== null) {
      codigo.push(linha);
      continue;
    }

    if (linha.trimStart().startsWith("|")) {
      tabela.push(linha);
      continue;
    }
    fecharTabela();

    if (!linha.trim()) {
      saida.push(new Paragraph({ text: "", spacing: { after: 60 } }));
      continue;
    }

    // Régua horizontal: no Word não existe "hr", então vira uma borda de baixo.
    if (/^---+$/.test(linha.trim())) {
      saida.push(
        new Paragraph({
          text: "",
          spacing: { before: 120, after: 180 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
          },
        })
      );
      continue;
    }

    const titulo = linha.match(/^(#{1,4})\s+(.*)$/);
    if (titulo) {
      const nivel = titulo[1].length;
      saida.push(
        new Paragraph({
          heading:
            nivel === 1
              ? HeadingLevel.HEADING_1
              : nivel === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          spacing: { before: nivel <= 2 ? 320 : 240, after: 120 },
          keepNext: true,
          children: trechos(titulo[2]),
        })
      );
      continue;
    }

    const citacao = linha.match(/^>\s?(.*)$/);
    if (citacao) {
      saida.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 340 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: "999999", space: 12 },
          },
          children: trechos(citacao[1], { italics: true }),
        })
      );
      continue;
    }

    const lista = linha.match(/^\s*[-*]\s+(.*)$/);
    if (lista) {
      saida.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
          children: trechos(lista[1]),
        })
      );
      continue;
    }

    const numerada = linha.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numerada) {
      saida.push(
        new Paragraph({
          indent: { left: 340, hanging: 220 },
          spacing: { before: 40, after: 40 },
          children: trechos(`${numerada[1]}. ${numerada[2]}`),
        })
      );
      continue;
    }

    // Continuação de item de lista: o markdown quebra em 80 colunas, e o Word
    // não deve herdar essas quebras como parágrafos soltos.
    const anterior = saida[saida.length - 1];
    if (/^\s{2,}\S/.test(bruta) && anterior instanceof Paragraph) {
      saida.push(
        new Paragraph({
          indent: { left: 340 },
          spacing: { before: 0, after: 40 },
          children: trechos(linha.trim()),
        })
      );
      continue;
    }

    saida.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 60, after: 60, line: 280 },
        children: trechos(linha),
      })
    );
  }
  fecharTabela();
  return saida;
}

function capa() {
  return [
    new Paragraph({ text: "", spacing: { after: 1200 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: "TecJustiça Sigilo", bold: true, size: 56 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: "Perguntas e respostas para avaliação institucional",
          size: 28,
          color: "555555",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: "Anonimizador de dados pessoais em peças processuais",
          size: 22,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: "Execução local · software livre (MIT) · sem infraestrutura",
          size: 22,
          color: "555555",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ExternalHyperlink({
          link: "https://github.com/marcosmarf27/tecjustica-sigilo",
          children: [
            new TextRun({
              text: "github.com/marcosmarf27/tecjustica-sigilo",
              size: 20,
              style: "Hyperlink",
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ text: "", pageBreakBefore: false, spacing: { after: 240 } }),
  ];
}

const markdown = readFileSync(ENTRADA, "utf8");
const documento = new Document({
  creator: "TecJustiça Sigilo",
  title: "FAQ institucional — TecJustiça Sigilo",
  description:
    "Perguntas e respostas sobre segurança, conformidade, acurácia e implantação",
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21 } },
      heading1: {
        run: { font: "Calibri", size: 34, bold: true, color: "1A1A1A" },
      },
      heading2: {
        run: { font: "Calibri", size: 27, bold: true, color: "1A1A1A" },
      },
      heading3: {
        run: { font: "Calibri", size: 23, bold: true, color: "333333" },
      },
    },
  },
  sections: [
    {
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [...capa(), ...blocos(markdown)],
    },
  ],
});

const buffer = await Packer.toBuffer(documento);
writeFileSync(SAIDA, buffer);
console.log(`FAQ gerado: ${SAIDA} (${(buffer.length / 1024).toFixed(0)} KB)`);
