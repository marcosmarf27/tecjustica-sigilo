/**
 * Grupo segmentado — escolha de um entre poucos, sempre visíveis.
 *
 * Substitui os três pares de botões que a revisão montava à mão
 * (revisar/resultado, md/docx, papel/noite). Diferente de um `<select>`, as
 * opções ficam à vista: com duas ou três alternativas, esconder as outras atrás
 * de um clique custa mais do que o espaço economizado.
 *
 * Navegação por teclado segue o padrão de radiogroup da WAI-ARIA: **Tab entra
 * uma vez só** e as setas trocam a opção. Um grupo de rádios em que cada opção
 * é uma parada de Tab obriga quem usa teclado a passar por todas para chegar ao
 * próximo controle — por isso o `tabIndex` é 0 apenas no item ativo.
 */

interface OpcaoSegmento<T extends string> {
  valor: T;
  rotulo: string;
  /** Vira `title` e `aria-label`, para o que o rótulo curto não explica. */
  descricao?: string;
}

interface GrupoSegmentadoProps<T extends string> {
  opcoes: readonly OpcaoSegmento<T>[];
  valor: T;
  onChange: (valor: T) => void;
  /** Nome do grupo para leitor de tela. */
  rotulo: string;
  className?: string;
}

export function GrupoSegmentado<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
  className = "",
}: GrupoSegmentadoProps<T>) {
  const aoTeclar = (evento: React.KeyboardEvent, indice: number) => {
    const passo =
      evento.key === "ArrowRight" || evento.key === "ArrowDown"
        ? 1
        : evento.key === "ArrowLeft" || evento.key === "ArrowUp"
          ? -1
          : 0;
    if (passo === 0) return;
    evento.preventDefault();
    // Circular: da última volta para a primeira, como manda o padrão.
    const proximo = (indice + passo + opcoes.length) % opcoes.length;
    onChange(opcoes[proximo].valor);
  };

  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      className={[
        "inline-flex rounded-md border border-border bg-surface-sunken p-0.5",
        className,
      ].join(" ")}
    >
      {opcoes.map((opcao, indice) => {
        const ativo = opcao.valor === valor;
        return (
          <button
            key={opcao.valor}
            role="radio"
            aria-checked={ativo}
            aria-label={opcao.descricao}
            title={opcao.descricao}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange(opcao.valor)}
            onKeyDown={(e) => aoTeclar(e, indice)}
            className={[
              "min-h-6 rounded px-3 py-1 font-mono text-2xs font-medium",
              "tracking-wide uppercase transition-colors duration-[120ms]",
              ativo
                ? "bg-accent text-on-accent"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            {opcao.rotulo}
          </button>
        );
      })}
    </div>
  );
}
