/**
 * Testes do espaço de pseudônimos da conversa.
 *
 * O defeito que este arquivo existe para impedir não derruba nada: produz uma
 * resposta bem escrita sobre a pessoa errada. Duas peças do mesmo processo
 * chegam do cofre numeradas cada uma a partir de 1, e quem lê "[PESSOA_2]
 * assinou a procuração" não tem como desconfiar de que o [PESSOA_2] da
 * procuração é o [PESSOA_1] da petição.
 *
 * Rodar com `npm run test:electron` (compila e roda), ou
 * `node --test electron/pseudonimos.test.mjs` depois de `npm run build:electron-ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DocumentoIncompativelError,
  MapaDeSessao,
  incorporar,
  normalizar,
  pareceMascaradoComPlaceholder,
  arrematar,
  prepararPergunta,
  reidratar,
} from "../dist-electron/pseudonimos.js";
import { verificarSaida } from "../dist-electron/trava.js";

/** Ocorrência com os campos que o backend devolve. */
function oc(type, text, start) {
  return { type, text, start, end: start + text.length, score: 0.99 };
}

/* Duas peças do mesmo processo, como saem do cofre hoje — cada uma numerada a
   partir de 1. Bruno Costa é [PESSOA_2] numa e [PESSOA_1] na outra: é essa
   colisão que o módulo existe para desfazer. */
const PETICAO = {
  texto: "[PESSOA_1] move ação contra [PESSOA_2].",
  ocorrencias: [oc("PERSON", "Ana Lima", 0), oc("PERSON", "Bruno Costa", 26)],
};

const PROCURACAO = {
  texto: "[PESSOA_1] nomeia [PESSOA_2].",
  ocorrencias: [oc("PERSON", "Bruno Costa", 0), oc("PERSON", "Carla Dias", 19)],
};

// --- normalizar ------------------------------------------------------------

test("normalizar iguala as grafias que o mesmo documento produz", () => {
  const esperado = "joao da silva";
  assert.equal(normalizar("JOÃO DA SILVA"), esperado);
  assert.equal(normalizar("João da Silva"), esperado);
  assert.equal(normalizar("joao da silva"), esperado);
  assert.equal(normalizar("  João   da  Silva  "), esperado);
});

// --- um documento ----------------------------------------------------------

test("a mesma pessoa em grafias diferentes ocupa um número só", () => {
  const mapa = new MapaDeSessao();
  const saida = incorporar(
    "[PESSOA_1] declarou. [PESSOA_1] assinou.",
    [oc("PERSON", "JOÃO DA SILVA", 0), oc("PERSON", "João da Silva", 21)],
    mapa
  );

  assert.equal(saida, "[PESSOA_1] declarou. [PESSOA_1] assinou.");
  assert.deepEqual(mapa.resumo(), { PESSOA: 1 });
  assert.equal(mapa.valorDe("[PESSOA_1]"), "JOÃO DA SILVA");
});

test("cada tipo de entidade tem sua própria contagem", () => {
  const mapa = new MapaDeSessao();
  incorporar(
    "[PESSOA_1], CPF [CPF_1], e [PESSOA_2], CPF [CPF_2].",
    [
      oc("PERSON", "Ana Lima", 0),
      oc("CPF_BR", "111.444.777-35", 15),
      oc("PERSON", "Bruno Costa", 35),
      oc("CPF_BR", "529.982.247-25", 52),
    ],
    mapa
  );

  assert.deepEqual(mapa.resumo(), { PESSOA: 2, CPF: 2 });
  assert.equal(mapa.valorDe("[CPF_1]"), "111.444.777-35");
});

test("a ordem é a do texto, não a da lista que o detector devolveu", () => {
  /* O detector devolve por janela e `_fundir_spans` resolve sobreposição, não
     ordem. Se a numeração seguisse a lista, o primeiro nome do documento
     poderia sair como [PESSOA_2] e a conferência acusaria — que é justamente o
     que este teste verifica não acontecer. */
  const mapa = new MapaDeSessao();
  const saida = incorporar(
    PETICAO.texto,
    [...PETICAO.ocorrencias].reverse(),
    mapa
  );

  assert.equal(saida, "[PESSOA_1] move ação contra [PESSOA_2].");
  assert.equal(mapa.valorDe("[PESSOA_1]"), "Ana Lima");
});

// --- vários documentos: o defeito central ----------------------------------

