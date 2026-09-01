import { useEffect, useRef, useState } from "react";

import { useConversa } from "../hooks/useConversa";
import { Markdown, type MapaDeNomes } from "../componentes/Markdown";
import { Botao, Cartao, Dialogo, Selo } from "../ui";

interface ConversaProps {
  ids: string[] | null;
  aoFechar: () => void;
  aoIrParaDocumentos: () => void;
  aoIrParaAjustes: () => void;
  temChave: boolean;
}

/**
 * O texto como ele trafegou: com os pseudônimos, não com os nomes repostos.
 *
 * É a forma canônica de um turno aqui. O que a tela mostra é uma leitura dela
 * — a reposição acontece na renderização, contra o mapa, e nunca no dado.
 */
function textoComRotulos(trechos: TrechoDaConversa[]): string {
  return trechos.map((t) => (t.tipo === "texto" ? t.texto : t.rotulo)).join("");
}

/** O que cada rótulo quer dizer, extraído dos trechos já resolvidos. */
function mapaDeNomes(trechos: TrechoDaConversa[]): MapaDeNomes {
  const mapa: MapaDeNomes = new Map();
  for (const t of trechos) {
    if (t.tipo === "reposto") mapa.set(t.rotulo, t.valor);
    else if (t.tipo === "desconhecido") mapa.set(t.rotulo, null);
  }
  return mapa;
}

/**
 * Quanto tempo esta resposta está demorando.
 *
 * Não é enfeite. O contexto aqui pode ter centenas de milhares de tokens, e o
 * primeiro pedaço leva de segundos a meio minuto para chegar — tempo suficiente
 * para alguém concluir que travou e fechar a tela. Três bolinhas dizem "espere"
 * e não dizem por quanto; um número que anda diz que a coisa está viva.
 */
function useCronometro(ativo: boolean): number {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    if (!ativo) {
      setSegundos(0);
      return;
    }
    const inicio = Date.now();
    const timer = setInterval(
      () => setSegundos(Math.floor((Date.now() - inicio) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [ativo]);

  return segundos;
}

function Copiar({ trechos }: { trechos: TrechoDaConversa[] }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(textoComRotulos(trechos));
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      }}
      /* A tela mostra "João da Silva" para quem está aqui, com a máquina
         trancada. O que sai por Ctrl+C vai para lugar nenhum sabido — um
         e-mail, um documento — e ali o nome real não deveria estar. Copia-se o
         que de fato trafegou. */
      title="copia com os pseudônimos, como trafegou"
      className={[
        "font-mono text-2xs transition-opacity duration-[120ms]",
        "focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2",
        "focus-visible:outline-offset-2 focus-visible:outline-accent",
        copiado
          ? "text-success opacity-100"
          : "text-text-tertiary opacity-0 hover:text-text-secondary group-hover:opacity-100",
      ].join(" ")}
    >
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}

