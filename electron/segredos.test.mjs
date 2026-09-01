/**
 * Testes da chave da API cifrada.
 *
 * Mesmo molde do `cofre.test.mjs`, e pelo mesmo motivo: `require("electron")`
 * não resolve fora do runtime do Electron, então `Module._load` é interceptado
 * antes de carregar o módulo compilado.
 *
 * O detalhe que importa copiar dali é o `safeStorage` falso: a cifra é um XOR,
 * **reversível e não-identidade**. Se ela fosse identidade, o teste "a chave não
 * aparece legível nos bytes" passaria mesmo com o módulo gravando em claro — que
 * é exatamente o defeito que ele existe para pegar.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pastaTemporaria = "";
const controle = { cifragemDisponivel: true };

const CHAVE = 0x5a;

const electronFalso = {
  app: {
    getPath: (nome) => {
      if (nome !== "userData") throw new Error(`getPath inesperado: ${nome}`);
      return pastaTemporaria;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => controle.cifragemDisponivel,
    encryptString: (texto) => {
      const bytes = Buffer.from(texto, "utf8");
      return Buffer.from(bytes.map((b) => b ^ CHAVE));
    },
    decryptString: (buffer) =>
      Buffer.from(Buffer.from(buffer).map((b) => b ^ CHAVE)).toString("utf8"),
  },
};

const carregarOriginal = Module._load;
Module._load = function (pedido, pai, ehPrincipal) {
  if (pedido === "electron") return electronFalso;
  return carregarOriginal.apply(this, [pedido, pai, ehPrincipal]);
};

const segredos = require(path.join(RAIZ, "dist-electron", "segredos.js"));

before(() => {
  pastaTemporaria = fs.mkdtempSync(path.join(os.tmpdir(), "segredos-teste-"));
});

beforeEach(() => {
  controle.cifragemDisponivel = true;
  fs.rmSync(path.join(pastaTemporaria, "segredos.bin"), { force: true });
});

after(() => {
  Module._load = carregarOriginal;
  fs.rmSync(pastaTemporaria, { recursive: true, force: true });
});

const CHAVE_FALSA = "sk-or-v1-naoehumachavedeverdade0123456789abcd";

test("guarda e devolve a chave", () => {
  segredos.guardar(CHAVE_FALSA);
  assert.equal(segredos.ler(), CHAVE_FALSA);
});

test("a chave não aparece legível nos bytes do arquivo", () => {
  segredos.guardar(CHAVE_FALSA);
  const bytes = fs.readFileSync(path.join(pastaTemporaria, "segredos.bin"));
  assert.ok(!bytes.toString("utf8").includes(CHAVE_FALSA));
  assert.ok(!bytes.toString("latin1").includes(CHAVE_FALSA));
});

test("sem cifragem disponível, recusa gravar em vez de gravar em claro", () => {
  /* A mesma decisão do cofre. Um fallback silencioso para texto puro deixaria a
     credencial legível no perfil, e ninguém saberia. */
  controle.cifragemDisponivel = false;
  assert.throws(() => segredos.guardar(CHAVE_FALSA), /cifragem/i);
  assert.ok(!fs.existsSync(path.join(pastaTemporaria, "segredos.bin")));
});

test("o resumo não devolve a chave, só os últimos quatro", () => {
  segredos.guardar(CHAVE_FALSA);
  const resumo = segredos.resumo();

  assert.equal(resumo.presente, true);
  assert.equal(resumo.ultimos4, CHAVE_FALSA.slice(-4));
  assert.ok(!JSON.stringify(resumo).includes(CHAVE_FALSA));
});

test("sem chave guardada, o resumo diz que não há", () => {
  const resumo = segredos.resumo();
  assert.deepEqual(resumo, {
    presente: false,
    ultimos4: null,
    gravadoEm: null,
  });
});

test("trocar a chave não deixa a anterior no disco", () => {
  const antiga = "sk-or-v1-antiga00000000000000000000000000";
  segredos.guardar(antiga);
  segredos.guardar(CHAVE_FALSA);

  const bytes = fs.readFileSync(path.join(pastaTemporaria, "segredos.bin"));
  const claro = electronFalso.safeStorage.decryptString(bytes);
  assert.ok(!claro.includes(antiga));
  assert.equal(segredos.ler(), CHAVE_FALSA);
});

test("apagar remove o arquivo e o temporário", () => {
  segredos.guardar(CHAVE_FALSA);
  segredos.apagar();

  assert.equal(segredos.ler(), null);
  assert.ok(!fs.existsSync(path.join(pastaTemporaria, "segredos.bin")));
});

test("chave ilegível vira ausência, não exceção", () => {
  /* Perfil do Windows trocado: o DPAPI está atrelado a outra conta e o arquivo
     não decifra mais. Quem chama trata como "não há chave" e o usuário cola
     outra — melhor que uma exceção que trava a tela de Ajustes. */
  fs.writeFileSync(
    path.join(pastaTemporaria, "segredos.bin"),
    Buffer.from([1, 2, 3, 4])
  );
  assert.equal(segredos.ler(), null);
  assert.equal(segredos.resumo().presente, false);
});

test("a chave fica fora da pasta do cofre", () => {
  /* `cofre.esvaziar()` apaga a pasta `cofre/` inteira com `rmSync` recursivo.
     Guardar a credencial lá dentro faria "esvaziar a biblioteca" levar a chave
     junto — e a faxina de `*.tmp` do cofre disputaria um arquivo que não é
     dela. */
  segredos.guardar(CHAVE_FALSA);
  assert.ok(fs.existsSync(path.join(pastaTemporaria, "segredos.bin")));
  assert.ok(!fs.existsSync(path.join(pastaTemporaria, "cofre", "segredos.bin")));
});
