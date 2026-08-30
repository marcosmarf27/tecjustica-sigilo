import type { ReactNode } from "react";

/**
 * Tabela — o índice de cartório.
 *
 * A biblioteca de documentos é tabela e não grade de cartões porque a tarefa é
 * varrer: achar um processo por nome, data e contagem de ocorrências. Cartão
 * mostra bem um item; tabela compara trinta.
 *
 * Números vão alinhados à direita e com `tabular-nums`, para que as casas
 * fiquem em coluna e a diferença entre 3.615 e 361 salte à vista. A fonte mono
 * já é de largura fixa, mas `tabular-nums` também trava a largura dos dígitos
 * em fontes proporcionais, então a regra vale para os dois casos.
 */

export interface ColunaTabela<L> {
  chave: string;
  cabecalho: string;
  /** Alinha à direita e aplica `tabular-nums`. */
  numerica?: boolean;
  /** Não deixa a coluna encolher — para a de ações. */
  estreita?: boolean;
  render: (linha: L) => ReactNode;
}

interface TabelaProps<L> {
  colunas: readonly ColunaTabela<L>[];
  linhas: readonly L[];
  chaveDaLinha: (linha: L) => string;
  /** Clique na linha inteira. Torna a linha um alvo de teclado. */
  aoAbrir?: (linha: L) => void;
  /** O que mostrar quando não há nenhuma linha. */
  vazio?: ReactNode;
  rotulo: string;
}

export function Tabela<L>({
  colunas,
  linhas,
  chaveDaLinha,
  aoAbrir,
  vazio,
  rotulo,
}: TabelaProps<L>) {
  if (linhas.length === 0 && vazio) {
    return <div className="px-4 py-10 text-center text-sm text-text-tertiary">{vazio}</div>;
  }

  return (
    /* A rolagem horizontal fica presa neste contêiner: a página em volta nunca
       rola de lado, por mais larga que a tabela fique. */
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left" aria-label={rotulo}>
        <thead>
          <tr className="border-b border-border-subtle">
            {colunas.map((coluna) => (
              <th
                key={coluna.chave}
                scope="col"
                className={[
                  "px-4 py-2 font-mono text-2xs font-medium tracking-wide",
                  "text-text-tertiary uppercase",
                  coluna.numerica ? "text-right" : "",
                  coluna.estreita ? "w-px whitespace-nowrap" : "",
                ].join(" ")}
              >
                {coluna.cabecalho}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={chaveDaLinha(linha)}
              /* Sem `aoAbrir` a linha não é interativa e não pode virar parada
                 de teclado — um `tabIndex` que não leva a lugar nenhum é ruído
                 para quem navega por Tab. */
              tabIndex={aoAbrir ? 0 : undefined}
              onClick={aoAbrir ? () => aoAbrir(linha) : undefined}
              onKeyDown={
                aoAbrir
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        aoAbrir(linha);
                      }
                    }
                  : undefined
              }
              className={[
                "border-b border-border-subtle last:border-0",
                aoAbrir ? "cursor-pointer hover:bg-surface-hover" : "",
              ].join(" ")}
            >
              {colunas.map((coluna) => (
                <td
                  key={coluna.chave}
                  className={[
                    "px-4 py-3 text-sm text-text",
                    coluna.numerica ? "text-right font-mono tabular-nums" : "",
                    coluna.estreita ? "w-px whitespace-nowrap" : "",
                  ].join(" ")}
                >
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
