import { defineConfig } from "vitest/config";

/**
 * Testes do **renderer**, e só dele.
 *
 * O `electron/` tem sua própria suíte em `node --test` (`npm run test:electron`),
 * escrita contra `node:test` e rodando sobre o JavaScript já compilado — ela
 * precisa do módulo `electron` interceptado no `require`, o que não faz sentido
 * aqui. Sem este recorte o vitest tenta coletar aqueles arquivos e reprova três
 * suítes que passam perfeitamente no runner delas.
 *
 * Duas suítes, dois runners, um recorte explícito para cada. Vale mais que uma
 * configuração esperta que tente servir aos dois.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
