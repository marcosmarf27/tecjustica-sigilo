import { useCallback, useEffect, useState } from "react";

import { useApp } from "../estado/AppEstado";
import { Botao, Campo, LinhaDeAjuste, Selo } from "../ui";

/**
 * Onde a conversa com a nuvem é ligada: chave, modelo, teste.
 *
 * Até a v1.3.0 este aplicativo não falava com a internet, e dizia isso no
 * README. A conversa muda a promessa, e a mudança tem de ser explícita: sem
 * chave colada aqui, nada sai desta máquina — o recurso simplesmente não
 * funciona, em vez de funcionar em silêncio.
 *
 * A chave é guardada cifrada, com a mesma proteção do cofre, e nunca volta pela
 * ponte: o que se vê aqui são os quatro últimos caracteres, o bastante para
 * reconhecer qual credencial está ali.
 *
 * São três linhas de ajuste, e só três. A explicação sobre o que sai da
 * máquina e a taxa medida da anonimização saíram daqui: quem cola uma chave
 * já decidiu usar o recurso, e lê isso na tela da conversa, antes do primeiro
 * envio — que é onde a informação muda alguma decisão.
 */
export function PainelNuvem() {
  const { prefs, definirPref } = useApp();
  const [resumo, setResumo] = useState<{
    presente: boolean;
    ultimos4: string | null;
  } | null>(null);
  const [modelos, setModelos] = useState<ModeloDaNuvem[]>([]);
  const [trocando, setTrocando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [sonda, setSonda] = useState<{
    provedor: string | null;
    zdr: boolean;
    erro: string | null;
  } | null>(null);
  const [sondando, setSondando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setResumo(await api.segredo.resumo());
    setModelos(await api.chat.modelos());
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  /* A escolha do modelo é preferência: sobrevive ao fechamento e é a que a
     conversa usa ao abrir. `null` significa "o padrão do catálogo". */
  const escolhido = prefs.modeloDaNuvem ?? modelos[0]?.id ?? "";
  const modelo = modelos.find((m) => m.id === escolhido);

  const guardar = async () => {
    setErro(null);
    try {
      await window.electronAPI?.segredo.guardar(rascunho);
      setRascunho("");
      setTrocando(false);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const testar = async () => {
    setSondando(true);
    setSonda(null);
    try {
      const r = await window.electronAPI?.chat.sondar(escolhido);
      setSonda(r ?? null);
    } finally {
      setSondando(false);
    }
  };

  const mostrarCampo = !resumo?.presente || trocando;

  return (
    <>
      <LinhaDeAjuste
        titulo="Chave do OpenRouter"
        descricao={
          resumo?.presente
            ? "Cifrada nesta máquina, com a mesma proteção do cofre. Nunca aparece inteira de novo."
            : "Sem chave, o aplicativo não fala com a internet. Vale criar uma chave dedicada, com limite de crédito no painel do OpenRouter."
        }
        empilhado={mostrarCampo}
      >
        {mostrarCampo ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (rascunho.trim()) void guardar();
            }}
          >
            <Campo
              rotulo="Colar chave"
              type="password"
              placeholder="sk-or-v1-…"
              autoComplete="off"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              erro={erro ?? undefined}
              className="max-w-md flex-1"
            />
            <Botao tipo="primario" type="submit" disabled={rascunho.trim().length === 0}>
              Guardar
            </Botao>
            {trocando && (
              <Botao
                tipo="discreto"
                onClick={() => {
                  setTrocando(false);
                  setRascunho("");
                  setErro(null);
                }}
              >
                Cancelar
              </Botao>
            )}
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <Selo tom="deferido" comPonto>
              guardada · ····{resumo?.ultimos4}
            </Selo>
            <Botao tamanho="mini" onClick={() => setTrocando(true)}>
              Trocar
            </Botao>
            <Botao
              tamanho="mini"
              tipo="discreto"
              onClick={async () => {
                await window.electronAPI?.segredo.apagar();
                setSonda(null);
                await recarregar();
              }}
            >
              Remover
            </Botao>
          </div>
        )}
      </LinhaDeAjuste>

      <LinhaDeAjuste
        titulo="Modelo"
        descricao={
          modelo
            ? `${(modelo.contexto / 1000).toLocaleString("pt-BR")} mil tokens de contexto · US$ ${modelo.entrada}/M de entrada` +
              (modelo.faixaExtra
                ? ` · dobra de preço acima de ${(modelo.faixaExtra.acimaDe / 1000).toLocaleString("pt-BR")} mil`
                : "") +
              (modelo.observacao ? ` · ${modelo.observacao}` : "")
            : "Só modelos com retenção zero e contexto de um milhão de tokens entram na lista."
        }
      >
        <label className="sr-only" htmlFor="modelo-da-nuvem">
          Modelo
        </label>
        <select
          id="modelo-da-nuvem"
          value={escolhido}
          onChange={(e) => definirPref("modeloDaNuvem", e.target.value)}
          className="min-h-9 max-w-xs rounded-md border border-border bg-surface px-3 font-mono text-xs text-text"
        >
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
              {m.inteligencia ? ` · índice ${m.inteligencia}` : ""}
            </option>
          ))}
        </select>
      </LinhaDeAjuste>

      <LinhaDeAjuste
        titulo="Testar a chave"
        descricao={
          sonda ? (
            sonda.erro ? (
              <span className="text-danger">{sonda.erro}</span>
            ) : sonda.zdr ? (
              <>
                Atendido por <strong className="text-text">{sonda.provedor}</strong> ·
                retenção zero confirmada.
              </>
            ) : (
              <span className="text-danger">
                Atendido por {sonda.provedor ?? "provedor desconhecido"}, que não
                consta na lista de retenção zero.
              </span>
            )
          ) : (
            "Manda uma requisição de um token, só para ver qual provedor o roteamento escolhe. Custa frações de centavo."
          )
        }
      >
        <Botao onClick={testar} disabled={!resumo?.presente || sondando || !escolhido}>
          {sondando ? "Testando…" : "Testar"}
        </Botao>
      </LinhaDeAjuste>
    </>
  );
}
