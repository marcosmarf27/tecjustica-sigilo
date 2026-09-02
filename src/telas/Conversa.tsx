import { useEffect, useMemo, useRef, useState } from "react";

import { useConversa } from "../hooks/useConversa";
import { Markdown, type MapaDeNomes } from "../componentes/Markdown";
import { SeletorDeDocumentos } from "../componentes/SeletorDeDocumentos";
import { Botao, Dialogo, Icone, Selo, Tecla } from "../ui";

/**
 * Conversar com os autos — a tela de chat.
 *
 * ## O que mudou de lugar
 *
 * Antes, conversar exigia ir a Documentos, marcar, clicar em "Conversar" e
 * chegar aqui. A escolha dos documentos agora mora **nesta** tela: os nomes
 * ficam em chips acima do campo de pergunta, e um botão abre a lista do cofre
 * para trocar. O contrato com o processo principal não mudou — o que viaja
 * continua sendo id do cofre, nunca texto.
 *
 * A explicação sobre o que sai da máquina saiu dos Ajustes e veio para a
 * abertura da conversa, que é onde ela muda uma decisão: quem cola uma chave
 * já decidiu usar o recurso; quem está prestes a enviar é quem precisa ler.
 *
 * ## O campo está sempre à vista
 *
 * Como em qualquer chat que a pessoa já use: a área de texto fica presa ao
 * rodapé, a conversa rola por cima. O estado vazio ocupa o meio com o convite
 * e as sugestões, e o campo já está lá embaixo, pronto.
 */

interface ConversaProps {
  /** Os documentos escolhidos, por id do cofre. `null` = nenhum ainda. */
  ids: string[] | null;
  /** Tudo o que há no cofre, para o seletor e para os nomes nos chips. */
  documentos: EntradaDoCofre[];
  aoEscolherDocumentos: (ids: string[]) => void;
  aoIrParaAjustes: () => void;
  temChave: boolean;
  /** Modelo preferido, do catálogo. `null` = o padrão. */
  modelo: string | null;
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
      title="Copia com os pseudônimos, como trafegou"
      className={[
        "font-mono text-2xs transition-opacity duration-[120ms]",
        "focus-visible:opacity-100",
        copiado
          ? "text-success opacity-100"
          : "text-text-tertiary opacity-0 hover:text-text-secondary group-hover:opacity-100",
      ].join(" ")}
    >
      {copiado ? "copiado" : "copiar"}
    </button>
  );
}

/** O selo do aplicativo, ao lado de cada resposta — para os turnos se distinguirem de relance. */
function Selo_S() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs font-bold text-on-accent"
    >
      S
    </span>
  );
}

const SUGESTOES = [
  "Resuma este processo em dez linhas.",
  "Quem são as partes e quem representa cada uma?",
  "Que prazos e datas aparecem, e o que vence primeiro?",
];

