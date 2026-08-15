/**
 * Integração: o token lido da saída do backend precisa ser aceito por ele.
 *
 * Este teste existe por causa de um defeito real. O leitor casava a expressão
 * regular contra cada pedaço da saída padrão; quando o token vinha partido
 * entre dois eventos, o Electron guardava metade do segredo e o aplicativo
 * respondia 403 em todo documento — sem nenhum sinal disso na abertura, porque
 * `/health` não exige credencial.
 *
 * Os testes de unidade cobrem o fatiamento; este fecha o circuito com o
 * servidor de verdade: sobe o backend, lê o token como o Electron lê e usa a
 * credencial numa rota protegida.
 *
 * Rode com `npm run test:electron` (usa o Python do .venv).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { criarLeitorDeSaida } from "../dist-electron/saidaBackend.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = path.join(RAIZ, ".venv", "bin", "python");
const SERVIDOR = path.join(RAIZ, "python-backend", "server.py");
const PORTA = 8247;
const BASE = `http://127.0.0.1:${PORTA}`;

const temAmbiente = existsSync(PYTHON) && existsSync(SERVIDOR);

test(
  "o token lido da saída é aceito nas rotas protegidas",
  { skip: temAmbiente ? false : "backend Python indisponível" },
  async (t) => {
    let token = "";
    const backend = spawn(PYTHON, [SERVIDOR, "--port", String(PORTA)], {
      // Modo leve: o teste é sobre a credencial, não sobre a qualidade do NER.
      env: { ...process.env, PYTHONUNBUFFERED: "1", PRESIDIO_NLP_MODE: "spacy" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const leitor = criarLeitorDeSaida({
      aoReceberToken: (t) => (token = t),
      aoRegistrar: () => {},
    });
    backend.stdout.on("data", (d) => leitor.consumir(d.toString()));

    t.after(() => backend.kill("SIGTERM"));

    // Espera o servidor atender. `/health` é público — é justamente por isso
    // que o defeito passava despercebido.
    const limite = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > limite) throw new Error("o backend não subiu a tempo");
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok && (await r.json()).status === "ready") break;
      } catch {
        // ainda subindo
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    assert.ok(token, "o token precisa ter sido anunciado antes do servidor abrir");
    assert.ok(token.length >= 40, `token truncado: ${token.length} caracteres`);

    const pedir = (credencial) =>
      fetch(`${BASE}/processar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Presidio-Token": credencial,
        },
        body: JSON.stringify({
          texto: "Fulano de Tal, CPF 529.982.247-25.",
          nome_arquivo: "teste.txt",
          entities: ["PERSON", "CPF_BR"],
          language: "pt",
        }),
      });

    const aceita = await pedir(token);
    assert.equal(aceita.status, 200, "a credencial lida da saída deve ser aceita");

    // O que o aplicativo fazia sem querer: mandar metade do segredo.
    const truncada = await pedir(token.slice(0, 15));
    assert.equal(truncada.status, 403, "meio token não pode passar");

    const vazia = await pedir("");
    assert.equal(vazia.status, 403, "sem credencial não passa");
  }
);
