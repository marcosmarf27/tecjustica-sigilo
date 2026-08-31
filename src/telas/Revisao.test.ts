import { describe, expect, test } from "vitest";
import { segmentar } from "./Revisao";
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
