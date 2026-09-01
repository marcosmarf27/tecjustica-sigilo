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

// --- Texto que o próprio aplicativo escreve --------------------------------
//
// A trava dispara sobre um valor proibido onde quer que ele esteja no corpo, e
// isso inclui a instrução do sistema — que fala em "documento", "peça" e
// termina em "português do Brasil". Basta o motor ter rotulado uma dessas
// palavras como LOCATION em algum ponto do processo para a conversa inteira
// ser recusada por causa de uma frase nossa.
//
// Aconteceu na primeira conversa real, em 01/09/2026: bloqueio na posição
// 1066, dentro da instrução. Uma trava que dispara sobre o texto que ela mesma
// escreveu é desligada na primeira semana, e aí não há trava nenhuma.

const INSTRUCAO_FALSA = "Responda sobre cada documento em português do Brasil.";

test("valor que só aparece na instrução do sistema não bloqueia", () => {
  const corpo = { messages: [{ role: "system", content: INSTRUCAO_FALSA }] };
  assert.doesNotThrow(() =>
    carimbar(corpo, [{ tipo: "LOCATION", valor: "Brasil" }], [INSTRUCAO_FALSA])
  );
});

test("o mesmo valor FORA da isenção continua bloqueando", () => {
  /* A isenção vale para a região, não para o valor: é o que a separa de uma
     lista de exceções que aos poucos esvazia a trava. */
  const corpo = {
    messages: [
      { role: "system", content: INSTRUCAO_FALSA },
      { role: "user", content: "domiciliado no Brasil, à rua tal" },
    ],
  };
  assert.throws(
    () => carimbar(corpo, [{ tipo: "LOCATION", valor: "Brasil" }], [INSTRUCAO_FALSA]),
    VazamentoBloqueadoError
  );
});

test("isentar não abre a porta para o texto original", () => {
  /* A mutação que esta trava existe para pegar: trocar `textoAnonimizado` por
     `textoOriginal` na montagem. A isenção não pode salvá-la. */
  const corpo = {
    messages: [
      { role: "system", content: INSTRUCAO_FALSA },
      { role: "user", content: "## Documento 1\n\nAna Lima, CPF 111.444.777-35" },
    ],
  };
  assert.throws(() => carimbar(corpo, PROIBIDOS, [INSTRUCAO_FALSA]), VazamentoBloqueadoError);
});

test("cópia da instrução dentro de um documento não isenta o que vem colado nela", () => {
  /* A região isenta é definida pela ocorrência literal da constante — e uma
     cópia dela dentro de um documento também é uma ocorrência literal. Isso é
     seguro pelo que fica DENTRO da região: é a constante, caractere por
     caractere, e dado do usuário não cabe ali. O que a região não pode fazer é
     se estender: o mesmo valor, logo depois da cópia, tem de continuar
     bloqueando. Pega a mutação que relaxa `ate <= fim` em `dentroDeAlguma`. */
  const corpo = {
    messages: [
      { role: "system", content: INSTRUCAO_FALSA },
      { role: "user", content: `## Documento 1

${INSTRUCAO_FALSA} Mora no Brasil.` },
    ],
  };
  assert.throws(
    () => carimbar(corpo, [{ tipo: "LOCATION", valor: "Brasil" }], [INSTRUCAO_FALSA]),
    VazamentoBloqueadoError
  );
});

// ---------------------------------------------------------------------------
// O corpo verificado é o JSON, e a serialização reescreve o texto: quebra de
// linha vira `\n` (dois caracteres), aspas viram `\"`, barra vira `\\`. Tanto
// os proibidos quanto as isenções precisam ser procurados nessa forma. Não
// eram, e o efeito foi nas duas direções — descoberto em revisão em
// 01/09/2026, no mesmo dia em que a isenção foi escrita.

const INSTRUCAO_COM_PARAGRAFOS =
  "Você lê autos anonimizados.\n\nRegras:\n- Cite a peça.\n\nResponda em português do Brasil.";

test("a isenção funciona com a instrução real, que tem parágrafos", () => {
  /* A isenção procurava a constante crua e nunca a encontrava no JSON: passava
     no teste de uma linha e bloqueava no aplicativo, na posição 1037. */
  const corpo = { messages: [{ role: "system", content: INSTRUCAO_COM_PARAGRAFOS }] };
  assert.doesNotThrow(() =>
    carimbar(corpo, [{ tipo: "LOCATION", valor: "Brasil" }], [INSTRUCAO_COM_PARAGRAFOS])
  );
});

test("valor com aspas ou barra invertida não atravessa o JSON", () => {
  /* Na direção oposta: `"Zé" Lima` e um caminho de arquivo, procurados na
     forma crua, atravessavam. */
  const corpoAspas = { messages: [{ role: "user", content: 'consta "Zé" Lima nos autos' }] };
  assert.throws(
    () => carimbar(corpoAspas, [{ tipo: "PERSON", valor: '"Zé" Lima' }]),
    VazamentoBloqueadoError
  );

  const caminho = "C:\\Users\\ana\\autos\\peticao.pdf";
  const corpoCaminho = { messages: [{ role: "user", content: `arquivo em ${caminho}` }] };
  assert.throws(
    () => carimbar(corpoCaminho, [{ tipo: "caminho do arquivo", valor: caminho }]),
    VazamentoBloqueadoError
  );
});

test("CPF colado numa letra tem fronteira: letra e dígito são classes diferentes", () => {
  /* "CPF111.444.777-35" é o que o OCR produz quando come o espaço. A regra
     antiga exigia não-alfanumérico dos dois lados e deixava passar — pela
     trava e pelo arremate, que usam a mesma regra. */
  assert.throws(
    () =>
      verificarSaida("CPF111.444.777-35 do autor", [
        { tipo: "CPF_BR", valor: "111.444.777-35" },
      ]),
    VazamentoBloqueadoError
  );
  /* E "Fernanda" continua não contendo "Ana": letra colada em letra. */
  assert.doesNotThrow(() =>
    verificarSaida("Fernanda assinou.", [{ tipo: "PERSON", valor: "Ana" }])
  );
});
