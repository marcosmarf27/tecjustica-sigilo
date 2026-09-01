/**
 * Marcador — a conferência de um rol de documentos.
 *
 *     ┌───┐        ┌───┐
 *     │   │        │ ✓ │   ← traço de esferográfica
 *     └───┘        └───┘
 *
 * O `<input type="checkbox">` nativo entrou aqui junto com a seleção múltipla e
 * era o único elemento da tela que não pertencia ao sistema: um quadrado azul
 * do Windows no meio de um cartório, com carimbo girado ao lado e duas fontes
 * escolhidas a dedo. Chamava atenção pelo motivo errado.
 *
 * Este é o mesmo gesto, no vocabulário certo: quadrado de filete e um "✓" de
 * caneta. **Sem rotação** — o giro de −3° é do carimbo e continua sendo só
 * dele. A ousadia do sistema mora num lugar só; um segundo elemento torto a
 * dividiria pela metade.
 *
 * É `<button role="checkbox">` e não `<input>` porque o desenho do traço exige
 * conteúdo próprio. O papel ARIA e o `aria-checked` mantêm o comportamento que
 * o leitor de tela espera.
 */

interface MarcadorProps {
  marcado: boolean;
  aoAlternar: () => void;
  /** O que o leitor de tela anuncia. Diga o documento, não "caixa de seleção". */
  rotulo: string;
  /** Estado de "alguns marcados", para o controle do cabeçalho. */
  parcial?: boolean;
}

export function Marcador({
  marcado,
  aoAlternar,
  rotulo,
  parcial = false,
}: MarcadorProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={parcial ? "mixed" : marcado}
      aria-label={rotulo}
      onClick={(e) => {
        /* A linha da tabela pode ter clique próprio; marcar não é abrir. Quem
           envolve este botão numa área de clique maior deve tratar o evento
           lá e deixar este só como alvo visual — daí o `preventDefault` não
           existir aqui: o duplo disparo é evitado por quem envolve. */
        e.stopPropagation();
        aoAlternar();
      }}
      className={[
        "grid size-[17px] shrink-0 place-items-center rounded-[2px] border",
        "transition-colors duration-[120ms]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "focus-visible:outline-accent",
        marcado || parcial
          ? "border-accent bg-accent/10"
          : "border-border hover:border-accent hover:bg-surface-hover",
      ].join(" ")}
    >
      {parcial ? (
        <span className="block h-px w-2.5 bg-accent" />
      ) : marcado ? (
        <svg viewBox="0 0 17 17" className="size-[15px]" aria-hidden="true">
          {/* Traço de caneta: entra fino, engrossa na virada e sai levantando.
              As duas curvas de Bézier existem para que a linha não fique com a
              regularidade de ícone de biblioteca. */}
          <path
            d="M3.4 8.9 C4.4 9.5 5.4 10.8 6.6 12.3 C8.7 8.4 10.9 5.2 13.8 3.1"
            fill="none"
            stroke="var(--esferografica)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
}
