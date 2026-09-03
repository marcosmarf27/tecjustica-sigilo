import { describe, expect, test } from "vitest";
import { agruparPorTipo, segmentar } from "./Revisao";
import type { EntityFound } from "../types";

/**
 * A identidade de uma ocorrência, do texto até a lista lateral.
 *
 * ## Por que este arquivo existe
 *
 * A tela de Revisão numerava a mesma ocorrência de dois jeitos: a lista lateral
 * por `entitiesFound.indexOf(entidade)` — posição no array original — e a tarja
 * no texto por `data-ocorrencia={seg.indice}`, que era a posição no array
 * **ordenado e filtrado** do `segmentar`. Clicar no CPF na lista levava à tarja
 * do nome.
 *
 * É o pior tipo de defeito para este produto porque não parece defeito: os dois
 * números existem, são válidos, e apontam para coisas diferentes. Nada estoura.
 * O revisor clica na ocorrência 12, o texto rola até outra, e ele acredita ter
 * auditado a que pediu — num aplicativo cuja função é justamente garantir que
 * alguém conferiu.
 *
 * Nenhum teste pegava isso porque não havia teste nenhum de renderer. Estes são
 * os primeiros.
 */

function ent(start: number, end: number, type: string, text = ""): EntityFound {
  return { start, end, type, text, score: 0.99 } as EntityFound;
}

/* Um trecho com a cara do que sai do OCR de uma petição. */
const TEXTO = "CPF 529.982.247-25 de JOAQUINA FERREIRA, OAB/CE 12.345, CEP 60150-160.";

describe("segmentar", () => {
  test("o índice do segmento é o da lista ORIGINAL, não o da ordenada", () => {
    /* Ordem como o motor devolve de verdade: nada garante que venha ordenada
       por posição no texto. Aqui o nome vem antes do CPF. */
    const entidades = [
      ent(22, 39, "PERSON", "JOAQUINA FERREIRA"),
      ent(4, 18, "CPF_BR", "529.982.247-25"),
      ent(56, 65, "CEP_BR", "CEP 60150"),
      ent(41, 54, "OAB_BR", "OAB/CE 12.345"),
    ];

    const tarjas = segmentar(TEXTO, entidades).filter((s) => s.tipo === "entidade");

    for (const tarja of tarjas) {
      expect(
        tarja.indice,
        `a tarja de "${tarja.conteudo}" precisa apontar para a mesma posição que a lista lateral usa`
      ).toBe(entidades.indexOf(tarja.entidade));
    }
  });

  test("descartar uma ocorrência não desloca o índice das seguintes", () => {
    /* Duas são descartadas: uma com faixa impossível e uma sobreposta. Na
       versão antiga, cada descarte empurrava todas as posteriores em um. */
    const entidades = [
      ent(4, 18, "CPF_BR", "529.982.247-25"),
      ent(900, 999, "CPF_BR", "fora do texto"), // faixa inválida
      ent(22, 39, "PERSON", "JOAQUINA FERREIRA"),
      ent(30, 39, "PERSON", "FERREIRA"), // sobreposta com a anterior
      ent(41, 54, "OAB_BR", "OAB/CE 12.345"),
    ];

    const tarjas = segmentar(TEXTO, entidades).filter((s) => s.tipo === "entidade");

    expect(tarjas).toHaveLength(3);
    for (const tarja of tarjas) {
      expect(tarja.indice).toBe(entidades.indexOf(tarja.entidade));
    }
  });

  test("o conteúdo da tarja é o trecho que ela cobre", () => {
    /* Se os offsets do motor deixassem de ser relativos ao texto original, a
       tarja mostraria outro trecho — e o revisor conferiria a coisa errada
       achando que conferiu a certa. */
    const entidades = [ent(4, 18, "CPF_BR"), ent(22, 39, "PERSON")];
    const tarjas = segmentar(TEXTO, entidades).filter((s) => s.tipo === "entidade");

    expect(tarjas.map((t) => t.conteudo)).toEqual([
      "529.982.247-25",
      "JOAQUINA FERREIRA",
    ]);
  });

  test("o texto sai inteiro, na ordem, sem perder nem duplicar nada", () => {
    /* A garantia que sustenta a tela: juntar os segmentos tem de devolver o
       documento. Um segmento a mais ou a menos apagaria ou repetiria texto do
       processo na tela de conferência. */
    const entidades = [
      ent(22, 39, "PERSON"),
      ent(4, 18, "CPF_BR"),
      ent(30, 39, "PERSON"), // sobreposta, descartada
      ent(56, 65, "CEP_BR"),
      ent(41, 54, "OAB_BR"),
    ];

    const juntado = segmentar(TEXTO, entidades)
      .map((s) => s.conteudo)
      .join("");

    expect(juntado).toBe(TEXTO);
  });

  test("sem ocorrências, o texto sai como um segmento só", () => {
    expect(segmentar(TEXTO, [])).toEqual([{ tipo: "texto", conteudo: TEXTO }]);
  });

  test("faixa invertida ou vazia é descartada em vez de quebrar o texto", () => {
    const entidades = [ent(18, 4, "CPF_BR"), ent(10, 10, "PERSON")];
    const segmentos = segmentar(TEXTO, entidades);

    expect(segmentos.every((s) => s.tipo === "texto")).toBe(true);
    expect(segmentos.map((s) => s.conteudo).join("")).toBe(TEXTO);
  });
});

