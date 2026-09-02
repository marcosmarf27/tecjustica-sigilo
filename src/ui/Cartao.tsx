import type { ReactNode } from "react";

/**
 * Cartão — a folha sobre a mesa.
 *
 * A relação de claro/escuro aqui é o contrário do que a maioria dos sistemas
 * escuros faz, e é proposital: `--folha` é **mais clara** que `--papel`. Uma
 * folha apoiada numa mesa recebe mais luz que a mesa; inverter isso faz o
 * cartão parecer um buraco em vez de um objeto pousado.
 *
 * A sombra é curta e fria (`--shadow-sm`) — papel encostado, não flutuando.
 */

interface CartaoProps {
  children: ReactNode;
  /** Título curto em mono, com o fio de divisão abaixo. */
  titulo?: string;
  /** Linha de apoio sob o título, em serifa. */
  descricao?: string;
  /** Canto superior direito do cabeçalho — normalmente um `Botao` mini. */
  acao?: ReactNode;
  /** Tira o preenchimento interno, para tabela que sangra até a borda. */
  semPreenchimento?: boolean;
  className?: string;
}

export function Cartao({
  children,
  titulo,
  descricao,
  acao,
  semPreenchimento = false,
  className = "",
}: CartaoProps) {
  return (
    <section
      className={[
        "rounded-lg border border-border-subtle bg-surface shadow-sm",
        className,
      ].join(" ")}
    >
      {(titulo || acao) && (
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            {titulo && (
              <h2 className="font-mono text-sm font-semibold text-text">{titulo}</h2>
            )}
            {descricao && (
              <p className="mt-0.5 text-xs leading-normal text-text-tertiary">{descricao}</p>
            )}
          </div>
          {acao && <div className="shrink-0">{acao}</div>}
        </header>
      )}
      <div className={semPreenchimento ? "" : "p-4"}>{children}</div>
    </section>
  );
}
