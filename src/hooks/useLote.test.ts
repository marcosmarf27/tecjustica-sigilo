import { describe, expect, test } from "vitest";
import { mensagemDoLote } from "./useLote";
import type { ProcessedFile } from "../types";

/**
 * O que o lote diz quando termina.
 *
 * Esta é a única coisa que o usuário recebe sobre um lote que não deu certo, e
 * hoje ela deixou de aparecer três vezes: o laço tinha linhas fora do `try` por
 * arquivo, o `App` não tratava exceção do lote, e não havia barreira de erro
 * nenhuma no renderer. Nos três casos a tela de progresso fechava e o
 * aplicativo voltava para a Mesa **calado** — porque esta mensagem é montada
 * depois do `await`, e o `await` nunca retornava.
 *
 * Daí a regra que estes testes travam: **nome e motivo, sempre**. "Não deu"
 * deixa quem opera sem saber se tenta de novo, troca o arquivo ou reabre o
 * aplicativo.
 */

function arquivo(nome: string): ProcessedFile {
  return {
    originalName: nome,
    originalPath: `C:\\autos\\${nome}`,
    originalContent: "",
    anonymizedContent: "",
    entitiesFound: [],
  } as ProcessedFile;
}

describe("mensagemDoLote", () => {
  test("lote inteiro bem-sucedido não gera aviso", () => {
    /* Silêncio aqui é certo: a tela de revisão abrindo já é a confirmação. */
    const r = { processados: [arquivo("a.pdf")], falhas: [], cancelado: false };
    expect(mensagemDoLote(r, 1)).toBeNull();
  });

  test("com um arquivo só, o motivo é a mensagem inteira", () => {
    const r = {
      processados: [],
      falhas: [{ nome: "autos.pdf", motivo: "formato não suportado: .conf" }],
      cancelado: false,
    };
    const aviso = mensagemDoLote(r, 1);
    expect(aviso?.tipo).toBe("erro");
    expect(aviso?.mensagem).toContain("formato não suportado: .conf");
  });

  test("falha parcial diz quantos passaram E o motivo de cada um", () => {
    /* Sem a contagem, quem recebe "não deu" não sabe que 4 dos 6 estão prontos
       e prontos para salvar. */
    const r = {
      processados: [arquivo("a.pdf"), arquivo("b.pdf")],
      falhas: [
        { nome: "c.pdf", motivo: "Perdi contato com o processamento" },
        { nome: "d.pdf", motivo: "arquivo vazio" },
      ],
      cancelado: false,
    };
    const aviso = mensagemDoLote(r, 4);
    expect(aviso?.mensagem).toContain("2 de 4 processados");
    expect(aviso?.mensagem).toContain("c.pdf: Perdi contato com o processamento");
    expect(aviso?.mensagem).toContain("d.pdf: arquivo vazio");
  });

  test("cancelamento não é falha, e vence qualquer outra mensagem", () => {
    /* Quem clicou em Cancelar sabe o que fez; listar os arquivos que não
       chegaram a rodar como se fossem defeitos seria ruído. */
    const r = {
      processados: [arquivo("a.pdf")],
      falhas: [{ nome: "b.pdf", motivo: "cancelado"} ],
      cancelado: true,
    };
    expect(mensagemDoLote(r, 6)?.mensagem).toBe("Anonimização cancelada.");
  });

  test("todos falhando NÃO some em silêncio", () => {
    /* O caso relatado: seis documentos, nada processado, e a tela voltando para
       a Mesa. Com zero processados o `App` não abre a revisão — então esta
       mensagem é a única coisa que o usuário recebe. Ela não pode ser nula. */
    const r = {
      processados: [],
      falhas: Array.from({ length: 6 }, (_, i) => ({
        nome: `doc${i}.pdf`,
        motivo: "Perdi contato com o processamento",
      })),
      cancelado: false,
    };
    const aviso = mensagemDoLote(r, 6);
    expect(aviso).not.toBeNull();
    expect(aviso?.tipo).toBe("erro");
    expect(aviso?.mensagem).toContain("Não foi possível processar");
    expect(aviso?.mensagem).toContain("Perdi contato");
  });
});

// ---------------------------------------------------------------------------

import { percorrerLote } from "./useLote";
import type { ArquivoNaFila } from "../estado/tipos";

/**
 * O laço do lote, exercitado contra as formas de morrer que ele já teve.
 *
 * O relato foi: "seleciono cinco ou seis documentos, começa o processamento, aí
 * de repente ele para e volta pra tela normal pra juntar novos documentos". O
 * backend estava inocente — seis peças de um processo real passaram por ele com
 * zero falhas. Quem morria era o laço, e morria **calado**.
 *
 * A regra que estes testes travam é uma só: **um arquivo pode falhar; o lote
 * não pode sumir.** Nenhuma exceção escapa de `percorrerLote` — o que sai é
 * sempre um `ResultadoLote`, com o que passou e o motivo do que não passou.
 */

function naFila(nome: string, extra: Partial<ArquivoNaFila> = {}): ArquivoNaFila {
  return {
    name: nome,
    path: `C:\autos\${nome}`,
    content: "texto",
    size: 5,
    precisaExtracao: nome.endsWith(".pdf"),
    estado: "na-fila",
    ...extra,
  } as ArquivoNaFila;
}

