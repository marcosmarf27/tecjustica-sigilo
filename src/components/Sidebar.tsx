import type { HistoryItem } from "../types";
import { ALL_ENTITIES } from "../types";

interface SidebarProps {
  history: HistoryItem[];
  onOpenEntry: (entry: HistoryItem) => void;
  onDeleteEntry: (id: string) => void;
  onClearHistory: () => void;
  onNewProcess: () => void;
  onOpenCli: () => void;
  activeEntryId?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return `Hoje, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString())
    return `Ontem, ${time}`;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  }) + `, ${time}`;
}

export function Sidebar({
  history,
  onOpenEntry,
  onDeleteEntry,
  onClearHistory,
  onNewProcess,
  onOpenCli,
  activeEntryId,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-72 flex-col border-r border-border-subtle bg-surface">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-text">
            TecJustiça Sigilo
          </h1>
          <p className="text-2xs text-text-tertiary">Anonimizador de PII</p>
        </div>
      </div>

      {/* New process + CLI buttons */}
      <div className="space-y-2 px-3 pt-3">
        <button
          onClick={onNewProcess}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm font-medium text-text transition hover:border-accent/40 hover:bg-surface-hover"
        >
          <svg className="h-4 w-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo processamento
        </button>
        <button
          onClick={onOpenCli}
          className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-hover hover:text-text"
        >
          <svg className="h-4 w-4 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 17l6-6-6-6M12 19h8" />
          </svg>
          Linha de comando
        </button>
      </div>

      {/* History list */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <span className="text-2xs font-medium uppercase tracking-wider text-text-tertiary">
          Histórico
        </span>
        {history.length > 0 && (
          <button
            onClick={onClearHistory}
            className="text-2xs text-text-tertiary transition-colors hover:text-danger"
          >
            Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-surface-raised p-3">
              <svg className="h-5 w-5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-xs text-text-tertiary">
              Nenhum processamento ainda
            </p>
          </div>
        ) : (
          <ul className="stagger-children space-y-1">
            {history.map((entry) => {
              const isActive = entry.id === activeEntryId;
              const topEntities = Object.entries(entry.entityBreakdown)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3);

              return (
                <li key={entry.id}>
                  <button
                    onClick={() => onOpenEntry(entry)}
                    className={`group relative w-full rounded-lg px-3 py-2.5 text-left transition ${
                      isActive
                        ? "bg-accent/10 border border-accent/20"
                        : "hover:bg-surface-hover border border-transparent"
                    }`}
                  >
                    {/* Delete button */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteEntry(entry.id);
                      }}
                      className="absolute right-2 top-2 z-10 hidden rounded p-0.5 text-text-tertiary transition-colors hover:text-danger group-hover:block"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>

                    {/* File names */}
                    <p className="truncate pr-5 text-sm font-medium text-text">
                      {entry.fileNames.length === 1
                        ? entry.fileNames[0]
                        : `${entry.fileNames.length} arquivos`}
                    </p>

                    {/* Date + entity count */}
                    <p className="mt-0.5 text-2xs text-text-tertiary">
                      {formatDate(entry.date)} · {entry.totalEntities} entidade{entry.totalEntities !== 1 ? "s" : ""}
                    </p>

                    {/* Entity dots */}
                    <div className="mt-1.5 flex gap-1">
                      {topEntities.map(([type, count]) => {
                        const info = ALL_ENTITIES.find((e) => e.id === type);
                        return (
                          <span
                            key={type}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs"
                            style={{
                              backgroundColor: `${info?.color ?? "#918a9b"}1f`,
                              color: info?.color ?? "#918a9b",
                            }}
                          >
                            {count}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
