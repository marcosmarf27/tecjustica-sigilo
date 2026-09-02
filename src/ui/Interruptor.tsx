/**
 * Interruptor — ligado ou desligado, num gesto só.
 *
 * Substitui os pares "Ligado / Desligado" em grupo segmentado, que ocupavam o
 * espaço de três opções para dizer uma coisa binária e obrigavam a ler as duas
 * palavras para saber qual estava ativa. Aqui a posição e a cor do trilho
 * dizem o estado antes de qualquer leitura — é o controle que todo sistema
 * operacional usa para o mesmo fim, e o usuário já sabe operá-lo.
 *
 * É `<button role="switch">`, o papel ARIA que o leitor de tela anuncia como
 * "interruptor, ligado". Espaço e Enter alternam; o foco ganha o anel do
 * sistema. Fica sempre à direita da sua `LinhaDeAjuste`, nunca solto.
 */

interface InterruptorProps {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  /** O que o leitor de tela anuncia — diga a coisa, não "interruptor". */
  rotulo: string;
  disabled?: boolean;
  className?: string;
}

export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  disabled = false,
  className = "",
}: InterruptorProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={disabled}
      onClick={() => aoMudar(!ligado)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
        "transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40",
        ligado ? "bg-accent" : "bg-border",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "block size-4 rounded-full bg-on-accent shadow-sm",
          "transition-transform duration-[120ms]",
          ligado ? "translate-x-[18px]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
