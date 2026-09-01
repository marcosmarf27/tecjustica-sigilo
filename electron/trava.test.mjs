/**
 * Testes da última barreira antes da rede.
 *
 * O defeito que esta trava existe para pegar cabe numa palavra: `ConteudoDoCofre`
 * guarda `textoOriginal` e `textoAnonimizado` lado a lado, e trocar um pelo
 * outro na hora de montar o que sai da máquina manda o processo inteiro para a
 * internet. As duas linhas são igualmente plausíveis numa revisão de código.
 *
 * Por isso a verificação não olha para a intenção nem para o caminho: olha para
 * o corpo já serializado, do jeito que sairia pelo fio.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  VazamentoBloqueadoError,
  carimbar,
  verificarSaida,
} from "../dist-electron/trava.js";

/* Um documento do jeito que sai do cofre: os dois textos, e as ocorrências que
   dizem quais valores foram mascarados. */
const ORIGINAL =
  "Ana Lima, CPF 111.444.777-35, move ação contra Bruno Costa.";
const ANONIMIZADO =
  "[PESSOA_1], CPF [CPF_1], move ação contra [PESSOA_2].";

const PROIBIDOS = [
  { tipo: "PERSON", valor: "Ana Lima" },
  { tipo: "CPF_BR", valor: "111.444.777-35" },
  { tipo: "PERSON", valor: "Bruno Costa" },
  { tipo: "nome do arquivo", valor: "Petição inicial - Ana Lima.pdf" },
  { tipo: "número do processo", valor: "0200161-20.2024.8.06.0303" },
];

// --- O defeito central -----------------------------------------------------

test("o corpo montado com o texto original em vez do anonimizado é barrado", () => {
  const corpo = { messages: [{ role: "user", content: ORIGINAL }] };
  assert.throws(
    () => carimbar(corpo, PROIBIDOS),
    VazamentoBloqueadoError
  );
});

test("o corpo com o texto anonimizado passa", () => {
  const corpo = { messages: [{ role: "user", content: ANONIMIZADO }] };
  const carimbado = carimbar(corpo, PROIBIDOS);
  assert.ok(carimbado.json.includes("PESSOA_1"));
});

// --- O que mais não pode sair ----------------------------------------------

test("o nome do arquivo é barrado", () => {
  /* "Petição inicial - Ana Lima.pdf" é dado pessoal: o próprio cofre cifra o
     índice por causa disso. O caminho óbvio — cabeçalhar cada peça com o nome
     do arquivo — desfaria a anonimização de graça. */
  const corpo = {
    messages: [
      { role: "user", content: "Documento: Petição inicial - Ana Lima.pdf" },
    ],
  };
  assert.throws(() => carimbar(corpo, PROIBIDOS), VazamentoBloqueadoError);
});

test("o número do processo é barrado", () => {
  /* O CNJ é uma das entidades que o motor mascara dentro do texto. Deixá-lo
     reaparecer num cabeçalho seria apagar de um lado e escrever do outro. */
  const corpo = { processo: "0200161-20.2024.8.06.0303" };
  assert.throws(() => carimbar(corpo, PROIBIDOS), VazamentoBloqueadoError);
});

test("valor aninhado fundo no corpo também é achado", () => {
  const corpo = { a: { b: { c: [{ d: "olha a Ana Lima aqui" }] } } };
  assert.throws(() => carimbar(corpo, PROIBIDOS), VazamentoBloqueadoError);
});

test("grafia com outra caixa e sem acento não escapa", () => {
  const corpo = {
    messages: [{ role: "user", content: "PETICAO de ANA LIMA" }],
  };
  assert.throws(() => carimbar(corpo, PROIBIDOS), VazamentoBloqueadoError);
});

// --- Não pode disparar à toa -----------------------------------------------

test("não dispara quando o valor é só parte de outra palavra", () => {
  /* Sem fronteira de palavra, um nome curto barraria texto legítimo — e uma
     trava que dispara sempre é desligada na primeira semana. */
  assert.doesNotThrow(() =>
    verificarSaida("Fernanda assinou o documento.", [
      { tipo: "PERSON", valor: "Ana" },
    ])
  );
});

test("não dispara sobre o texto anonimizado legítimo", () => {
  assert.doesNotThrow(() => verificarSaida(ANONIMIZADO, PROIBIDOS));
});

test("valor curto demais para verificar é ignorado em vez de barrar tudo", () => {
  assert.doesNotThrow(() =>
    verificarSaida("qualquer texto", [{ tipo: "LOCATION", valor: "Sé" }])
  );
});

// --- A mensagem não pode vazar o que ela está protegendo --------------------

test("a mensagem de erro nomeia o tipo, nunca o valor", () => {
  /* Uma defesa contra vazamento que escreve o dado vazado no log é um
     vazamento com outro nome. */
  try {
    carimbar({ x: "Ana Lima" }, PROIBIDOS);
    assert.fail("deveria ter barrado");
  } catch (erro) {
    assert.ok(erro instanceof VazamentoBloqueadoError);
    assert.ok(erro.message.includes("PERSON"));
    assert.ok(!erro.message.includes("Ana Lima"));
  }
});