export function Conversa({
  ids,
  documentos,
  aoEscolherDocumentos,
  aoIrParaAjustes,
  temChave,
  modelo,
}: ConversaProps) {
  const { estado, erro, abrindo, perguntar, cancelar, previsualizar, orcamento } =
    useConversa(ids, modelo);
  const [pergunta, setPergunta] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const [custo, setCusto] = useState<Awaited<ReturnType<typeof orcamento>> | null>(null);

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

  const escolhidos = useMemo(() => {
    const porId = new Map(documentos.map((d) => [d.id, d]));
    return (ids ?? []).map((id) => porId.get(id)).filter((d): d is EntradaDoCofre => !!d);
  }, [ids, documentos]);

  const semDocumentos = ids === null || ids.length === 0;
  const bloqueada = estado?.comprometida ?? false;
  const podeEnviar = temChave && !semDocumentos && !bloqueada && !abrindo && estado !== null;
  const avisos = estado?.avisos ?? [];
  const graves = avisos.filter((a) => a.grave);
  const leves = avisos.filter((a) => !a.grave);
  const vazia = (estado?.turnos.length ?? 0) === 0;

  const enviar = () => {
    const texto = pergunta.trim();
    if (!texto || enviando || !podeEnviar) return;
    setPergunta("");
    coladoNoFim.current = true;
    void perguntar(texto);
  };

  const custoPorPergunta =
    custo && `~US$ ${custo.dolares.toFixed(3)} por pergunta · ~${custo.tokensEntrada.toLocaleString("pt-BR")} tokens`;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={rolagem}
        onScroll={(e) => {
          const el = e.currentTarget;
          coladoNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {(erro || estado?.erro) && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 font-serif text-sm text-danger"
            >
              {erro ?? estado?.erro}
            </p>
          )}

          {graves.map((a, i) => (
            <p
              key={i}
              className="mb-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 font-serif text-sm text-danger"
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
                    <li key={i} className="font-serif text-sm leading-relaxed text-text-secondary">
                      {a.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {vazia && !abrindo && !erro && (
            <div className="flex min-h-[46vh] flex-col items-center justify-center py-10 text-center">
              <span
                aria-hidden="true"
                className="grid size-12 place-items-center rounded-full bg-accent font-mono text-base font-bold text-on-accent"
              >
                S
              </span>
              <h1 className="mt-5 font-mono text-xl font-semibold tracking-tight text-text">
                Conversar com os autos
              </h1>

              {!temChave ? (
                <>
                  <p className="mt-3 max-w-md font-serif text-sm leading-relaxed text-text-secondary">
                    A conversa usa o OpenRouter e precisa de uma credencial sua, guardada cifrada
                    nesta máquina. Sem ela, o aplicativo não fala com a internet.
                  </p>
                  <Botao tipo="primario" className="mt-5" onClick={aoIrParaAjustes}>
                    Colar a chave nos Ajustes
                  </Botao>
                </>
              ) : semDocumentos ? (
                <>
                  <p className="mt-3 max-w-md font-serif text-sm leading-relaxed text-text-secondary">
                    Escolha peças do cofre. O que sai desta máquina é o{" "}
                    <strong className="text-text">texto anonimizado</strong> — nomes, CPFs e
                    endereços já substituídos por pseudônimos —, e só para modelos com{" "}
                    <strong className="text-text">retenção zero</strong>, como a Resolução CNJ
                    615/2025 exige. Os nomes reais voltam só aqui na tela.
                  </p>
                  <Botao
                    tipo="primario"
                    className="mt-5"
                    icone="arquivar"
                    onClick={() => setEscolhendo(true)}
                    disabled={documentos.length === 0}
                  >
                    Escolher documentos
                  </Botao>
                  {documentos.length === 0 && (
                    <p className="mt-3 font-mono text-xs text-text-tertiary">
                      O cofre está vazio. Anonimize um documento e guarde-o para conversar.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-3 max-w-md font-serif text-sm leading-relaxed text-text-secondary">
                    {escolhidos.length === 1
                      ? "Um documento carregado."
                      : `${escolhidos.length} documentos carregados, com um espaço de pseudônimos comum.`}{" "}
                    A anonimização mede <strong className="text-text">99,94% por ocorrência</strong>{" "}
                    — alta, e não 100%.{" "}
                    <button
                      onClick={() => void previsualizar().then(setPrevia)}
                      className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                    >
                      Veja o que sai
                    </button>{" "}
                    antes de perguntar.
                  </p>
                  <ul className="mt-6 flex flex-wrap justify-center gap-2">
                    {SUGESTOES.map((s) => (
                      <li key={s}>
                        <button
                          onClick={() => {
                            setPergunta(s);
                            campo.current?.focus();
                          }}
                          className="rounded-full border border-border-subtle bg-surface px-3.5 py-1.5 font-serif text-sm text-text-secondary transition-colors duration-[120ms] hover:border-accent hover:text-text"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {abrindo && (
            <p className="flex items-center gap-2 font-mono text-xs text-text-tertiary">
              <span className="inline-block h-[1em] w-[0.45em] animate-pulse bg-accent" />
              Preparando os documentos…
            </p>
          )}

          <div className="space-y-7">
            {estado?.turnos.map((turno, i) => {
              const nomes = mapaDeNomes(turno.trechos);
              const texto = textoComRotulos(turno.trechos);

              if (turno.papel === "usuario") {
                return (
                  <article key={i} className="group flex flex-col items-end">
                    {/* Sem `<p>` em volta: `Markdown` já emite blocos, e um
                        `<div>` dentro de `<p>` é HTML inválido. */}
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-surface-sunken px-4 py-2.5">
                      <Markdown texto={texto} nomes={nomes} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 pr-1">
                      <Copiar trechos={turno.trechos} />
                    </div>
                    {turno.trocas && turno.trocas.length > 0 && (
                      <p className="mt-1 max-w-[80%] text-right font-mono text-2xs leading-relaxed text-text-tertiary">
                        trocado antes de sair:{" "}
                        {turno.trocas.map((t) => `"${t.valor}" → ${t.rotulo}`).join(" · ")}
                      </p>
                    )}
                  </article>
                );
              }

              return (
                <article key={i} className="group flex gap-3">
                  <Selo_S />
                  <div className="min-w-0 flex-1">
                    <Markdown texto={texto} nomes={nomes} />
                    <div className="mt-1.5">
                      <Copiar trechos={turno.trechos} />
                    </div>
                  </div>
                </article>
              );
            })}

            {/* A resposta chegando, e — antes dela — a prova de que está vindo. */}
            {enviando && (
              <article className="flex gap-3">
                <Selo_S />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
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
                </div>
              </article>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pt-2 pb-5">
        <div className="mx-auto w-full max-w-3xl">
          {bloqueada && (
            <p className="mb-2 font-serif text-sm text-danger">
              Esta conversa foi marcada como comprometida e não aceita novos envios.
            </p>
          )}

          {/* O campo, os documentos e o botão vivem numa moldura só, que acende
              inteira no foco: é o "compositor" que todo chat tem, e é onde a
              pessoa olha primeiro. */}
          <div
            className={[
              "rounded-2xl border bg-surface shadow-sm transition-[border-color,box-shadow] duration-[120ms]",
              "border-border-subtle focus-within:border-accent focus-within:shadow-md",
              bloqueada ? "opacity-50" : "",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
              {escolhidos.map((d) => (
                <Selo key={d.id} tom="neutro" className="max-w-[16rem]">
                  <Icone nome="documento" tamanho={11} />
                  <span className="truncate">{d.nome}</span>
                </Selo>
              ))}
              <button
                type="button"
                onClick={() => setEscolhendo(true)}
                disabled={documentos.length === 0}
                className="inline-flex min-h-6 items-center gap-1 rounded-full px-2 font-mono text-2xs text-accent transition-colors duration-[120ms] hover:bg-accent-muted disabled:opacity-40"
              >
                <Icone nome="mais" tamanho={11} />
                {escolhidos.length === 0 ? "Escolher documentos" : "Trocar"}
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                enviar();
              }}
              className="flex items-end gap-2 px-3 pt-2 pb-3"
            >
              <textarea
                ref={campo}
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                rows={1}
                disabled={!podeEnviar}
                placeholder={
                  !temChave
                    ? "Cole a chave nos Ajustes para conversar"
                    : semDocumentos
                      ? "Escolha os documentos para começar"
                      : "Pergunte sobre os documentos…"
                }
                aria-label="Pergunta"
                className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1 font-serif text-base leading-relaxed text-text placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
              />
              {enviando ? (
                <Botao
                  tipo="secundario"
                  circular
                  icone="fechar"
                  aria-label="Parar a resposta"
                  onClick={cancelar}
                />
              ) : (
                <Botao
                  tipo="primario"
                  circular
                  icone="enviar"
                  type="submit"
                  aria-label="Enviar"
                  disabled={!podeEnviar || pergunta.trim() === ""}
                />
              )}
            </form>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 font-mono text-2xs text-text-tertiary">
            <span className="flex flex-wrap items-center gap-x-2">
              {estado?.modelo && <span>{estado.modelo}</span>}
              {estado?.provedor && (
                <Selo tom={bloqueada ? "perigo" : "neutro"}>{estado.provedor}</Selo>
              )}
              {custoPorPergunta && <span>{custoPorPergunta}</span>}
              {estado && estado.gastoDolares > 0 && (
                <span>gasto US$ {estado.gastoDolares.toFixed(4)}</span>
              )}
              {!semDocumentos && (
                <button
                  onClick={() => void previsualizar().then(setPrevia)}
                  className="underline underline-offset-2 hover:text-text-secondary"
                >
                  ver o que sai
                </button>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <Tecla>Enter</Tecla> envia · <Tecla>Shift+Enter</Tecla> quebra linha
            </span>
          </div>
        </div>
      </div>

      <SeletorDeDocumentos
        aberto={escolhendo}
        documentos={documentos}
        escolhidos={ids ?? []}
        aoFechar={() => setEscolhendo(false)}
        aoConfirmar={(novos) => {
          setEscolhendo(false);
          aoEscolherDocumentos(novos);
        }}
      />

      <Dialogo aberto={previa !== null} aoFechar={() => setPrevia(null)} titulo="O que sai desta máquina">
        <p className="mb-3 font-serif text-sm text-text-secondary">
          É este o conteúdo que seria enviado ao modelo. Os dados pessoais já estão substituídos
          por pseudônimos. A anonimização mede <strong>99,94% por ocorrência</strong> no gate do
          produto — alta, e não 100%.
        </p>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-text-secondary">
          {previa}
        </pre>
      </Dialogo>
    </div>
  );
}
