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
  prepararPergunta,
  reidratar,
} from "../dist-electron/pseudonimos.js";

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
