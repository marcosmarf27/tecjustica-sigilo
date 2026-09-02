import { useCallback, useEffect, useState } from "react";

import { Botao, Cartao, LinhaDeAjuste, Selo } from "../ui";

/**
 * A linha de comando: `tecjustica-sigilo` no terminal.
 *
 * Era a única tela escrita fora do sistema — títulos em serifa, cantos e
 * botões próprios, e um "Fechar" que não fechava nada. Agora é um cartão com
 * duas linhas de ajuste, uma por ambiente, e o exemplo de uso embaixo.
 *
 * O instalador do aplicativo já põe a CLI no PATH; estes controles existem
 * para quem desativou, para o WSL (que precisa de um shim próprio) e para
 * conferir de onde o comando está sendo servido.
 */

interface CliStatus {
  backendDir: string;
  windows: { installed: boolean; onPath: boolean };
  wsl: { available: boolean; installed: boolean; shimPath: string };
}

interface Props {
  showToast: (message: string, type?: "success" | "error") => void;
}

export function CliInstaller({ showToast }: Props) {
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

  if (!api) return null;

  const run = async (
    action: string,
    fn: () => Promise<{ ok: boolean; note?: string; error?: string }>
  ) => {
    setBusy(action);
    try {
      const r = await fn();
      if (r.ok) showToast(r.note || "Operação concluída.", "success");
      else showToast(r.error || "Falhou.", "error");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Cartao
      titulo="Linha de comando"
      descricao="O comando tecjustica-sigilo, para anonimizar pelo terminal ou por um agente."
      semPreenchimento
    >
      <div className="divide-y divide-border-subtle px-4">
        <LinhaDeAjuste
          titulo="Windows (cmd, PowerShell)"
          descricao="Acrescenta a pasta do motor ao PATH do seu usuário. Depois de ativar, abra um terminal novo."
        >
          <div className="flex items-center gap-2">
            <Selo tom={status?.windows.installed ? "deferido" : "neutro"} comPonto>
              {status?.windows.installed ? "ativa" : "inativa"}
            </Selo>
            {status?.windows.installed ? (
              <Botao
                tamanho="mini"
                disabled={busy !== null}
                onClick={() => run("win-off", () => api.uninstallWindows())}
              >
                Desativar
              </Botao>
            ) : (
              <Botao
                tamanho="mini"
                tipo="primario"
                disabled={busy !== null}
                onClick={() => run("win-on", () => api.installWindows())}
              >
                {busy === "win-on" ? "Ativando…" : "Ativar"}
              </Botao>
            )}
          </div>
        </LinhaDeAjuste>

        <LinhaDeAjuste
          titulo="WSL (bash, zsh)"
          descricao={
            !status?.wsl.available
              ? "O WSL não foi detectado nesta máquina."
              : status.wsl.installed
                ? `Shim em ${status.wsl.shimPath}. Se ~/.local/bin não estiver no PATH, acrescente no ~/.bashrc.`
                : "Instala um shim em ~/.local/bin que chama o Python embutido pela interoperação do Windows."
          }
        >
          <div className="flex items-center gap-2">
            <Selo
              tom={!status?.wsl.available ? "atencao" : status.wsl.installed ? "deferido" : "neutro"}
              comPonto
            >
              {!status?.wsl.available ? "sem WSL" : status.wsl.installed ? "ativa" : "inativa"}
            </Selo>
            {status?.wsl.available &&
              (status.wsl.installed ? (
                <Botao
                  tamanho="mini"
                  disabled={busy !== null}
                  onClick={() => run("wsl-off", () => api.uninstallWsl())}
                >
                  Desativar
                </Botao>
              ) : (
                <Botao
                  tamanho="mini"
                  tipo="primario"
                  disabled={busy !== null}
                  onClick={() => run("wsl-on", () => api.installWsl())}
                >
                  {busy === "wsl-on" ? "Ativando…" : "Ativar"}
                </Botao>
              ))}
          </div>
        </LinhaDeAjuste>

        <LinhaDeAjuste
          titulo="Uso"
          descricao="Para um agente (Claude Code e afins), a saída em JSON traz anonymized_text e entities_found — tipo, texto, posições e confiança."
          empilhado
        >
          <pre className="overflow-x-auto rounded-md bg-surface-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-text-secondary">
            {"tecjustica-sigilo autos.pdf -o autos-anonimizado.md\n"}
            {"tecjustica-sigilo entrada.txt -q --format json\n"}
            {"tecjustica-sigilo conectar   # pareia com o aplicativo aberto"}
          </pre>
          {status && (
            <p className="mt-2 truncate font-mono text-2xs text-text-tertiary" title={status.backendDir}>
              Servido de {status.backendDir}
            </p>
          )}
        </LinhaDeAjuste>
      </div>
    </Cartao>
  );
}
