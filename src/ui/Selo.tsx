import type { ReactNode } from "react";

/**
 * Selo — rótulo curto de estado ou contagem, em mono.
 *
 * Usado para o estado do motor, o tipo de uma ocorrência, a contagem por
 * entidade. É a voz da máquina, então nunca leva serifa.
 *
 * O tom `entidade` recebe a cor por `cor`, que deve ser uma referência CSS
 * vinda de `corDaEntidade()` — nunca um hex. O fundo sai da mesma cor por
 * `color-mix`, para o selo acompanhar o tema sem uma segunda tabela de cores.
 */

type TomSelo = "neutro" | "acao" | "perigo" | "atencao" | "deferido" | "entidade";

interface SeloProps {
  children: ReactNode;
  tom?: TomSelo;
  /** Só para `tom="entidade"`: uma referência como `var(--color-entity-cpf)`. */
  cor?: string;
  /** Ponto sólido antes do texto — para estado ligado/desligado. */
  comPonto?: boolean;
  className?: string;
}

const POR_TOM: Record<Exclude<TomSelo, "entidade">, string> = {
  neutro: "text-text-secondary bg-surface-sunken",
  acao: "text-accent bg-accent-muted",
  perigo: "text-danger bg-danger/10",
  atencao: "text-warning bg-warning/10",
  deferido: "text-success bg-success/10",
};

export function Selo({
  children,
  tom = "neutro",
  cor,
  comPonto = false,
  className = "",
}: SeloProps) {
  const porEntidade = tom === "entidade" && cor;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
        "font-mono text-2xs font-medium whitespace-nowrap",
        porEntidade ? "" : POR_TOM[tom as Exclude<TomSelo, "entidade">],
        className,
      ].join(" ")}
      style={
        porEntidade
          ? {
              color: cor,
              backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,
            }
          : undefined
      }
    >
      {comPonto && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