test("a mesma pessoa em duas peças recebe um único rótulo global", () => {
  const mapa = new MapaDeSessao();

  const a = incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);
  const b = incorporar(PROCURACAO.texto, PROCURACAO.ocorrencias, mapa);

  assert.equal(a, "[PESSOA_1] move ação contra [PESSOA_2].");
  /* Bruno Costa era [PESSOA_1] na procuração e vira [PESSOA_2], que é como ele
     já estava na petição. Carla Dias, inédita, ganha o número seguinte. */
  assert.equal(b, "[PESSOA_2] nomeia [PESSOA_3].");

  assert.equal(mapa.valorDe("[PESSOA_2]"), "Bruno Costa");
  assert.equal(mapa.valorDe("[PESSOA_3]"), "Carla Dias");
  assert.deepEqual(mapa.resumo(), { PESSOA: 3 });
});

test("pessoas diferentes com o mesmo rótulo local não se fundem", () => {
  const mapa = new MapaDeSessao();

  const a = incorporar(
    "[PESSOA_1] compareceu.",
    [oc("PERSON", "Ana Lima", 0)],
    mapa
  );
  const b = incorporar(
    "[PESSOA_1] compareceu.",
    [oc("PERSON", "Bruno Costa", 0)],
    mapa
  );

  assert.equal(a, "[PESSOA_1] compareceu.");
  assert.equal(b, "[PESSOA_2] compareceu.");
});

test("traduzir não faz efeito cascata", () => {
  /* Trocar 1→2 e 2→3 em sequência transformaria o primeiro em 3. A troca é
     numa passada só, e este documento tem exatamente o par que denuncia. */
  const mapa = new MapaDeSessao();
  incorporar("[PESSOA_1]", [oc("PERSON", "Zulmira", 0)], mapa);

  const saida = incorporar(
    "[PESSOA_1] e [PESSOA_2]",
    [oc("PERSON", "Ana Lima", 0), oc("PERSON", "Zulmira", 13)],
    mapa
  );

  assert.equal(saida, "[PESSOA_2] e [PESSOA_1]");
});

// --- conferência: recusar em vez de errar em silêncio -----------------------

test("documento cujas ocorrências não explicam os rótulos é recusado", () => {
  const mapa = new MapaDeSessao();
  assert.throws(
    () => incorporar("[PESSOA_1] e [PESSOA_2].", [oc("PERSON", "Ana", 0)], mapa),
    DocumentoIncompativelError
  );
});

test("rótulo que veio do próprio documento não conta como pseudônimo", () => {
  /* Um documento pode conter "[ITEM_1]" numa tabela. Não é rótulo de entidade,
     não entra na conferência e sai intacto do outro lado. */
  const mapa = new MapaDeSessao();
  const saida = incorporar(
    "[ITEM_1] pertence a [PESSOA_1].",
    [oc("PERSON", "Ana Lima", 20)],
    mapa
  );

  assert.equal(saida, "[ITEM_1] pertence a [PESSOA_1].");
});

// --- a pergunta do usuário -------------------------------------------------

test("pergunta sobre alguém do processo usa o rótulo que já existe", () => {
  const mapa = new MapaDeSessao();
  incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);

  const pergunta = "Bruno Costa assinou?";
  const preparada = prepararPergunta(
    pergunta,
    [oc("PERSON", "Bruno Costa", 0)],
    mapa
  );

  assert.equal(preparada.texto, "[PESSOA_2] assinou?");
  assert.deepEqual(preparada.trocas, [
    { valor: "Bruno Costa", rotulo: "[PESSOA_2]" },
  ]);
});

test("pergunta com grafia diferente ainda casa com quem está no processo", () => {
  const mapa = new MapaDeSessao();
  incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);

  const preparada = prepararPergunta(
    "BRUNO COSTA assinou?",
    [oc("PERSON", "BRUNO COSTA", 0)],
    mapa
  );

  assert.equal(preparada.texto, "[PESSOA_2] assinou?");
});

test("pergunta sobre alguém de fora ganha o próximo número livre", () => {
  const mapa = new MapaDeSessao();
  incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);

  const preparada = prepararPergunta(
    "Diana Reis aparece?",
    [oc("PERSON", "Diana Reis", 0)],
    mapa
  );

  /* Não pode ser [PESSOA_1]: esse é a Ana Lima, e o modelo responderia sobre
     ela. O processo tinha duas pessoas, então a terceira é a de fora. */
  assert.equal(preparada.texto, "[PESSOA_3] aparece?");
});

test("duas entidades coladas na pergunta não deslocam uma à outra", () => {
  const mapa = new MapaDeSessao();
  const pergunta = "Ana:Bo?";
  const preparada = prepararPergunta(
    pergunta,
    [oc("PERSON", "Ana", 0), oc("PERSON", "Bo", 4)],
    mapa
  );

  assert.equal(preparada.texto, "[PESSOA_1]:[PESSOA_2]?");
});

test("pergunta sem dado pessoal sai como foi digitada", () => {
  const mapa = new MapaDeSessao();
  const preparada = prepararPergunta("Qual é o valor da causa?", [], mapa);

  assert.equal(preparada.texto, "Qual é o valor da causa?");
  assert.deepEqual(preparada.trocas, []);
});

