import { useCallback, useEffect, useState } from "react";

interface CliStatus {
  backendDir: string;
  windows: { installed: boolean; onPath: boolean };
  wsl: { available: boolean; installed: boolean; shimPath: string };
}

interface Props {
  onClose: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

export function CliInstaller({ onClose, showToast }: Props) {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = window.electronAPI?.cli;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.status());
    } catch (err) {
      showToast(`Erro lendo status: ${err}`, "error");
    }
  }, [api, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!api) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <p className="text-text-tertiary">
          Instalador de CLI disponível apenas na versão desktop.
        </p>
        <button onClick={onClose} className="mt-4 text-accent">
          Voltar
        </button>
      </div>
    );
  }

  const run = async (action: string, fn: () => Promise<{ ok: boolean; note?: string; error?: string }>) => {
    setBusy(action);
    try {
      const r = await fn();
      if (r.ok) {
        showToast(r.note || "Operação concluída.", "success");
      } else {
        showToast(r.error || "Falhou.", "error");
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const winBadge = status?.windows.installed ? "Ativa" : "Inativa";
  const wslBadge = !status?.wsl.available
    ? "WSL não detectado"
    : status?.wsl.installed
    ? "Ativa"
    : "Inativa";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text">
              Linha de comando
            </h1>
            <p className="mt-1 text-sm text-text-tertiary">
              Habilita o comando <code className="rounded bg-surface-raised px-1 py-0.5 text-xs">tecjustica-sigilo</code> no terminal.
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-text-tertiary hover:text-text">
            Fechar
          </button>
        </div>

        {/* Windows card */}
        <div className="mb-4 rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-text">Windows (cmd / PowerShell)</h2>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Adiciona a pasta do backend ao seu PATH de usuário.
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-2xs font-medium ${
                status?.windows.installed
                  ? "bg-success/15 text-success"
                  : "bg-surface-raised text-text-secondary"
              }`}
            >
              {winBadge}
            </span>
          </div>

          <div className="mb-3 rounded-lg bg-surface-raised/70 p-3 font-mono text-2xs text-text-secondary">
            <div>tecjustica-sigilo arquivo.txt -o saida.txt</div>
            <div className="mt-1 text-text-tertiary">type arquivo.txt | tecjustica-sigilo --format json</div>
          </div>

          <div className="flex gap-2">
            {status?.windows.installed ? (
              <button
                disabled={busy !== null}
                onClick={() => run("win-off", () => api.uninstallWindows())}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text transition hover:bg-surface-raised disabled:opacity-40"
              >
                Desativar
              </button>
            ) : (
              <button
                disabled={busy !== null}
                onClick={() => run("win-on", () => api.installWindows())}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-40"
              >
                {busy === "win-on" ? "Ativando..." : "Ativar no Windows"}
              </button>
            )}
          </div>

          <p className="mt-3 text-2xs text-text-tertiary">
            Após ativar, reabra o terminal. O comando será chamado via wrapper <code>.cmd</code>.
          </p>
        </div>

        {/* WSL card */}
        <div className="mb-4 rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-text">WSL (bash / zsh)</h2>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Instala um shim em <code>~/.local/bin/tecjustica-sigilo</code> que chama o Python embutido via interop.
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-2xs font-medium ${
                status?.wsl.installed
                  ? "bg-success/15 text-success"
                  : !status?.wsl.available
                  ? "bg-warning/15 text-warning"
                  : "bg-surface-raised text-text-secondary"
              }`}
            >
              {wslBadge}
            </span>
          </div>

          <div className="mb-3 rounded-lg bg-surface-raised/70 p-3 font-mono text-2xs text-text-secondary">
            <div>tecjustica-sigilo arquivo.txt -o saida.txt</div>
            <div className="mt-1 text-text-tertiary">cat arquivo.txt | tecjustica-sigilo --format json --entities PERSON,CPF_BR</div>
          </div>

          <div className="flex gap-2">
            {!status?.wsl.available ? (
              <button
                disabled
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-tertiary"
              >
                WSL não disponível
              </button>
            ) : status?.wsl.installed ? (
              <button
                disabled={busy !== null}
                onClick={() => run("wsl-off", () => api.uninstallWsl())}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text transition hover:bg-surface-raised disabled:opacity-40"
              >
                Desativar
              </button>
            ) : (
              <button
                disabled={busy !== null}
                onClick={() => run("wsl-on", () => api.installWsl())}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-40"
              >
                {busy === "wsl-on" ? "Ativando..." : "Ativar no WSL"}
              </button>
            )}
          </div>

          {status?.wsl.installed && (
            <p className="mt-3 text-2xs text-text-tertiary">
              Shim em <code>{status.wsl.shimPath}</code>. Se <code>~/.local/bin</code> não estiver no PATH, adicione em <code>~/.bashrc</code>.
            </p>
          )}
        </div>

        {/* Para agentes */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-base font-semibold text-text">Para agentes (Claude Code, etc.)</h2>
          <p className="mt-1 text-xs text-text-tertiary">
            Use a flag <code>--format json</code> e redirecione stderr para ignorar o banner de inicialização:
          </p>
          <div className="mt-3 rounded-lg bg-surface-raised/70 p-3 font-mono text-2xs text-text-secondary">
            tecjustica-sigilo entrada.txt -q --format json
          </div>
          <p className="mt-3 text-2xs text-text-tertiary">
            Saída é um JSON com <code>anonymized_text</code> e <code>entities_found</code> (tipo, texto, posições, score).
          </p>
        </div>

        {status && (
          <p className="mt-6 text-2xs text-text-tertiary">
            Backend em: <code>{status.backendDir}</code>
          </p>
        )}
      </div>
    </div>
  );
}
