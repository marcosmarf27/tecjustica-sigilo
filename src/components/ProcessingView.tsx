interface ProcessingViewProps {
  current: number;
  total: number;
  fileName: string;
  phase?: string;
  onCancelar?: () => void;
}

export function ProcessingView({
  current,
  total,
  fileName,
  phase = "Analisando",
  onCancelar,
}: ProcessingViewProps) {
  const progress = total > 0 ? (current / total) * 100 : 0;
  const isDone = current === total && total > 0;
  // Sem total conhecido não há o que mostrar: enquanto o documento está sendo
  // aberto, nem o número de páginas se sabe ainda. Aí o indicador roda solto,
  // que é honesto — uma barra parada em 0% parece travamento.
  const indeterminado = total <= 0 && !isDone;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md animate-fade-in px-8 text-center">
        <div className="relative mx-auto mb-8 h-24 w-24">
          <svg
            className={`h-24 w-24 -rotate-90 ${indeterminado ? "" : ""}`}
            viewBox="0 0 96 96"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminado ? undefined : Math.round(progress)}
            aria-label={
              indeterminado
                ? `${phase}: ${fileName}`
                : `${phase}: ${current} de ${total}`
            }
            style={
              indeterminado
                ? { animation: "spin 1.6s linear infinite" }
                : undefined
            }
          >
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="5"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={indeterminado ? "60 251" : `${progress * 2.51} 251`}
              className={indeterminado ? "" : "transition-all duration-700 ease-out"}
            />
          </svg>
          {!indeterminado && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-accent tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
          )}
        </div>

        <h2 className="text-lg font-semibold text-text" aria-live="polite">
          {isDone ? "Finalizando…" : phase}
        </h2>

        <div className="mt-4 rounded-lg bg-surface-raised/70 px-4 py-3">
          {total > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-tertiary">Progresso</span>
              <span className="font-medium text-text tabular-nums">
                {current} de {total}
              </span>
            </div>
          )}
          <p className="mt-1.5 truncate text-left text-sm font-medium text-accent">
            {fileName}
          </p>
        </div>

        {onCancelar && !isDone && (
          <button
            onClick={onCancelar}
            className="mt-7 rounded-lg border border-border px-4 py-2 text-xs font-medium text-text-secondary transition hover:border-danger hover:text-danger"
          >
            Cancelar
          </button>
        )}

        <p className="mt-4 text-2xs text-text-tertiary">
          Documentos longos levam alguns minutos. Nada sai da sua máquina.
        </p>
      </div>
    </div>
  );
}
