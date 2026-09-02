import type { ReactNode } from "react";

/**
 * Linha de ajuste — um nome, uma explicação, um controle.
 *
 * É a unidade da tela de Ajustes, e existe porque a tela anterior montava cada
 * configuração de um jeito: uns com `border-t`, outros sem; uns com o controle
 * ao lado, outros embaixo; a explicação ora em serifa, ora em mono. O olho não
 * achava o padrão, e sem padrão não há como varrer uma lista de ajustes — só
 * dá para ler um por um.
 *
 * Aqui a forma é fixa: título em mono (é o nome de um controle, a máquina
 * falando), explicação em serifa logo abaixo (é prosa, lê-se), e o controle
 * alinhado à direita. Controle largo — um campo de texto, uma lista — pede
 * `empilhado`, e desce para baixo do texto sem mudar o resto.
 *
 * As linhas se separam por fio; quem as agrupa usa `divide-y`.
 */

interface LinhaDeAjusteProps {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** O controle. À direita por padrão; embaixo com `empilhado`. */
  children?: ReactNode;
  /** Para controle que precisa da largura toda. */
  empilhado?: boolean;
  className?: string;
}

export function LinhaDeAjuste({
  titulo,
  descricao,
  children,
  empilhado = false,
  className = "",
}: LinhaDeAjusteProps) {
  return (
    <div
      className={[
        empilhado ? "py-4" : "flex items-center justify-between gap-6 py-4",
        className,
      ].join(" ")}
    >
      <div className="min-w-0">
        <p className="font-mono text-sm text-text">{titulo}</p>
        {descricao && (
          <p className="mt-0.5 max-w-prose text-xs leading-normal text-text-tertiary">
            {descricao}
          </p>
        )}
      </div>
      {children !== undefined && children !== null && (
        <div className={empilhado ? "mt-3" : "shrink-0"}>{children}</div>
      )}
    </div>
  );
}