export function Conversa({
  ids,
  aoFechar,
  aoIrParaDocumentos,
  aoIrParaAjustes,
  temChave,
}: ConversaProps) {
  const { estado, erro, abrindo, perguntar, cancelar, previsualizar, orcamento } =
    useConversa(ids);
  const [pergunta, setPergunta] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const [custo, setCusto] = useState<Awaited<
    ReturnType<typeof orcamento>
  > | null>(null);

  const rolagem = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  /* Só acompanha o fim enquanto o leitor está no fim. Rolou para reler algo
     lá em cima, a resposta continua chegando sem puxar a página de volta —
     que é o comportamento mais irritante de um chat que escreve sozinho. */
  const coladoNoFim = useRef(true);

  const enviando = estado?.enviando ?? false;
  const segundos = useCronometro(enviando);

  useEffect(() => {
    void orcamento().then(setCusto);
  }, [orcamento, estado?.id]);

  useEffect(() => {
    if (!coladoNoFim.current) return;
    const caixa = rolagem.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [estado?.turnos.length, estado?.parcial.length, enviando]);

  /* O campo cresce com o texto até um teto, e volta ao mínimo quando esvazia. */
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [pergunta]);

  if (ids === null || ids.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Cartao
          titulo="Conversar com os autos"
          descricao="Escolha documentos na biblioteca para começar."
        >
          <p className="font-serif text-sm leading-relaxed text-text-secondary">
            A conversa acontece sobre o <strong>texto anonimizado</strong>: os
            nomes, CPFs e endereços já foram substituídos por pseudônimos antes
            de sair desta máquina. Os nomes reais aparecem de volta aqui na
            tela, repostos localmente — o mapa que liga um ao outro nunca é
            enviado.
          </p>
          <div className="mt-4">
            <Botao tipo="primario" onClick={aoIrParaDocumentos}>
              Escolher documentos
            </Botao>
          </div>
        </Cartao>
      </div>
    );
  }

  if (!temChave) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Cartao
          titulo="Falta a chave da API"
          descricao="A conversa usa o OpenRouter, e ele precisa de uma credencial sua."
        >
          <p className="font-serif text-sm leading-relaxed text-text-secondary">
            A chave fica cifrada nesta máquina, com a mesma proteção do cofre.
            Vale usar uma chave dedicada, com limite de crédito no painel do
            OpenRouter.
          </p>
          <div className="mt-4">
            <Botao tipo="primario" onClick={aoIrParaAjustes}>
              Ir para Ajustes
            </Botao>
          </div>
        </Cartao>
      </div>
    );
  }

  const bloqueada = estado?.comprometida ?? false;
  const avisos = estado?.avisos ?? [];
  const graves = avisos.filter((a) => a.grave);
  const leves = avisos.filter((a) => !a.grave);
  const vazia = (estado?.turnos.length ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-3">
        <Botao tipo="discreto" tamanho="mini" icone="voltar" onClick={aoFechar}>
          Documentos
        </Botao>
        <span className="min-w-0 truncate font-mono text-2xs text-text-tertiary">
          {estado?.documentos.length ?? ids.length} documento
          {(estado?.documentos.length ?? ids.length) > 1 ? "s" : ""}
          {custo &&
            ` · ~${custo.tokensEntrada.toLocaleString("pt-BR")} tokens · ~US$ ${custo.dolares.toFixed(3)} por pergunta`}
          {estado && estado.gastoDolares > 0 &&
            ` · gasto US$ ${estado.gastoDolares.toFixed(4)}`}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {estado?.provedor && (
            <Selo tom={bloqueada ? "perigo" : "neutro"}>{estado.provedor}</Selo>
          )}
          <Botao
            tipo="discreto"
            tamanho="mini"
            onClick={() => void previsualizar().then(setPrevia)}
          >
            Ver o que sai
          </Botao>
        </div>
      </header>

      <div
        ref={rolagem}
        onScroll={(e) => {
          const el = e.currentTarget;
          coladoNoFim.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-6 py-5">
          {abrindo && (
            <p className="font-mono text-xs text-text-tertiary">
              Preparando os documentos…
            </p>
          )}

          {(erro || estado?.erro) && (
            <p
              role="alert"
              className="mb-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-serif text-sm text-danger"
            >
              {erro ?? estado?.erro}
            </p>
          )}

          {graves.map((a, i) => (
            <p
              key={i}
              className="mb-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-serif text-sm text-danger"
            >
              <strong>Atenção: </strong>
              {a.texto}
            </p>
          ))}

          {/* Aviso leve não pode ocupar o topo da tela para sempre: são notas de
              procedência, lidas uma vez. Ficam recolhidas numa linha, com o
              número à vista para que ninguém precise adivinhar que existem. */}
          {leves.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setAvisosAbertos((v) => !v)}
                className="font-mono text-2xs text-text-tertiary hover:text-text-secondary"
                aria-expanded={avisosAbertos}
              >
                {avisosAbertos ? "▾" : "▸"} {leves.length} nota
                {leves.length > 1 ? "s" : ""} sobre a procedência dos documentos
              </button>
              {avisosAbertos && (
                <ul className="mt-2 space-y-1.5 border-l-2 border-border-subtle pl-3">
                  {leves.map((a, i) => (
                    <li
                      key={i}
                      className="font-serif text-sm leading-relaxed text-text-secondary"
                    >
                      {a.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {vazia && !abrindo && !erro && (
            <div className="py-10">
              <p className="font-serif text-base leading-relaxed text-text-secondary">
                {estado?.documentos.length === 1
                  ? "Um documento carregado."
                  : `${estado?.documentos.length ?? 0} documentos carregados, com um espaço de pseudônimos comum.`}{" "}
                Pergunte o que quiser sobre eles.
              </p>
              <ul className="mt-4 space-y-1.5">
                {[
                  "Resuma este processo em dez linhas.",
                  "Quem são as partes e quem representa cada uma?",
                  "Que prazos e datas aparecem, e o que vence primeiro?",
                ].map((s) => (
                  <li key={s}>
                    <button
                      onClick={() => {
                        setPergunta(s);
                        campo.current?.focus();
                      }}
                      className="text-left font-serif text-sm text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-6">
            {estado?.turnos.map((turno, i) => {
              const nomes = mapaDeNomes(turno.trechos);
              const texto = textoComRotulos(turno.trechos);

              if (turno.papel === "usuario") {
                return (
                  <article key={i} className="group flex flex-col items-end">
                    {/* Sem `<p>` em volta: `Markdown` já emite blocos, e um
                        `<div>` dentro de `<p>` é HTML inválido — o navegador
                        fecha o parágrafo sozinho e o layout sai torto. */}
                    <div className="max-w-[80%] rounded-lg rounded-br-sm bg-surface px-4 py-2.5">
                      <Markdown texto={texto} nomes={nomes} />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Copiar trechos={turno.trechos} />
                      <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                        você
                      </span>
                    </div>
                    {turno.trocas && turno.trocas.length > 0 && (
                      <p className="mt-1 max-w-[80%] text-right font-mono text-2xs leading-relaxed text-text-tertiary">
                        trocado antes de sair:{" "}
                        {turno.trocas
                          .map((t) => `"${t.valor}" → ${t.rotulo}`)
                          .join(" · ")}
                      </p>
                    )}
                  </article>
                );
              }

              return (
                <article key={i} className="group">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                      resposta
                    </span>
                    <Copiar trechos={turno.trechos} />
                  </div>
                  <Markdown texto={texto} nomes={nomes} />
                </article>
              );
            })}

            {/* A resposta chegando, e — antes dela — a prova de que está vindo. */}
            {enviando && (
              <article>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                    resposta
                  </span>
                  <span className="font-mono text-2xs tabular-nums text-text-tertiary">
                    {estado && estado.parcial.length > 0
                      ? `escrevendo · ${segundos}s`
                      : `consultando ${estado?.modelo ?? "o modelo"} · ${segundos}s`}
                  </span>
                  <button
                    onClick={cancelar}
                    className="font-mono text-2xs text-text-tertiary underline underline-offset-2 hover:text-danger"
                  >
                    parar
                  </button>
                </div>
                {estado && estado.parcial.length > 0 ? (
                  <Markdown
                    texto={textoComRotulos(estado.parcial)}
                    nomes={mapaDeNomes(estado.parcial)}
                    cursor
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-[1em] w-[0.45em] animate-pulse bg-accent" />
                    <span className="font-serif text-sm italic text-text-tertiary">
                      lendo os documentos
                    </span>
                  </div>
                )}
              </article>
            )}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border-subtle px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {bloqueada && (
            <p className="mb-2 font-serif text-sm text-danger">
              Esta conversa foi marcada como comprometida e não aceita novos
              envios.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const texto = pergunta.trim();
              if (!texto || enviando || bloqueada) return;
              setPergunta("");
              coladoNoFim.current = true;
              void perguntar(texto);
            }}
            /* O botão vive dentro da moldura do campo, e a moldura inteira
               acende no foco. Dois retângulos lado a lado faziam a área de
               digitação parecer menor do que é. */
            className={[
              "flex items-end gap-2 rounded-lg border bg-surface px-3 py-2",
              "border-border-subtle transition-colors duration-[120ms]",
              "focus-within:border-accent",
              bloqueada ? "opacity-50" : "",
            ].join(" ")}
          >
            <textarea
              ref={campo}
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.currentTarget.form?.requestSubmit();
                  e.preventDefault();
                }
              }}
              rows={1}
              disabled={bloqueada}
              placeholder="Pergunte sobre os documentos…"
              aria-label="Pergunta"
              className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 font-serif text-sm leading-relaxed text-text placeholder:text-text-tertiary focus:outline-none"
            />
            {enviando ? (
              <Botao tipo="secundario" tamanho="mini" onClick={cancelar}>
                Parar
              </Botao>
            ) : (
              <Botao
                tipo="primario"
                tamanho="mini"
                type="submit"
                disabled={bloqueada || pergunta.trim() === ""}
              >
                Enviar
              </Botao>
            )}
          </form>
          <p className="mt-2 font-mono text-2xs text-text-tertiary">
            Enter envia, Shift+Enter quebra linha. Nome ou CPF real que você
            digitar é substituído pelo pseudônimo antes de sair — e a troca
            aparece na mensagem.
          </p>
        </div>
      </footer>

      <Dialogo
        aberto={previa !== null}
        aoFechar={() => setPrevia(null)}
        titulo="O que sai desta máquina"
      >
        <p className="mb-3 font-serif text-sm text-text-secondary">
          É este o conteúdo que seria enviado ao modelo. Os dados pessoais já
          estão substituídos por pseudônimos. A anonimização mede{" "}
          <strong>99,94% por ocorrência</strong> no gate do produto — alta, e não
          100%.
        </p>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-surface p-3 font-mono text-2xs leading-relaxed text-text-secondary">
          {previa}
        </pre>
      </Dialogo>
    </div>
  );
}
