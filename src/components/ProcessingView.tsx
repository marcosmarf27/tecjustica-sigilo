import { Botao } from "../ui";

/**
 * Andamento do lote.
 *
 * Reenquadrado na paleta de papel e na regra das duas vozes: número, etapa e
 * nome de arquivo em mono (é a máquina relatando), e só a linha de tranquilizar
 * em serifa.
 */

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
  const progresso = total > 0 ? (current / total) * 100 : 0;
  const concluido = current === total && total > 0;
  /* Sem total conhecido não há o que mostrar: enquanto o documento está sendo
     aberto, nem o número de páginas se sabe ainda. Aí o indicador roda solto,
     que é honesto — uma barra parada em 0% parece travamento. */
  const indeterminado = total <= 0 && !concluido;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md animate-fade-in px-8 text-center">
        <div className="relative mx-auto mb-8 h-24 w-24">
          <svg
            className="h-24 w-24 -rotate-90"
            viewBox="0 0 96 96"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminado ? undefined : Math.round(progresso)}
            aria-label={
              indeterminado
                ? `${phase}: ${fileName}`
                : `${phase}: ${current} de ${total}`
            }
            style={
              indeterminado ? { animation: "spin 1.6s linear infinite" } : undefined
            }
          >
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--pauta)"
              strokeWidth="4"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--esferografica)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={
                indeterminado ? "60 251" : `${progresso * 2.51} 251`
              }
              className={indeterminado ? "" : "transition-all duration-700 ease-out"}
            />
          </svg>
          {!indeterminado && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-xl font-semibold text-accent tabular-nums">
                {Math.round(progresso)}%
              </span>
            </div>
          )}
        </div>

        <h2
          className="font-mono text-sm font-semibold tracking-wide text-text uppercase"
          aria-live="polite"
        >
          {concluido ? "Finalizando…" : phase}
        </h2>

        <div className="mt-4 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-left">
          {total > 0 && (
            <div className="flex items-center justify-between font-mono text-2xs tracking-wide uppercase">
              <span className="text-text-tertiary">Progresso</span>
              <span className="text-text tabular-nums">
                {current} de {total}
              </span>
            </div>
          )}
          <p className="mt-1.5 truncate font-mono text-xs text-accent">
            {fileName}
          </p>
        </div>

        {onCancelar && !concluido && (
          <Botao tipo="perigo" onClick={onCancelar} className="mt-7">
            Cancelar
          </Botao>
        )}

        <p className="mt-4 text-xs text-text-tertiary">
          Documentos longos levam alguns minutos. Nada sai da sua máquina.
        </p>
      </div>
    </div>
  );
}
