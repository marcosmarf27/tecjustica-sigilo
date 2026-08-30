import { useEffect, useMemo, useState } from "react";
import { Botao, Campo, Cartao, Selo } from "../ui";
import { rotuloDaEntidade } from "../types";

/**
 * A deny-list: termos que o detector deve deixar passar.
 *
 * Até aqui só dava para **acrescentar** termo, pelo botão "Não é PII" da tela
 * de revisão. Não havia nenhuma forma de tirar — nem pela interface, nem por
 * rota dedicada. Um falso positivo marcado por engano ficava lá para sempre, e
 * o efeito é o pior possível num anonimizador: o termo deixa de ser mascarado
 * em todos os documentos seguintes, silenciosamente.
 *
 * A remoção usa as rotas que já existem (`GET` e `POST /config/deny-list`,
 * que substitui o arquivo inteiro). A leitura-modificação-escrita é uma corrida
 * em tese; o `config_loader` passou a serializar as gravações com um lock e a
 * gravar de forma atômica, o que fecha o caso na prática para os dois clientes
 * que existem.
 *
 * A chave `"*"` vale para qualquer tipo de entidade.
 */

interface PainelDenyListProps {
  /** URL base do backend, já com a porta resolvida. */
  buscar: () => Promise<Record<string, string[]>>;
  gravar: (lista: Record<string, string[]>) => Promise<void>;
  avisar: (mensagem: string, tipo?: "sucesso" | "erro") => void;
}

export function PainelDenyList({
  buscar,
  gravar,
  avisar,
}: PainelDenyListProps) {
  const [lista, setLista] = useState<Record<string, string[]> | null>(null);
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    buscar()
      .then(setLista)
      .catch(() => setLista({}));
  }, [buscar]);

  /** Achatada em pares (tipo, termo) para busca e remoção item a item. */
  const pares = useMemo(() => {
    if (!lista) return [];
    const todos: { tipo: string; termo: string }[] = [];
    for (const [tipo, termos] of Object.entries(lista)) {
      for (const termo of termos) todos.push({ tipo, termo });
    }
    const q = busca.trim().toLowerCase();
    const filtrados = q
      ? todos.filter((p) => p.termo.toLowerCase().includes(q))
      : todos;
    return filtrados.sort((a, b) => a.termo.localeCompare(b.termo, "pt-BR"));
  }, [lista, busca]);

  const total = useMemo(
    () =>
      lista ? Object.values(lista).reduce((s, t) => s + t.length, 0) : 0,
    [lista]
  );

  const remover = async (tipo: string, termo: string) => {
    if (!lista) return;
    setGravando(true);
    const nova = {
      ...lista,
      [tipo]: lista[tipo].filter((t) => t !== termo),
    };
    // Chave sem termo nenhum sai do arquivo, para não acumular lixo.
    if (nova[tipo].length === 0) delete nova[tipo];

    try {
      await gravar(nova);
      setLista(nova);
      avisar(`"${termo}" voltou a ser mascarado.`);
    } catch (erro) {
      avisar(
        `Não foi possível remover: ${erro instanceof Error ? erro.message : "erro desconhecido"}`,
        "erro"
      );
    } finally {
      setGravando(false);
    }
  };

  return (
    <Cartao
      titulo="Termos liberados"
      descricao="Palavras que o detector deve deixar passar, marcadas como “não é dado pessoal”."
    >
      {lista === null ? (
        <p className="text-sm text-text-tertiary">Carregando…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <Campo
              rotulo="Buscar termo"
              placeholder="parte da palavra"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="flex-1"
            />
            <p className="pb-2.5 font-mono text-2xs whitespace-nowrap text-text-tertiary uppercase">
              {total} termo{total === 1 ? "" : "s"}
            </p>
          </div>

          {pares.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-tertiary">
              {busca
                ? "Nenhum termo com essa busca."
                : "Nenhum termo liberado ainda."}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
              {pares.map(({ tipo, termo }) => (
                <li
                  key={`${tipo}:${termo}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Selo tom="neutro">
                      {tipo === "*" ? "qualquer" : rotuloDaEntidade(tipo)}
                    </Selo>
                    <span className="truncate text-sm text-text">{termo}</span>
                  </div>
                  <Botao
                    tamanho="mini"
                    tipo="discreto"
                    icone="fechar"
                    disabled={gravando}
                    aria-label={`Voltar a mascarar ${termo}`}
                    onClick={() => remover(tipo, termo)}
                  >
                    Remover
                  </Botao>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs leading-normal text-text-tertiary">
            Remover um termo faz o detector voltar a mascará-lo nos próximos
            documentos. Os já processados não mudam.
          </p>
        </div>
      )}
    </Cartao>
  );
}
