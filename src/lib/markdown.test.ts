import { describe, expect, test } from "vitest";

import { analisarBlocos, analisarInline, type Inline } from "./markdown";

/**
 * O parser existe para um gerador só: o modelo respondendo sobre autos.
 *
 * O caso que justifica escrever isto em vez de instalar uma biblioteca está no
 * primeiro teste. Todo o resto do produto depende de `[PESSOA_1]` chegar
 * inteiro até a reposição — e no CommonMark `[texto]` é referência de link, que
 * um renderizador padrão engole ou transforma. Um pseudônimo comido não
 * aparece como erro: aparece como uma frase sem sujeito, sobre um processo
 * judicial.
 */

/** O texto de todos os nós, para afirmar sobre conteúdo sem montar a árvore. */
function texto(nos: Inline[]): string {
  return nos
    .map((n) => {
      if (n.tipo === "texto" || n.tipo === "codigo") return n.texto;
      if (n.tipo === "link") return n.texto;
      return texto(n.filhos);
    })
    .join("");
}

describe("o pseudônimo atravessa intacto", () => {
  test("[PESSOA_1] não é link nem some", () => {
    const nos = analisarInline("Consta [PESSOA_1] nos autos.");
    expect(nos).toEqual([{ tipo: "texto", texto: "Consta [PESSOA_1] nos autos." }]);
  });

  test("dois pseudônimos colados sobrevivem", () => {
    expect(texto(analisarInline("[PESSOA_1] e [CPF_2]"))).toBe("[PESSOA_1] e [CPF_2]");
  });

  test("pseudônimo dentro de negrito continua reconhecível", () => {
    const nos = analisarInline("**Acusado:** [PESSOA_1]");
    expect(nos[0]).toEqual({
      tipo: "forte",
      filhos: [{ tipo: "texto", texto: "Acusado:" }],
    });
    expect(texto(nos)).toBe("Acusado: [PESSOA_1]");
  });

  test("mas link de verdade continua sendo link", () => {
    expect(analisarInline("veja [o acórdão](https://x.y)")).toEqual([
      { tipo: "texto", texto: "veja " },
      { tipo: "link", texto: "o acórdão", destino: "https://x.y" },
    ]);
  });
});

describe("ênfase", () => {
  test("negrito vence itálico — o duplo asterisco é testado antes", () => {
    expect(analisarInline("**forte**")).toEqual([
      { tipo: "forte", filhos: [{ tipo: "texto", texto: "forte" }] },
    ]);
  });

  test("asterisco solto não abre ênfase", () => {
    /* "art. 401, § 2º * CPP" e multiplicações aparecem em texto jurídico. */
    expect(texto(analisarInline("3 * 4 = 12"))).toBe("3 * 4 = 12");
  });

  test("marca sem conteúdo não abre nada", () => {
    expect(texto(analisarInline("cheguei ** ali"))).toBe("cheguei ** ali");
  });

  test("dentro de código nada é interpretado", () => {
    expect(analisarInline("`**x**`")).toEqual([{ tipo: "codigo", texto: "**x**" }]);
  });

  test("escape deixa o caractere literal", () => {
    expect(texto(analisarInline("2 \\* 3"))).toBe("2 * 3");
  });
});

describe("blocos", () => {
  test("quebra simples é quebra de linha, não junção de parágrafo", () => {
    /* O modelo escreve um campo por linha e conta com isso. Juntar tudo numa
       corrida só destrói a estrutura que a resposta tinha. */
    const blocos = analisarBlocos("**Juízo:** Vara Única\n**Partes:** MP × réu");
    expect(blocos).toHaveLength(1);
    expect(blocos[0].tipo).toBe("paragrafo");
    expect(texto((blocos[0] as { filhos: Inline[] }).filhos)).toBe(
      "Juízo: Vara Única\nPartes: MP × réu"
    );
  });

  test("título guarda o nível", () => {
    const blocos = analisarBlocos("## Presentes");
    expect(blocos[0]).toMatchObject({ tipo: "titulo", nivel: 2 });
  });

  test("lista numerada preserva o número inicial", () => {
    const blocos = analisarBlocos("3. terceiro\n4. quarto");
    expect(blocos[0]).toMatchObject({ tipo: "lista", ordenada: true, inicio: 3 });
    expect((blocos[0] as { itens: Inline[][] }).itens).toHaveLength(2);
  });

  test("lista não mistura marcador com número", () => {
    const blocos = analisarBlocos("- um\n1. dois");
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).toMatchObject({ ordenada: false });
    expect(blocos[1]).toMatchObject({ ordenada: true });
  });

  test("um título encerra o parágrafo anterior", () => {
    const blocos = analisarBlocos("texto solto\n## Seção");
    expect(blocos.map((b) => b.tipo)).toEqual(["paragrafo", "titulo"]);
  });

  test("cerca de código sem fechamento ainda vira bloco", () => {
    /* Acontece a cada pedaço enquanto a resposta chega. Sem isto, o bloco
       piscaria entre "código" e "parágrafo" durante o streaming inteiro. */
    const blocos = analisarBlocos("```json\n{ \"a\": 1 }");
    expect(blocos[0]).toEqual({ tipo: "codigo", texto: '{ "a": 1 }', lingua: "json" });
  });

  test("dentro da cerca, # não vira título", () => {
    const blocos = analisarBlocos("```\n# não é título\n```");
    expect(blocos).toHaveLength(1);
    expect(blocos[0].tipo).toBe("codigo");
  });
});

describe("tabela", () => {
  test("exige a linha de separação", () => {
    const blocos = analisarBlocos("| Peça | Fls. |\n| --- | --- |\n| Denúncia | 3 |");
    expect(blocos[0].tipo).toBe("tabela");
    expect((blocos[0] as { linhas: unknown[] }).linhas).toHaveLength(1);
  });

  test("sem a separação, é parágrafo", () => {
    /* "a | b" aparece em texto normal; uma tabela de uma coluna só seria pior
       que a linha crua. */
    expect(analisarBlocos("| isto não é tabela |")[0].tipo).toBe("paragrafo");
  });
});

describe("sublinhado não estraga snake_case", () => {
  test("o pseudônimo é snake_case, e é por isso que a regra existe aqui", () => {
    /* Sem a restrição, o `_` de PESSOA_1 abre ênfase e fecha no `_` de CPF_2:
       a frase chega como "[PESSOA1] e [CPF2]", com os dois rótulos adulterados
       e nenhum sinal de erro. É o defeito que um renderizador de markdown
       padrão introduziria neste produto. */
    expect(analisarInline("[PESSOA_1] e [CPF_2]")).toEqual([
      { tipo: "texto", texto: "[PESSOA_1] e [CPF_2]" },
    ]);
  });

  test("mas sublinhado solto continua marcando ênfase", () => {
    expect(analisarInline("_assim_")).toEqual([
      { tipo: "enfase", filhos: [{ tipo: "texto", texto: "assim" }] },
    ]);
  });

  test("nome_de_variavel atravessa inteiro", () => {
    expect(texto(analisarInline("veja politica_mascara no código"))).toBe(
      "veja politica_mascara no código"
    );
  });

  test("o asterisco não tem essa restrição — negrito colado ainda vale", () => {
    /* "**Juízo:**Vara" aparece quando o modelo esquece o espaço. */
    expect(analisarInline("**Juízo:**Vara")).toEqual([
      { tipo: "forte", filhos: [{ tipo: "texto", texto: "Juízo:" }] },
      { tipo: "texto", texto: "Vara" },
    ]);
  });
});
