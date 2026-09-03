import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
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
type TamanhoBotao = "mini" | "normal" | "grande";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tipo?: TipoBotao;
  tamanho?: TamanhoBotao;
  icone?: NomeIcone;
  /** Põe o ícone depois do texto — para "avançar", "abrir em…". */
  iconeAoFim?: boolean;
  /** Só ícone, redondo — o "enviar" da conversa. Exige `aria-label`. */
  circular?: boolean;
  children?: ReactNode;
  /* React 19 trata `ref` como prop comum de componente de função, e o
     `...resto` já a entrega ao <button>. Só faltava o tipo dizer isso — sem
     esta linha o `Popover` não aceita um `Botao` como gatilho, porque ele
     precisa devolver o foco ao elemento que o abriu. */
  ref?: Ref<HTMLButtonElement>;
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

/* Caixa baixa, de propósito. Os botões saíam em CAIXA ALTA com entreletra
   larga, e isso — mais do que qualquer cor — é o que fazia a interface parecer
   um painel de terminal de dez anos atrás. A voz continua sendo a mono; ela só
   parou de gritar. A caixa alta com entreletra ficou reservada aos rótulos
   pequenos de seção (≤ 12px), onde é sinalização e não fala. */
const POR_TAMANHO: Record<TamanhoBotao, string> = {
  mini: "min-h-7 gap-1.5 px-2.5 py-1 text-xs",
  normal: "min-h-9 gap-2 px-3.5 py-2 text-sm",
  grande: "min-h-11 gap-2 px-5 py-2.5 text-sm",
};

const CIRCULAR: Record<TamanhoBotao, string> = {
  mini: "size-7 p-0",
  normal: "size-9 p-0",
  grande: "size-11 p-0",
};

export function Botao({
  tipo = "secundario",
  tamanho = "normal",
  icone,
  iconeAoFim = false,
  circular = false,
  children,
  className = "",
  disabled,
  /* `button`, não o `submit` que o HTML assume dentro de um formulário: um
     "Cancelar" ao lado de "Guardar" submetia o formulário que devia
     descartar. Quem envia diz `type="submit"` de propósito. */
  type = "button",
  ...resto
}: BotaoProps) {
  const glifo = icone ? (
    <Icone nome={icone} tamanho={tamanho === "mini" ? 13 : 15} />
  ) : null;

  return (
    <button
      className={[
        "inline-flex shrink-0 items-center justify-center font-mono font-medium",
        "whitespace-nowrap transition-colors duration-[120ms]",
        "disabled:pointer-events-none disabled:opacity-40",
        circular ? "rounded-full" : "rounded-md",
        POR_TIPO[tipo],
        POR_TAMANHO[tamanho],
        circular ? CIRCULAR[tamanho] : "",
        className,
      ].join(" ")}
      disabled={disabled}
      type={type}
      {...resto}
    >
      {!iconeAoFim && glifo}
      {children}
      {iconeAoFim && glifo}
    </button>
  );
}
