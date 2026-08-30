import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import type { AcaoApp, ArquivoNaFila } from "../estado/tipos";
import type { EntityType, PoliticaMascara, ProcessedFile } from "../types";

/**
 * Orquestra o lote: percorre a fila, chama o backend por arquivo e traduz o
 * andamento em estado.
 *
 * Vinha embutido no `App` como uma função de ~130 linhas que misturava laço,
 * tratamento de erro, navegação de tela e montagem de mensagem. Aqui só resta
 * a orquestração; para onde ir depois é decisão de quem chama.
 *
 * ## Sobre o `flush()` que existia aqui
 *
 * A versão anterior chamava `await new Promise(r => setTimeout(r, 0))` seis
 * vezes, comentado como "força o React a processar state updates pendentes".
 * Não era necessário: toda iteração contém um `await` de rede — a própria
 * chamada ao backend —, e isso cede o event loop com folga para o React pintar.
 * Os `flush` estavam sempre a um passo de um `await` verdadeiro. Ritual sem
 * causa entendida é o código mais caro de manter, então saiu.
 */

interface EntradaProcessar {
  caminho?: string;
  texto?: string;
  nomeArquivo: string;
}

interface ResultadoBackend {
  texto_original: string;
  anonymized_text: string;
  entities_found: ProcessedFile["entitiesFound"];
  ocr?: ProcessedFile["ocr"];
}

interface DependenciasLote {
  despachar: Dispatch<AcaoApp>;
  processar: (
    entrada: EntradaProcessar,
    entidades: EntityType[],
    politica: PoliticaMascara,
    aoProgredir: (p: { atual: number; total: number; etapa: string }) => void,
    sinal: AbortSignal
  ) => Promise<ResultadoBackend>;
  extractText: (conteudo: string, formato: string) => Promise<string>;
}

export interface ResultadoLote {
  processados: ProcessedFile[];
  falhas: { nome: string; motivo: string }[];
  cancelado: boolean;
}

export function useLote({ despachar, processar, extractText }: DependenciasLote) {
  const cancelamento = useRef<AbortController | null>(null);

  const cancelar = useCallback(() => cancelamento.current?.abort(), []);

  const executar = useCallback(
    async (
      fila: ArquivoNaFila[],
      entidades: EntityType[],
      politica: PoliticaMascara
    ): Promise<ResultadoLote> => {
      const processados: ProcessedFile[] = [];
      /* Nome **e** motivo: dizer só que falhou deixa quem opera sem pista do
         que fazer, e a causa costuma ser acionável (arquivo grande demais,
         backend fora do ar, formato recusado). */
      const falhas: { nome: string; motivo: string }[] = [];

      const controle = new AbortController();
      cancelamento.current = controle;

      despachar({
        tipo: "iniciar-lote",
        total: fila.length,
        primeiroNome: fila[0]?.name ?? "",
      });

      try {
        for (let i = 0; i < fila.length; i++) {
          if (controle.signal.aborted) break;
          const arquivo = fila[i];

          try {
            /* Tudo aqui dentro, sem exceção.
               Estas três linhas ficavam FORA do try, e uma delas estourando
               levava o lote inteiro: a exceção subia por `executar`, o
               `finally` fechava a tela de progresso, e o aplicativo voltava
               para a Mesa **sem mensagem nenhuma** — porque a montagem do aviso
               acontece depois do `await`, que nunca retornava. Um lote pode
               falhar; ele não pode sumir. */
            const ehRtf = arquivo.name.toLowerCase().endsWith(".rtf");

            despachar({
              tipo: "estado-do-arquivo",
              caminho: arquivo.path,
              estado: arquivo.precisaExtracao ? "lendo" : "anonimizando",
            });

            /* Documento binário (PDF, DOCX, imagem) é lido pelo backend, que
               faz OCR quando a página é digitalizada. Texto já em mãos vai
               direto — só o RTF precisa de uma conversão antes. */
            const entrada: EntradaProcessar = arquivo.precisaExtracao
              ? { caminho: arquivo.path, nomeArquivo: arquivo.name }
              : {
                  texto: ehRtf
                    ? await extractText(arquivo.content, "rtf")
                    : arquivo.content,
                  nomeArquivo: arquivo.name,
                };

            const resultado = await processar(
              entrada,
              entidades,
              politica,
              (p) =>
                despachar({
                  tipo: "progresso",
                  progresso: {
                    atual: p.atual,
                    total: p.total,
                    nomeArquivo: arquivo.name,
                    etapa:
                      fila.length > 1
                        ? `${p.etapa} (${i + 1} de ${fila.length})`
                        : p.etapa,
                  },
                }),
              controle.signal
            );

            processados.push({
              originalName: arquivo.name,
              originalPath: arquivo.path,
              originalContent: resultado.texto_original,
              anonymizedContent: resultado.anonymized_text,
              entitiesFound: resultado.entities_found,
              ocr: resultado.ocr,
            });

            despachar({
              tipo: "estado-do-arquivo",
              caminho: arquivo.path,
              estado: "pronto",
            });
          } catch (erro) {
            if (controle.signal.aborted) break;
            // Um arquivo problemático não pode levar o lote inteiro junto.
            const motivo =
              erro instanceof Error ? erro.message : "erro desconhecido";
            falhas.push({ nome: arquivo?.name ?? `arquivo ${i + 1}`, motivo });
            despachar({
              tipo: "estado-do-arquivo",
              caminho: arquivo?.path ?? "",
              estado: "falhou",
              motivo,
            });
            console.error(`Falha em ${arquivo?.name ?? i}:`, erro);
          }
        }
      } finally {
        cancelamento.current = null;
        despachar({ tipo: "encerrar-lote" });
      }

      return { processados, falhas, cancelado: controle.signal.aborted };
    },
    [despachar, processar, extractText]
  );

  return { executar, cancelar };
}

/**
 * Monta a mensagem de fim de lote. Fora do hook porque é decisão de
 * apresentação, e porque assim dá para testá-la sem React.
 */
export function mensagemDoLote(
  { processados, falhas, cancelado }: ResultadoLote,
  totalNaFila: number
): { mensagem: string; tipo: "sucesso" | "erro" } | null {
  if (cancelado) return { mensagem: "Anonimização cancelada.", tipo: "erro" };
  if (falhas.length === 0) return null;

  /* Com um arquivo só, o motivo é a informação inteira: sem ele a pessoa fica
     olhando para "não deu" sem saber se tenta de novo, troca o arquivo ou
     reinicia o aplicativo. */
  const detalhe =
    falhas.length === 1
      ? falhas[0].motivo
      : falhas.map((f) => `${f.nome}: ${f.motivo}`).join(" · ");

  return {
    mensagem:
      falhas.length === totalNaFila
        ? `Não foi possível processar. ${detalhe}`
        : `${processados.length} de ${totalNaFila} processados. ${detalhe}`,
    tipo: "erro",
  };
}
