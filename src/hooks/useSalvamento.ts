import { useCallback } from "react";
import { caminhoDeSaida, nomeDeSaida } from "../lib/nomeDeSaida";
import type { FormatoSaida } from "../lib/nomeDeSaida";
import { gerarDocx } from "../lib/gerarDocx";
import type { ProcessedFile } from "../types";

/**
 * Gravar o resultado em disco (Electron) ou baixar (navegador).
 *
 * Saiu do `App` inteiro. A regra que atravessa tudo aqui está em
 * `lib/nomeDeSaida.ts` e não tem exceção: **a saída é texto, nunca o formato de
 * entrada.** Gravar markdown num arquivo `.pdf` produz algo que nenhum leitor
 * abre — foi o comportamento anterior para `.pdf`, `.docx`, `.xlsx` e imagens.
 * A extensão descreve o que o arquivo **é**.
 */

interface DependenciasSalvamento {
  avisar: (mensagem: string, tipo?: "sucesso" | "erro") => void;
  formato: FormatoSaida;
  /** `null` = ao lado do original. */
  pastaDeSaida: string | null;
}

/** O conteúdo a gravar, no formato escolhido. DOCX vira base64. */
async function conteudoDeSaida(arquivo: ProcessedFile, formato: FormatoSaida) {
  if (formato !== "docx") {
    return { texto: arquivo.anonymizedContent, binario: false as const };
  }
  const blob = await gerarDocx(arquivo.anonymizedContent, {
    nomeOriginal: arquivo.originalName,
    ocorrencias: arquivo.entitiesFound.length,
    paginasOcr: arquivo.ocr?.paginas_ocr,
    paginasComErro: arquivo.ocr?.paginas_com_erro,
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  /* Em fatias: `String.fromCharCode(...bytes)` com um documento grande estoura
     o limite de argumentos da chamada e derruba a aba com RangeError. */
  let bruto = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bruto += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return { texto: btoa(bruto), binario: true as const, blob };
}

export function useSalvamento({
  avisar,
  formato,
  pastaDeSaida,
}: DependenciasSalvamento) {
  const caminhoPara = useCallback(
    (arquivo: ProcessedFile) => {
      if (!window.electronAPI) return nomeDeSaida(arquivo.originalName, formato);
      const nome = nomeDeSaida(arquivo.originalName, formato);
      if (pastaDeSaida) {
        const sep = pastaDeSaida.includes("\\") ? "\\" : "/";
        return `${pastaDeSaida}${pastaDeSaida.endsWith(sep) ? "" : sep}${nome}`;
      }
      return caminhoDeSaida(arquivo.originalPath, arquivo.originalName, formato);
    },
    [formato, pastaDeSaida]
  );

  /**
   * Grava tudo e **relata o que de fato foi para o disco**.
   *
   * O processo principal já perguntava antes de substituir um arquivo existente
   * e devolvia `{ salvo: false, motivo: "cancelado" }` quando o usuário recusava
   * — só que este hook descartava o retorno e contava o arquivo como gravado.
   * O resultado era o pior aviso possível: clicar em "Cancelar" e receber
   * "Salvo em: C:\...", com o arquivo antigo intacto no disco e o novo em lugar
   * nenhum. Quem confia no aviso fecha o aplicativo achando que entregou o
   * documento anonimizado.
   *
   * O tipo em `vite-env.d.ts` já descrevia o retorno certo; ignorá-lo é legal em
   * TypeScript, então nenhum typecheck pegaria. Daí o cuidado explícito aqui.
   */
  const salvarTodos = useCallback(
    async (arquivos: ProcessedFile[]) => {
      const gravados: string[] = [];
      let cancelados = 0;

      try {
        for (const arquivo of arquivos) {
          const destino = caminhoPara(arquivo);
          const saida = await conteudoDeSaida(arquivo, formato);

          if (window.electronAPI) {
            const resultado = saida.binario
              ? await window.electronAPI.saveFileBinary(destino, saida.texto)
              : await window.electronAPI.saveFile(destino, saida.texto);
            /* `salvo: false` é a recusa de substituir, e não uma falha: o
               arquivo anterior continua lá, de propósito. Não conta como
               gravado, e também não interrompe os outros do lote. */
            if (!resultado?.salvo) {
              cancelados += 1;
              continue;
            }
          } else {
            const blob =
              saida.blob ?? new Blob([saida.texto], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = destino;
            a.click();
            URL.revokeObjectURL(url);
          }
          gravados.push(destino);
        }

        const recusados =
          cancelados > 0
            ? ` ${cancelados} não ${cancelados > 1 ? "foram substituídos" : "foi substituído"}.`
            : "";

        if (gravados.length === 0) {
          /* Nada foi para o disco. Tom de erro, e não de sucesso: o visto verde
             ao lado de "nenhum arquivo salvo" é exatamente a mentira que este
             conserto elimina. */
          avisar(
            cancelados > 0
              ? "Nenhum arquivo salvo — você escolheu não substituir."
              : "Nenhum arquivo salvo.",
            "erro"
          );
        } else if (gravados.length === 1) {
          avisar(`Salvo em: ${gravados[0]}.${recusados}`, "sucesso");
        } else {
          const sep = gravados[0].includes("\\") ? "\\" : "/";
          const pasta = gravados[0].substring(0, gravados[0].lastIndexOf(sep));
          avisar(
            `${gravados.length} arquivos salvos em: ${pasta || "Downloads"}.${recusados}`,
            "sucesso"
          );
        }
      } catch (erro) {
        avisar(
          `Erro ao salvar: ${erro instanceof Error ? erro.message : "erro desconhecido"}`,
          "erro"
        );
      }
    },
    [avisar, caminhoPara, formato]
  );

  const baixarUm = useCallback(
    async (arquivo: ProcessedFile) => {
      const nome = nomeDeSaida(arquivo.originalName, formato);
      const saida = await conteudoDeSaida(arquivo, formato);
      const blob =
        saida.blob ??
        new Blob([saida.texto], {
          type: nome.endsWith(".md") ? "text/markdown" : "text/plain",
        });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
      avisar(`Download: ${nome}`, "sucesso");
    },
    [avisar, formato]
  );

  return { salvarTodos, baixarUm };
}
