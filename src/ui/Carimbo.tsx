/**
 * Carimbo — a única ousadia do sistema, e só na biblioteca.
 *
 *     ╭═══════════════════╮
 *     ║  A N O N I M I Z  ║   ← --esferografica
 *     ╰═══════════════════╯
 *          EM REVISÃO         ← --toner-3
 *        2 VAZAMENTOS         ← --carimbo
 *
 * Retângulo de filete duplo (borda mais `outline` deslocado), girado −3°, mono
 * em caixa-alta com entreletra larga. O estilo vive em `.carimbo`, no
 * `tokens.css`, junto do `prefers-reduced-motion` que endireita o giro.
 *
 * Quem tem vazamento leva tom `perigo`. É o único lugar da interface onde a cor
 * de carimbo aparece com frequência — e por isso ela quase não aparece no
 * resto: uma cor reservada para o grave perde o efeito se for usada em botão.
 */

type TomCarimbo = "acao" | "neutro" | "perigo" | "deferido";

interface CarimboProps {
  children: string;
  tom?: TomCarimbo;
  className?: string;
}

export function Carimbo({ children, tom = "acao", className = "" }: CarimboProps) {
  return (
    <span
      className={`carimbo ${className}`}
      /* `acao` é o padrão do CSS e não precisa de atributo; os outros três
         trocam `--cor-carimbo` por seletor. */
      data-tom={tom === "acao" ? undefined : tom}
    >
      {children}
    </span>
  );
}
