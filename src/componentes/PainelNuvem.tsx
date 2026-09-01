import { useCallback, useEffect, useState } from "react";

import { Botao, Campo, Cartao, Selo } from "../ui";

/**
 * Onde a conversa com a nuvem é ligada.
 *
 * Até a v1.3.0 este aplicativo não falava com a internet, e dizia isso no
 * README. A conversa muda a promessa, e a mudança tem de ser explícita: sem
 * chave colada aqui, nada sai desta máquina — o recurso simplesmente não
 * funciona, em vez de funcionar em silêncio.
 *
 * A chave é guardada cifrada, com a mesma proteção do cofre, e nunca volta pela
 * ponte: o que se vê aqui são os quatro últimos caracteres, o bastante para
 * reconhecer qual credencial está ali.
 */
export function PainelNuvem() {
  const [resumo, setResumo] = useState<{
    presente: boolean;
    ultimos4: string | null;
  } | null>(null);
  const [modelos, setModelos] = useState<ModeloDaNuvem[]>([]);
  const [escolhido, setEscolhido] = useState<string>("");
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
    const lista = await api.chat.modelos();
    setModelos(lista);
    setEscolhido((atual) => atual || lista[0]?.id || "");
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const guardar = async () => {
    setErro(null);
    try {
      await window.electronAPI?.segredo.guardar(rascunho);
      setRascunho("");
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

  const modelo = modelos.find((m) => m.id === escolhido);

  return (
    <Cartao
      titulo="Conversar com os autos"
      descricao="Perguntar a um modelo na nuvem sobre documentos já anonimizados."
    >
      <div className="space-y-4">
        <p className="font-serif text-sm leading-relaxed text-text-secondary">
          O que sai desta máquina é o <strong>texto anonimizado</strong>, com os
          dados pessoais já substituídos por pseudônimos, e só para modelos com
          política de <strong>retenção zero</strong> — que não guardam o que
          recebem. É o que a Resolução CNJ 615/2025 exige para processar dado
          sigiloso fora daqui.
        </p>

        <p className="rounded-md border border-border-subtle bg-surface px-3 py-2 font-serif text-sm text-text-secondary">
          A anonimização mede <strong>99,94% por ocorrência</strong> no gate
          deste produto — alta, e não 100%. Antes do primeiro envio de cada
          conversa dá para ver exatamente o texto que sairia.
        </p>

        {/* --- chave --- */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
              Chave do OpenRouter
            </span>
            {resumo?.presente ? (
              <Selo tom="deferido" comPonto>
                guardada · ····{resumo.ultimos4}
              </Selo>
            ) : (
              <Selo tom="neutro">não configurada</Selo>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Campo
              rotulo="Colar chave"
              type="password"
              placeholder="sk-or-v1-…"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              erro={erro ?? undefined}
              className="flex-1"
            />
            <Botao
              tipo="primario"
              onClick={guardar}
              disabled={rascunho.trim().length === 0}
            >
              Guardar
            </Botao>
            {resumo?.presente && (
              <Botao
                tipo="perigo"
                onClick={async () => {
                  await window.electronAPI?.segredo.apagar();
                  await recarregar();
                }}
              >
                Remover
              </Botao>
            )}
          </div>
          <p className="mt-1 font-mono text-2xs text-text-tertiary">
            Cifrada nesta máquina, como o cofre. Vale usar uma chave dedicada,
            com limite de crédito no painel do OpenRouter.
          </p>
        </div>

        {/* --- modelo --- */}
        <div>
          <label
            htmlFor="modelo-da-nuvem"
            className="mb-1 block font-mono text-2xs uppercase tracking-wide text-text-tertiary"
          >
            Modelo
          </label>
          <select
            id="modelo-da-nuvem"
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
            className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 font-mono text-xs text-text"
          >
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} · US$ {m.entrada}/M entrada
                {m.inteligencia ? ` · índice ${m.inteligencia}` : ""}
              </option>
            ))}
          </select>
          {modelo && (
            <p className="mt-1 font-mono text-2xs text-text-tertiary">
              {(modelo.contexto / 1000).toLocaleString("pt-BR")} mil tokens de
              contexto
              {modelo.faixaExtra &&
                ` · dobra de preço acima de ${(modelo.faixaExtra.acimaDe / 1000).toLocaleString("pt-BR")} mil`}
              {modelo.observacao ? ` · ${modelo.observacao}` : ""}
            </p>
          )}
        </div>

        {/* --- sonda --- */}
        <div className="flex items-center gap-2">
          <Botao
            tipo="secundario"
            onClick={testar}
            disabled={!resumo?.presente || sondando}
          >
            {sondando ? "Testando…" : "Testar a chave"}
          </Botao>
          {sonda && (
            <span className="font-mono text-2xs text-text-secondary">
              {sonda.erro ? (
                <span className="text-danger">{sonda.erro}</span>
              ) : sonda.zdr ? (
                <>
                  atendido por <strong>{sonda.provedor}</strong> · retenção zero
                  confirmada
                </>
              ) : (
                <span className="text-danger">
                  atendido por {sonda.provedor ?? "provedor desconhecido"}, que
                  não consta na lista de retenção zero
                </span>
              )}
            </span>
          )}
        </div>
        <p className="font-mono text-2xs text-text-tertiary">
          O teste manda uma requisição de um token, só para ver qual provedor o
          roteamento escolhe. Custa frações de centavo.
        </p>
      </div>
    </Cartao>
  );
}