function deps(processar: unknown, aoDespachar?: (a: unknown) => void) {
  return {
    despachar: ((acao: unknown) => aoDespachar?.(acao)) as never,
    processar: processar as never,
    extractText: (async (c: string) => c) as never,
  };
}

const respostaOk = {
  texto_original: "CPF 529.982.247-25",
  anonymized_text: "CPF [CPF_1]",
  entities_found: [],
};

describe("percorrerLote", () => {
  const seis = Array.from({ length: 6 }, (_, i) => naFila(`doc${i}.pdf`));

  test("um arquivo que estoura não leva os outros junto", async () => {
    const processar = async (entrada: { nomeArquivo: string }) => {
      if (entrada.nomeArquivo === "doc2.pdf") throw new Error("backend recusou");
      return respostaOk;
    };

    const r = await percorrerLote(seis, [], "placeholder", new AbortController(), deps(processar));

    expect(r.processados).toHaveLength(5);
    expect(r.falhas).toEqual([{ nome: "doc2.pdf", motivo: "backend recusou" }]);
    expect(r.cancelado).toBe(false);
  });

  test("TODOS falhando devolve resultado, nunca uma exceção", async () => {
    /* O caso exato do relato. Com zero processados o `App` não abre a revisão,
       então este `ResultadoLote` é a única coisa que sobra para virar mensagem.
       Se `percorrerLote` estourasse aqui, a mensagem nunca seria montada — e
       era isso que fazia o aplicativo voltar para a Mesa em silêncio. */
    const processar = async () => {
      throw new Error("Perdi contato com o processamento");
    };

    const r = await percorrerLote(seis, [], "placeholder", new AbortController(), deps(processar));

    expect(r.processados).toHaveLength(0);
    expect(r.falhas).toHaveLength(6);
    expect(mensagemDoLote(r, 6)).not.toBeNull();
  });

  test("arquivo malformado na fila não derruba o lote", async () => {
    /* `arquivo.name.toLowerCase()` já ficou fora do `try`, e um item sem `name`
       — vindo de um estado corrompido ou de um canal futuro — estourava ali,
       antes de qualquer tratamento, levando o lote inteiro. */
    const fila = [naFila("bom.txt"), { path: "x", content: "" } as ArquivoNaFila, naFila("outro.txt")];

    const r = await percorrerLote(fila, [], "placeholder", new AbortController(), deps(async () => respostaOk));

    expect(r.processados).toHaveLength(2);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0].nome).toBe("arquivo 2");
  });

  test("um `despachar` que quebra não impede o lote de terminar", async () => {
    /* O reducer é chamado várias vezes por arquivo. Uma exceção vinda dele
       tinha o mesmo efeito de qualquer outra: matava o lote sem mensagem. */
    let chamadas = 0;
    const despachar = () => {
      chamadas += 1;
      if (chamadas === 3) throw new Error("reducer quebrou");
    };

    const r = await percorrerLote(
      [naFila("a.txt"), naFila("b.txt")],
      [],
      "placeholder",
      new AbortController(),
      deps(async () => respostaOk, despachar)
    );

    /* A invariante, dita explicitamente: um arquivo aparece em UMA lista.
       Ela quebrava aqui — o `push` do resultado vem antes do despacho de
       "pronto", e o despacho estourando jogava o mesmo documento em `falhas`.
       A mensagem final anunciava "1 de 2 processados" sobre um lote em que os
       dois passaram. */
    expect(r.processados.length + r.falhas.length).toBe(2);
    const nomes = new Set([
      ...r.processados.map((p) => p.originalName),
      ...r.falhas.map((f) => f.nome),
    ]);
    expect(nomes.size).toBe(2);
  });

  test("cancelar para o lote e preserva o que já passou", async () => {
    const controle = new AbortController();
    let n = 0;
    const processar = async () => {
      n += 1;
      if (n === 3) controle.abort();
      return respostaOk;
    };

    const r = await percorrerLote(seis, [], "placeholder", controle, deps(processar));

    expect(r.cancelado).toBe(true);
    expect(r.processados.length).toBeLessThan(6);
    expect(r.processados.length).toBeGreaterThan(0);
  });

  test("a tela de progresso é sempre fechada, mesmo com tudo falhando", async () => {
    /* O `encerrar-lote` mora num `finally`. Sem ele, um lote que morresse
       deixaria a interface presa na tela de progresso para sempre. */
    const acoes: string[] = [];
    const processar = async () => {
      throw new Error("falhou");
    };

    await percorrerLote(seis, [], "placeholder", new AbortController(), deps(processar, (a) =>
      acoes.push((a as { tipo: string }).tipo)
    ));

    expect(acoes[0]).toBe("iniciar-lote");
    expect(acoes.at(-1)).toBe("encerrar-lote");
  });

  test("fila vazia termina limpo, sem estourar", async () => {
    const r = await percorrerLote([], [], "placeholder", new AbortController(), deps(async () => respostaOk));
    expect(r).toEqual({ processados: [], falhas: [], cancelado: false });
  });
});
