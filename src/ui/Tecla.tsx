/**
 * Tecla — um atalho de teclado, desenhado como a tecla que ele é.
 *
 * Aparece ao lado do destino no trilho e em dicas de campo ("Enter envia").
 * É informação secundária: cinza, pequena, nunca disputando com o rótulo.
 */

export function Tecla({ children, className = "" }: { children: string; className?: string }) {
  return (
    <kbd
      className={[
        "inline-flex min-w-5 items-center justify-center rounded border border-border-subtle",
        "bg-surface px-1 font-mono text-2xs leading-4 text-text-tertiary",
        className,
      ].join(" ")}
    >
      {children}
    </kbd>
  );
}