// --- re-hidratação ---------------------------------------------------------

test("a resposta volta com os nomes repostos, marcados", () => {
  const mapa = new MapaDeSessao();
  incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);

  const trechos = reidratar("Quem move a ação é [PESSOA_1].", mapa);

  assert.deepEqual(trechos, [
    { tipo: "texto", texto: "Quem move a ação é " },
    { tipo: "reposto", rotulo: "[PESSOA_1]", valor: "Ana Lima" },
    { tipo: "texto", texto: "." },
  ]);
});

test("rótulo inventado pelo modelo aparece como desconhecido, não some", () => {
  /* Apagar em silêncio esconderia a invenção; trocar por um nome qualquer
     seria pior. O revisor precisa ver que o modelo citou alguém que não
     existe no processo. */
  const mapa = new MapaDeSessao();
  incorporar(PETICAO.texto, PETICAO.ocorrencias, mapa);

  const trechos = reidratar("Segundo [PESSOA_9], houve dolo.", mapa);

  assert.deepEqual(trechos[1], { tipo: "desconhecido", rotulo: "[PESSOA_9]" });
});

test("resposta sem rótulo nenhum atravessa intacta", () => {
  const mapa = new MapaDeSessao();
  const trechos = reidratar("O valor da causa é R$ 12.000,00.", mapa);

  assert.deepEqual(trechos, [
    { tipo: "texto", texto: "O valor da causa é R$ 12.000,00." },
  ]);
});

// --- política de máscara ---------------------------------------------------

test("reconhece o texto que pode entrar numa conversa", () => {
  assert.equal(pareceMascaradoComPlaceholder("[PESSOA_1] assinou."), true);
  /* `parcial` e `total` ocultam sem identificar: duas pessoas com as mesmas
     iniciais viram a mesma coisa, e o chat não teria como distingui-las. */
  assert.equal(pareceMascaradoComPlaceholder("J**** d* S**** assinou."), false);
  assert.equal(pareceMascaradoComPlaceholder("************* assinou."), false);
  assert.equal(pareceMascaradoComPlaceholder("[ITEM_1] na tabela."), false);
});

// --- O arremate: fechar o que o motor deixou passar ------------------------
//
// O backend numera por VALOR e substitui por SPAN. Um valor reconhecido numa
// posição e perdido noutra sai em claro do documento que se chama anonimizado,
// e a trava então recusa a conversa inteira por causa dele.

test("aparição que o detector perdeu é fechada com o rótulo que o valor já tem", () => {
  const mapa = new MapaDeSessao();
  /* O detector achou FORTALEZA uma vez; o texto tem duas. */
  const texto = incorporar(
    "Comarca de [LOCAL_1]. Feito em FORTALEZA, 3 de março.",
    [oc("LOCATION", "Fortaleza", 11)],
    mapa
  );

  const { texto: fechado, fechados } = arrematar(texto, mapa);

  assert.ok(!/FORTALEZA/i.test(fechado), "a segunda aparição saiu");
  assert.equal(fechado, "Comarca de [LOCAL_1]. Feito em [LOCAL_1], 3 de março.");
  assert.deepEqual(fechados, { LOCAL: 1 });
});

test("o arremate ignora acento e caixa, como o motor faz ao numerar", () => {
  const mapa = new MapaDeSessao();
  const texto = incorporar(
    "[PESSOA_1] compareceu. Intimado joao da silva.",
    [oc("PERSON", "João da Silva", 0)],
    mapa
  );

  assert.equal(
    arrematar(texto, mapa).texto,
    "[PESSOA_1] compareceu. Intimado [PESSOA_1]."
  );
});

test("valor curto é deixado quieto — o mesmo limite que a trava usa", () => {
  /* Fechar valores de duas letras encheria o texto de rótulos onde não há
     dado nenhum. A trava também os ignora, então os dois lados concordam. */
  const mapa = new MapaDeSessao();
  const texto = incorporar("[LOCAL_1] e mais nada.", [oc("LOCATION", "Sé", 0)], mapa);
  assert.equal(arrematar(texto, mapa).texto, "[LOCAL_1] e mais nada.");
});

test("o arremate respeita fronteira de palavra", () => {
  const mapa = new MapaDeSessao();
  /* "Ana" não pode transformar "Fernanda" em "Fern[PESSOA_1]da". */
  const texto = incorporar(
    "[PESSOA_1] e Fernanda Souza discutiram. Ana assinou.",
    [oc("PERSON", "Ana", 0)],
    mapa
  );

  const { texto: fechado } = arrematar(texto, mapa);
  assert.ok(fechado.includes("Fernanda Souza"), "não comeu o meio da palavra");
  assert.ok(fechado.endsWith("[PESSOA_1] assinou."));
});

