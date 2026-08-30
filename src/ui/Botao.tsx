import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone";

/**
 * Botão — a voz da máquina, sempre em mono.
 *
 * Quatro tipos, e a escolha não é decorativa:
 *
 * | tipo | quando | quantos por tela |
 * |---|---|---|
 * | `primario`   | a ação que a tela existe para fazer | **um** |
 * | `secundario` | alternativa legítima, mesmo peso de risco | vários |
 * | `discreto`   | ação de apoio, some no fundo | vários |
 * | `perigo`     | apaga, revoga, esvazia — não tem volta | raro |
 *
 * O alvo mínimo é 24px de altura mesmo no tamanho `mini`, que é o piso de
 * WCAG 2.2 para alvo de ponteiro. Um botão de 20px passa despercebido na
 * revisão de código e reprova na auditoria.
 */

type TipoBotao = "primario" | "secundario" | "discreto" | "perigo";
type TamanhoBotao = "mini" | "normal";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tipo?: TipoBotao;
  tamanho?: TamanhoBotao;
  icone?: NomeIcone;
  /** Põe o ícone depois do texto — para "avançar", "abrir em…". */
  iconeAoFim?: boolean;
  children?: ReactNode;
}

const POR_TIPO: Record<TipoBotao, string> = {
  primario:
    "bg-accent text-on-accent border border-transparent hover:bg-accent-hover",
  secundario:
    "bg-surface text-text border border-border hover:bg-surface-hover",
  discreto:
    "bg-transparent text-text-secondary border border-transparent hover:bg-surface-hover hover:text-text",
  /* Perigo é contorno, não preenchimento: um botão vermelho sólido chama mais
     atenção do que a ação merece e vira ruído numa tela cheia de itens. O
     preenchimento só aparece no hover, quando o ponteiro já está sobre ele. */
  perigo:
    "bg-transparent text-danger border border-danger hover:bg-danger hover:text-on-accent",
};

const POR_TAMANHO: Record<TamanhoBotao, string> = {
  mini: "min-h-6 gap-1.5 px-2 py-1 text-2xs",
  normal: "min-h-9 gap-2 px-3.5 py-2 text-xs",
};

export function Botao({
  tipo = "secundario",
  tamanho = "normal",
  icone,
  iconeAoFim = false,
  children,
  className = "",
  disabled,
  ...resto
}: BotaoProps) {
  const glifo = icone ? (
    <Icone nome={icone} tamanho={tamanho === "mini" ? 12 : 14} />
  ) : null;

  return (
    <button
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-md font-mono font-medium",
        "uppercase tracking-wide whitespace-nowrap transition-colors duration-[120ms]",
        "disabled:pointer-events-none disabled:opacity-40",
        POR_TIPO[tipo],
        POR_TAMANHO[tamanho],
        className,
      ].join(" ")}
      disabled={disabled}
      {...resto}
    >
      {!iconeAoFim && glifo}
      {children}
      {iconeAoFim && glifo}
    </button>
  );
}
