import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone";

/**
 * Estado vazio — a tela sem nada ainda, dizendo o que fazer.
 *
 * Um espaço em branco é um convite, e o convite precisa estar escrito: o que
 * este lugar mostra quando tiver algo, e qual é o primeiro passo. O texto
 * explica; o botão faz. Sem tom de desculpa — vazio não é erro.
 */

interface VazioProps {
  icone?: NomeIcone;
  titulo: string;
  children?: ReactNode;
  /** Normalmente um `Botao` primário. */
  acao?: ReactNode;
  className?: string;
}

export function Vazio({ icone, titulo, children, acao, className = "" }: VazioProps) {
  return (
    <div
      className={[
        "mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center",
        className,
      ].join(" ")}
    >
      {icone && (
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-surface-sunken text-text-tertiary">
          <Icone nome={icone} tamanho={20} />
        </span>
      )}
      <h2 className="font-mono text-base font-semibold text-text">{titulo}</h2>
      {children && (
        <div className="mt-2 text-sm leading-relaxed text-text-secondary">{children}</div>
      )}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}
