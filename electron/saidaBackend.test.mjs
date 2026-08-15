/**
 * Testes da leitura da saída do backend.
 *
 * O caso que motivou este arquivo: o app rejeitava todo documento com 403
 * porque o token era extraído de um pedaço solto da saída padrão e chegava
 * truncado. Rodar com `node --test electron/saidaBackend.test.mjs` depois de
 * `npm run build:electron-ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { criarLeitorDeSaida } from "../dist-electron/saidaBackend.js";

/** Coleta o que o leitor reporta, para inspeção nos testes. */
function coletor() {
  const tokens = [];
  const linhas = [];
  const leitor = criarLeitorDeSaida({
    aoReceberToken: (t) => tokens.push(t),
    aoRegistrar: (l) => linhas.push(l),
  });
  return { leitor, tokens, linhas };
}

const TOKEN = "Xh7pQ2rL9mNv4TzB8kWc1sYdA6fJ0uEgI3nOaP5tRqM";

test("lê o token quando a linha chega inteira", () => {
  const { leitor, tokens } = coletor();
  leitor.consumir(`PRESIDIO_TOKEN=${TOKEN}\n`);
  assert.deepEqual(tokens, [TOKEN]);
});

test("não entrega token partido entre dois pedaços", () => {
  // Era o defeito: a saída de um processo filho não respeita limite de linha,
  // e meio token é rejeitado pelo backend exatamente como token nenhum.
  const { leitor, tokens } = coletor();
  leitor.consumir("PRESIDIO_TOKEN=Xh7pQ2rL9mNv4Tz");
  assert.deepEqual(tokens, [], "não pode anunciar um token incompleto");

  leitor.consumir("B8kWc1sYdA6fJ0uEgI3nOaP5tRqM\n");
  assert.deepEqual(tokens, [TOKEN], "só depois da linha fechar");
});

test("aguenta o token partido em muitos pedaços", () => {
  const { leitor, tokens } = coletor();
  for (const c of `PRESIDIO_TOKEN=${TOKEN}\n`) leitor.consumir(c);
  assert.deepEqual(tokens, [TOKEN]);
});

test("encontra o token no meio de outras linhas", () => {
  const { leitor, tokens, linhas } = coletor();
  leitor.consumir(
    `Carregando modelo NLP (modo=transformer)...\nPRESIDIO_TOKEN=${TOKEN}\n` +
      "Modelo carregado. Servidor rodando na porta 8123\n"
  );
  assert.deepEqual(tokens, [TOKEN]);
  assert.equal(linhas.length, 2, "as outras linhas continuam sendo registradas");
  assert.ok(!linhas.some((l) => l.includes(TOKEN)), "o segredo não vai para o log");
});

test("aceita fim de linha do Windows", () => {
  const { leitor, tokens } = coletor();
  leitor.consumir(`PRESIDIO_TOKEN=${TOKEN}\r\n`);
  assert.deepEqual(tokens, [TOKEN], "o \\r não pode entrar no token");
});

test("ignora a marca quando não é a linha inteira", () => {
  // Uma mensagem de erro que mencione o marcador não deve virar credencial.
  const { leitor, tokens } = coletor();
  leitor.consumir("aviso: defina PRESIDIO_TOKEN=<segredo> no ambiente\n");
  assert.deepEqual(tokens, []);
});

test("uma reinicialização do backend substitui o token", () => {
  const { leitor, tokens } = coletor();
  leitor.consumir("PRESIDIO_TOKEN=primeiro\n");
  leitor.consumir("PRESIDIO_TOKEN=segundo\n");
  assert.deepEqual(tokens, ["primeiro", "segundo"]);
});