test("o valor mais longo fecha primeiro, e o curto não o parte", () => {
  const mapa = new MapaDeSessao();
  const texto = incorporar(
    "[PESSOA_1] e [PESSOA_2]. Depois, João da Silva falou.",
    [oc("PERSON", "João da Silva", 0), oc("PERSON", "João", 15)],
    mapa
  );

  /* Fechando "João" antes, "João da Silva" viraria "[PESSOA_2] da Silva" —
     dois rótulos para a mesma pessoa e um sobrenome em claro. */
  assert.ok(arrematar(texto, mapa).texto.endsWith("Depois, [PESSOA_1] falou."));
});

test("o arremate não encosta num rótulo já posto", () => {
  const mapa = new MapaDeSessao();
  /* Valor que por acaso casa com o miolo de um rótulo. */
  const texto = incorporar("[LOCAL_1] fica longe.", [oc("LOCATION", "local", 0)], mapa);
  assert.equal(arrematar(texto, mapa).texto, "[LOCAL_1] fica longe.");
});

test("um nome visto só na segunda peça é fechado também na primeira", () => {
  /* É o ganho que a numeração por documento não entrega: cada peça foi
     analisada sozinha, e o resíduo mora justamente entre elas. */
  const mapa = new MapaDeSessao();
  const peca1 = incorporar(
    "Consta [PESSOA_1]. Também assinou Marta Rocha.",
    [oc("PERSON", "Carlos Dias", 7)],
    mapa
  );
  const peca2 = incorporar(
    "Procuração de [PESSOA_1].",
    [oc("PERSON", "Marta Rocha", 14)],
    mapa
  );

  assert.ok(arrematar(peca1, mapa).texto.endsWith("Também assinou [PESSOA_2]."));
  assert.equal(arrematar(peca2, mapa).texto, "Procuração de [PESSOA_2].");
});

test("espaço duplo entre as palavras não faz o valor escapar", () => {
  /* OCR produz espaço duplo o tempo todo, e é onde o casamento ingênuo falha. */
  const mapa = new MapaDeSessao();
  const texto = incorporar(
    "[PESSOA_1] veio. Depois Ana  Beatriz  Lima saiu.",
    [oc("PERSON", "Ana Beatriz Lima", 0)],
    mapa
  );
  assert.equal(arrematar(texto, mapa).texto, "[PESSOA_1] veio. Depois [PESSOA_1] saiu.");
});

test("texto sem resíduo passa intacto e não conta nada", () => {
  const mapa = new MapaDeSessao();
  const texto = incorporar("[PESSOA_1] e [CPF_1].", [
    oc("PERSON", "Ana Lima", 0),
    oc("CPF_BR", "111.444.777-35", 13),
  ], mapa);

  const { texto: fechado, fechados } = arrematar(texto, mapa);
  assert.equal(fechado, texto);
  assert.deepEqual(fechados, {});
});

// --- A junta entre o arremate e a trava ------------------------------------

test("o que o arremate fecha, a trava não encontra", () => {
  /* É a propriedade que sustenta o recurso inteiro: se as duas normalizações
     divergirem, o arremate declara ter fechado e a trava bloqueia mesmo assim
     — e o usuário fica sem conversa e sem explicação. */
  const mapa = new MapaDeSessao();
  const ocorrencias = [
    oc("PERSON", "João da Silva", 0),
    oc("LOCATION", "Fortaleza", 30),
  ];
  const bruto = incorporar(
    "[PESSOA_1] mora em [LOCAL_1].\n" +
      "JOÃO DA SILVA, residente em fortaleza, comparece.\n" +
      "Assina: joão  da  silva.",
    ocorrencias,
    mapa
  );

  const { texto: fechado } = arrematar(bruto, mapa);
  const proibidos = ocorrencias.map((o) => ({ tipo: o.type, valor: o.text }));

  assert.doesNotThrow(() => verificarSaida(JSON.stringify({ fechado }), proibidos));
});

test("o arremate diz o que trocou, e uma vez por rótulo", () => {
  /* Ele mexe no texto que o usuário digitou. Alterar a frase de alguém sem
     mostrar o quê é como o produto perde quem assina o documento. */
  const mapa = new MapaDeSessao();
  const texto = incorporar(
    "[PESSOA_1] processou em [LOCAL_1]. Ana Lima e Ana Lima outra vez, em Recife.",
    [oc("PERSON", "Ana Lima", 0), oc("LOCATION", "Recife", 24)],
    mapa
  );

  const { trocas } = arrematar(texto, mapa);

  assert.deepEqual(trocas, [
    { valor: "Ana Lima", rotulo: "[PESSOA_1]" },
    { valor: "Recife", rotulo: "[LOCAL_1]" },
  ]);
});
