import { useMemo, useState } from "react";
import { pastasDe } from "../hooks/useBiblioteca";
import { Botao, Cartao, Carimbo, Campo, Selo, Tabela, Dialogo } from "../ui";
import type { ColunaTabela } from "../ui";
import { rotuloDaEntidade, corDaEntidade } from "../types";

/**
 * Documentos — a biblioteca.
 *
 * **Tabela, não grade de cartões.** A tarefa aqui é varrer: achar um processo
 * por nome, data e contagem de ocorrências. Cartão mostra bem um item; tabela
 * compara trinta. E um índice de cartório é uma tabela.
 *
 * A numeração fala o vocabulário dos autos — "fls. 1–14", não "01 / 02 / 03".
 * Número só onde a ordem carrega informação.
 */

/* Sentinela do filtro "todos". Nomeado, e nao um espaco inicial:
   um separador invisivel se perde em edicao (esta constante chegou a
   guardar um byte NUL por causa disso, e um NUL no fonte deixa o
   parser do bundler em comportamento indefinido). O prefixo garante
   que nunca colida com um numero CNJ de verdade. */
const PASTA_TODAS = "@todas";

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

interface DocumentosProps {
  itens: EntradaDoCofre[];
  cofreDisponivel: boolean | null;
  cofreLigado: boolean;
  expurgados: number;
  aoAbrir: (item: EntradaDoCofre) => void;
  aoApagar: (id: string) => void;
}

export function Documentos({
  itens,
  cofreDisponivel,
  cofreLigado,
  expurgados,
  aoAbrir,
  aoApagar,
}: DocumentosProps) {
  const [pasta, setPasta] = useState<string>(PASTA_TODAS);
  const [busca, setBusca] = useState("");
  const [paraApagar, setParaApagar] = useState<EntradaDoCofre | null>(null);

  const pastas = useMemo(() => pastasDe(itens), [itens]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (pasta === "Avulsos" && i.cnj) return false;
      if (pasta !== PASTA_TODAS && pasta !== "Avulsos" && i.cnj !== pasta)
        return false;
      if (!termo) return true;
      return (
        i.nome.toLowerCase().includes(termo) ||
        (i.cnj?.toLowerCase().includes(termo) ?? false)
      );
    });
  }, [itens, pasta, busca]);

  const colunas: ColunaTabela<EntradaDoCofre>[] = [
    {
      chave: "documento",
      cabecalho: "Documento",
      render: (i) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {i.paginasComErro > 0 ? (
              /* Página que precisava de OCR e não voltou. O texto dela não está
                 no resultado — quem revisa precisa saber antes de assinar. */
              <Carimbo tom="perigo">
                {`${i.paginasComErro} falha${i.paginasComErro > 1 ? "s" : ""}`}
              </Carimbo>
            ) : (
              <Carimbo>Anonimiz</Carimbo>
            )}
            <span className="truncate text-sm text-text">{i.nome}</span>
          </div>
          <p className="mt-1 font-mono text-2xs text-text-tertiary">
            {i.cnj ?? "Avulsos"} · {dataCurta(i.gravadoEm)}
            {i.totalPaginas > 0 && ` · fls. 1–${i.totalPaginas}`}
          </p>
        </div>
      ),
    },
    {
      chave: "tipos",
      cabecalho: "Encontrado",
      render: (i) => (
        <div className="flex flex-wrap gap-1">
          {Object.entries(i.porTipo)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tipo, n]) => (
              <Selo key={tipo} tom="entidade" cor={corDaEntidade(tipo)}>
                {rotuloDaEntidade(tipo)} {n}
              </Selo>
            ))}
        </div>
      ),
    },
    {
      chave: "total",
      cabecalho: "Ocorrências",
      numerica: true,
      render: (i) => i.totalOcorrencias.toLocaleString("pt-BR"),
    },
    {
      chave: "acoes",
      cabecalho: "",
      estreita: true,
      render: (i) => (
        <div className="flex gap-1.5">
          <Botao tamanho="mini" onClick={() => aoAbrir(i)}>
            Abrir
          </Botao>
          <Botao
            tamanho="mini"
            tipo="discreto"
            icone="lixeira"
            aria-label={`Apagar ${i.nome}`}
            onClick={() => setParaApagar(i)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-8 py-8">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-text">
            Documentos
          </h1>
          <Campo
            rotulo="Buscar"
            placeholder="nome ou número do processo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-64"
          />
        </div>

        {cofreDisponivel === false && (
          <Cartao titulo="Cofre indisponível">
            <p className="text-sm text-text-secondary">
              O sistema não oferece cifragem para esta conta, e o cofre não grava
              em claro. Documentos anonimizados continuam podendo ser salvos onde
              você escolher — só não ficam guardados aqui para reabrir.
            </p>
          </Cartao>
        )}

        {cofreDisponivel && !cofreLigado && itens.length === 0 && (
          <Cartao titulo="O cofre está desligado">
            <p className="text-sm text-text-secondary">
              Nada é guardado em disco. Ao anonimizar um documento, o aplicativo
              vai perguntar se você quer guardá-lo aqui — e explicar exatamente
              o que passa a ficar gravado.
            </p>
          </Cartao>
        )}

        {expurgados > 0 && (
          <p role="status" className="text-xs text-text-tertiary">
            {expurgados} documento{expurgados > 1 ? "s" : ""} saíram do cofre por
            terem passado do prazo de guarda.
          </p>
        )}

        {itens.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setPasta(PASTA_TODAS)}
                aria-pressed={pasta === PASTA_TODAS}
                className={[
                  "min-h-6 rounded px-2.5 py-1 font-mono text-2xs tracking-wide uppercase",
                  pasta === PASTA_TODAS
                    ? "bg-accent text-on-accent"
                    : "text-text-tertiary hover:bg-surface-hover",
                ].join(" ")}
              >
                Todos
              </button>
              {pastas.map((p) => (
                <button
                  key={p}
                  onClick={() => setPasta(p)}
                  aria-pressed={pasta === p}
                  className={[
                    "min-h-6 rounded px-2.5 py-1 font-mono text-2xs tracking-wide",
                    pasta === p
                      ? "bg-accent text-on-accent"
                      : "text-text-tertiary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {p}
                </button>
              ))}
            </div>

            <Cartao semPreenchimento>
              <Tabela
                rotulo="Documentos guardados"
                colunas={colunas}
                linhas={visiveis}
                chaveDaLinha={(i) => i.id}
                vazio={
                  busca
                    ? "Nenhum documento com esse termo."
                    : "Nenhum documento nesta pasta."
                }
              />
            </Cartao>
          </>
        )}

        <Dialogo
          aberto={paraApagar !== null}
          aoFechar={() => setParaApagar(null)}
          titulo="Apagar do cofre"
          acoes={
            <>
              <Botao tipo="secundario" onClick={() => setParaApagar(null)}>
                Cancelar
              </Botao>
              <Botao
                tipo="perigo"
                onClick={() => {
                  if (paraApagar) aoApagar(paraApagar.id);
                  setParaApagar(null);
                }}
              >
                Apagar
              </Botao>
            </>
          }
        >
          <p>
            <strong className="text-text">{paraApagar?.nome}</strong> sai do
            cofre e não poderá ser reaberto. Os arquivos que você já salvou em
            disco não são afetados.
          </p>
        </Dialogo>
      </div>
    </div>
  );
}