/**
 * O agrupamento por tipo, que substituiu a faixa de chips de filtro.
 *
 * Estes testes existem pelo mesmo motivo dos de cima, e o risco é maior: com a
 * ordenação por confiança, a posição de um item na lista não guarda nenhuma
 * relação com a posição dele no texto. Um índice deduzido da ordem de exibição
 * — o caminho natural de quem mexer nisto depois — apontaria para outra tarja,
 * e nada estouraria.
 */
describe("agruparPorTipo", () => {
  const ent = (type: string, start: number, score: number): EntityFound => ({
    type,
    text: `${type}@${start}`,
    start,
    end: start + 4,
    score,
  });

  test("o índice é o da lista original, não o da posição no grupo", () => {
    // PERSON aparece nas posições 0 e 2 da lista; CPF na 1.
    const entidades = [ent("PERSON", 0, 0.9), ent("CPF", 10, 0.8), ent("PERSON", 20, 0.7)];
    const grupos = agruparPorTipo(entidades);

    const pessoas = grupos.find((g) => g.tipo === "PERSON")!;
    expect(pessoas.itens.map((i) => i.indice)).toEqual([0, 2]);
    expect(grupos.find((g) => g.tipo === "CPF")!.itens[0].indice).toBe(1);
  });

  test("reordenar por confiança não mexe no índice de ninguém", () => {
    const entidades = [ent("PERSON", 0, 0.99), ent("PERSON", 10, 0.40), ent("PERSON", 20, 0.70)];
    const grupos = agruparPorTipo(entidades, true);
    const itens = grupos[0].itens;

    // A ordem de exibição muda: o mais fraco primeiro.
    expect(itens.map((i) => i.entidade.score)).toEqual([0.4, 0.7, 0.99]);
    // O índice acompanha a ocorrência, não a posição na lista.
    expect(itens.map((i) => i.indice)).toEqual([1, 2, 0]);
  });

  test("cada índice ainda encontra a sua própria ocorrência", () => {
    const entidades = [ent("PERSON", 0, 0.5), ent("CPF", 10, 0.9), ent("PERSON", 20, 0.1)];
    for (const { itens } of agruparPorTipo(entidades, true)) {
      for (const { entidade, indice } of itens) {
        expect(entidades[indice]).toBe(entidade);
      }
    }
  });

  test("o tipo mais numeroso vem primeiro, como os chips faziam", () => {
    const entidades = [ent("CPF", 0, 0.9), ent("PERSON", 10, 0.9), ent("PERSON", 20, 0.9)];
    expect(agruparPorTipo(entidades).map((g) => g.tipo)).toEqual(["PERSON", "CPF"]);
  });

  test("sem ocorrências não há grupo", () => {
    expect(agruparPorTipo([])).toEqual([]);
  });
});
