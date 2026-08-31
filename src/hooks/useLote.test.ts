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
