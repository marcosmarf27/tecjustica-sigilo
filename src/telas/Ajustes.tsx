import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useApp } from "../estado/AppEstado";
import {
  Botao,
  CabecalhoDeTela,
  Cartao,
  Dialogo,
  GrupoSegmentado,
  Interruptor,
  LinhaDeAjuste,
  Selo,
} from "../ui";
import type { Tema } from "../hooks/usePreferencias";
import type { AvisoDeModo } from "../hooks/usePythonBackend";
import { GradeDeEntidades } from "../componentes/GradeDeEntidades";
import { EscolhaDePolitica } from "../componentes/EscolhaDePolitica";
import { PainelDenyList } from "../componentes/PainelDenyList";
import { PainelNuvem } from "../componentes/PainelNuvem";

/**
 * Ajustes — em duas colunas: as seções à esquerda, o conteúdo à direita.
 *
 * A versão anterior era uma pilha de cartões, cada um montando a sua
 * configuração de um jeito. Com sete assuntos (aparência, saída, anonimização,
 * cofre, conversa, termos liberados, motor) a pilha passava de duas telas de
 * altura e não havia como saber o que existia sem rolar tudo.
 *
 * Duas coisas resolvem isso, e são as mesmas que os aplicativos que as pessoas
 * já usam adotaram: um índice fixo à esquerda, que diz o que há e leva até lá;
 * e uma forma única para cada ajuste (`LinhaDeAjuste`), para que o olho varra
 * em vez de ler.
 *
 * Os padrões de anonimização aparecem aqui **e** na receita da Mesa. Aqui é
 * onde se descobre que eles existem; lá é onde se mudam no ato. São os mesmos
 * componentes, ligados às mesmas preferências.
 */

const TEMAS: { valor: Tema; rotulo: string; descricao: string }[] = [
  { valor: "papel", rotulo: "Papel", descricao: "Sempre claro" },
  { valor: "noite", rotulo: "Noite", descricao: "Sempre escuro" },
  { valor: "sistema", rotulo: "Sistema", descricao: "Seguir o sistema operacional" },
];

const SECOES = [
  { id: "geral", rotulo: "Geral" },
  { id: "anonimizacao", rotulo: "Anonimização" },
  { id: "cofre", rotulo: "Cofre" },
  { id: "conversa", rotulo: "Conversar" },
  { id: "termos", rotulo: "Termos liberados" },
  { id: "motor", rotulo: "Motor" },
] as const;

type IdSecao = (typeof SECOES)[number]["id"];

function Secao({
  id,
  titulo,
  descricao,
  children,
}: {
  id: IdSecao;
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <section id={`ajustes-${id}`} aria-labelledby={`ajustes-${id}-titulo`} className="scroll-mt-6">
      <h2 id={`ajustes-${id}-titulo`} className="font-mono text-base font-semibold text-text">
        {titulo}
      </h2>
      {descricao && <p className="mt-1 text-sm text-text-tertiary">{descricao}</p>}
      <Cartao semPreenchimento className="mt-3">
        <div className="divide-y divide-border-subtle px-4">{children}</div>
      </Cartao>
    </section>
  );
}

interface AjustesProps {
  modoNlp: string;
  /** Não-nulo quando o motor pedido não subiu e caiu para outro. */
  avisoDeModo: AvisoDeModo | null;
  /** `null` enquanto a checagem não voltou; `false` = o sistema não cifra. */
  cofreDisponivel: boolean | null;
  itensNoCofre: number;
  aoEsvaziarCofre: () => void;
  buscarDenyList: () => Promise<Record<string, string[]>>;
  gravarDenyList: (lista: Record<string, string[]>) => Promise<void>;
  avisar: (mensagem: string, tipo?: "sucesso" | "erro") => void;
}

export function Ajustes({
  modoNlp,
  avisoDeModo,
  cofreDisponivel,
  itensNoCofre,
  aoEsvaziarCofre,
  buscarDenyList,
  gravarDenyList,
  avisar,
}: AjustesProps) {
  const { prefs, definirPref, restaurarPreferencias } = useApp();
  const [confirmandoEsvaziar, setConfirmandoEsvaziar] = useState(false);
  const [ativa, setAtiva] = useState<IdSecao>("geral");
  const rolagem = useRef<HTMLDivElement>(null);
  const degradado = avisoDeModo !== null;

  /* O índice acompanha a rolagem: a seção mais alta que está à vista fica
     marcada. Sem isso o índice é só um menu de atalhos, e a pessoa não sabe
     onde está depois de rolar. */
  useEffect(() => {
    const raiz = rolagem.current;
    if (!raiz) return;
    const secoes = SECOES.map((s) => document.getElementById(`ajustes-${s.id}`)).filter(
      (el): el is HTMLElement => el !== null
    );
    const visiveis = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (e.isIntersecting) visiveis.set(e.target.id, e.boundingClientRect.top);
          else visiveis.delete(e.target.id);
        }
        const primeira = [...visiveis.entries()].sort((a, b) => a[1] - b[1])[0];
        if (primeira) setAtiva(primeira[0].replace("ajustes-", "") as IdSecao);
      },
      { root: raiz, rootMargin: "0px 0px -60% 0px", threshold: 0 }
    );
    secoes.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  /* Rola SÓ o contêiner desta tela. `scrollIntoView` rola todos os
     ancestrais roláveis — inclusive os de `overflow: hidden`, que o
     navegador rola por programa — e, quando a última seção é curta demais
     para chegar ao topo por dentro, ele completava a distância rolando a
     casca inteira: a barra de título sumia e o trilho subia junto. */
  const irPara = (id: IdSecao) => {
    const raiz = rolagem.current;
    const alvo = document.getElementById(`ajustes-${id}`);
    if (raiz && alvo) {
      const topo =
        alvo.getBoundingClientRect().top - raiz.getBoundingClientRect().top + raiz.scrollTop - 24;
      raiz.scrollTo({ top: Math.max(0, topo), behavior: "smooth" });
    }
    setAtiva(id);
  };

  const escolherPasta = async () => {
    if (!window.electronAPI?.selectDirectory) return;
    const pasta = await window.electronAPI.selectDirectory();
    if (pasta) definirPref("pastaDeSaida", pasta);
  };

  const nomeCurtoDaPasta = (caminho: string) => {
    const sep = caminho.includes("\\") ? "\\" : "/";
    return caminho.split(sep).filter(Boolean).pop() ?? caminho;
  };

  return (
    <div ref={rolagem} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <CabecalhoDeTela
          titulo="Ajustes"
          subtitulo="Valem para as próximas aberturas. Nada aqui é dado pessoal."
          acoes={
            <Botao tipo="discreto" onClick={restaurarPreferencias}>
              Restaurar padrões
            </Botao>
          }
        />

        <div className="mt-6 flex items-start gap-10">
          <nav aria-label="Seções dos ajustes" className="sticky top-0 w-44 shrink-0">
            <ul className="space-y-0.5">
              {SECOES.map((s) => {
                const atual = s.id === ativa;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => irPara(s.id)}
                      aria-current={atual ? "true" : undefined}
                      className={[
                        "w-full rounded-md px-3 py-1.5 text-left font-mono text-sm",
                        "transition-colors duration-[120ms]",
                        atual
                          ? "bg-surface text-text shadow-sm"
                          : "text-text-secondary hover:bg-surface-hover hover:text-text",
                      ].join(" ")}
                    >
                      {s.rotulo}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 space-y-10 pb-24">
            <Secao id="geral" titulo="Geral" descricao="Aparência e onde os arquivos vão parar.">
              <LinhaDeAjuste titulo="Tema" descricao="“Sistema” acompanha a configuração do Windows.">
                <GrupoSegmentado
                  rotulo="Tema da interface"
                  opcoes={TEMAS}
                  valor={prefs.tema}
                  onChange={(tema) => definirPref("tema", tema)}
                />
              </LinhaDeAjuste>

              <LinhaDeAjuste
                titulo="Formato do arquivo salvo"
                descricao="A saída é sempre texto — nunca o formato de entrada. Um PDF anonimizado sai como documento de texto."
              >
                <GrupoSegmentado
                  rotulo="Formato de saída"
                  opcoes={[
                    { valor: "md" as const, rotulo: ".md", descricao: "Markdown — abre em qualquer editor" },
                    { valor: "docx" as const, rotulo: ".docx", descricao: "Word, LibreOffice ou Google Docs" },
                  ]}
                  valor={prefs.formato}
                  onChange={(formato) => definirPref("formato", formato)}
                />
              </LinhaDeAjuste>

              <LinhaDeAjuste
                titulo="Onde salvar"
                descricao={
                  prefs.pastaDeSaida ? (
                    <>
                      Em <code className="font-mono text-text">{prefs.pastaDeSaida}</code>
                    </>
                  ) : (
                    "Ao lado do arquivo original, com o nome acrescido do formato escolhido."
                  )
                }
              >
                <div className="flex items-center gap-2">
                  {prefs.pastaDeSaida && (
                    <Botao tamanho="mini" tipo="discreto" onClick={() => definirPref("pastaDeSaida", null)}>
                      Ao lado do original
                    </Botao>
                  )}
                  <Botao
                    tamanho="mini"
                    icone="pasta"
                    onClick={escolherPasta}
                    disabled={!window.electronAPI?.selectDirectory}
                  >
                    {prefs.pastaDeSaida ? nomeCurtoDaPasta(prefs.pastaDeSaida) : "Escolher pasta"}
                  </Botao>
                </div>
              </LinhaDeAjuste>
            </Secao>

            <Secao
              id="anonimizacao"
              titulo="Anonimização"
              descricao="O que a tela Anonimizar faz quando você não muda nada. Lá, cada trecho da frase muda isto no ato."
            >
              <LinhaDeAjuste
                titulo="Tipos de dado mascarados"
                descricao="Um tipo desmarcado fica em claro no documento — e o texto sai parecendo anonimizado do mesmo jeito."
                empilhado
              >
                <GradeDeEntidades
                  selecionadas={prefs.entidades}
                  aoMudar={(e) => definirPref("entidades", e)}
                  colunas={3}
                />
              </LinhaDeAjuste>

              <LinhaDeAjuste
                titulo="Como substituir"
                descricao="Só o marcador numera as pessoas de forma estável — e só ele permite conversar com o documento depois."
                empilhado
              >
                <EscolhaDePolitica
                  valor={prefs.politica}
                  aoMudar={(p) => definirPref("politica", p)}
                  horizontal
                />
              </LinhaDeAjuste>
            </Secao>

            <Secao
              id="cofre"
              titulo="Cofre"
              descricao="Guardar documentos cifrados para reabrir a revisão e conversar sobre eles depois."
            >
              {cofreDisponivel === false ? (
                <LinhaDeAjuste
                  titulo="Indisponível nesta conta"
                  descricao="O sistema não oferece cifragem para esta conta. O cofre recusa gravar nessa situação, em vez de gravar em claro."
                />
              ) : (
                <>
                  <LinhaDeAjuste
                    titulo="Guardar documentos"
                    descricao="Texto original, ocorrências e texto anonimizado, cifrados com a proteção de dados do Windows. A cifragem protege contra outro usuário desta máquina e contra a leitura do disco fora do sistema — não contra um programa malicioso rodando com a sua própria conta."
                  >
                    <Interruptor
                      rotulo="Guardar documentos no cofre"
                      ligado={prefs.cofreLigado}
                      aoMudar={(v) => {
                        definirPref("cofreLigado", v);
                        definirPref("cofrePerguntado", true);
                      }}
                    />
                  </LinhaDeAjuste>

                  <LinhaDeAjuste
                    titulo="Apagar sozinho depois de"
                    descricao="O valor de reabrir cai rápido; o risco de manter dado pessoal no disco, não."
                  >
                    <GrupoSegmentado
                      rotulo="Prazo de guarda"
                      opcoes={[
                        { valor: "7" as const, rotulo: "7 dias", descricao: "Uma semana" },
                        { valor: "30" as const, rotulo: "30 dias", descricao: "Um mês" },
                        { valor: "90" as const, rotulo: "90 dias", descricao: "Um trimestre" },
                        { valor: "0" as const, rotulo: "Nunca", descricao: "Só apagando à mão" },
                      ]}
                      valor={String(prefs.diasDeExpurgo) as "7" | "30" | "90" | "0"}
                      onChange={(v) => definirPref("diasDeExpurgo", Number(v))}
                    />
                  </LinhaDeAjuste>

                  <LinhaDeAjuste
                    titulo="Arquivar por processo"
                    descricao="Agrupa pelo número CNJ que o detector encontrou. Sem número, o documento vai para “Avulsos”."
                  >
                    <Interruptor
                      rotulo="Arquivar por número de processo"
                      ligado={prefs.autoArquivamento}
                      aoMudar={(v) => definirPref("autoArquivamento", v)}
                    />
                  </LinhaDeAjuste>

                  <LinhaDeAjuste
                    titulo={`${itensNoCofre} documento${itensNoCofre === 1 ? "" : "s"} guardado${itensNoCofre === 1 ? "" : "s"}`}
                    descricao="Esvaziar apaga tudo do disco. Os arquivos que você já salvou não são afetados."
                  >
                    <Botao
                      tipo="perigo"
                      tamanho="mini"
                      icone="lixeira"
                      disabled={itensNoCofre === 0}
                      onClick={() => setConfirmandoEsvaziar(true)}
                    >
                      Esvaziar o cofre
                    </Botao>
                  </LinhaDeAjuste>
                </>
              )}
            </Secao>

            <Secao
              id="conversa"
              titulo="Conversar com os autos"
              descricao="Perguntar a um modelo na nuvem sobre documentos já anonimizados. Só o texto anonimizado sai daqui, e só para provedores com retenção zero."
            >
              <PainelNuvem />
            </Secao>

            <Secao id="termos" titulo="Termos liberados">
              <PainelDenyList buscar={buscarDenyList} gravar={gravarDenyList} avisar={avisar} />
            </Secao>

            <Secao id="motor" titulo="Motor de anonimização">
              <LinhaDeAjuste
                titulo={
                  modoNlp === "transformer"
                    ? "BERT jurídico"
                    : modoNlp === "spacy"
                      ? "spaCy leve"
                      : "Indeterminado"
                }
                descricao={
                  modoNlp === "transformer"
                    ? "Modelo treinado em jurisprudência brasileira (LeNER-Br). É o que a acurácia medida do produto pressupõe."
                    : "Modelo leve: encontra menos nomes e locais do que o BERT."
                }
              >
                <Selo tom={degradado ? "atencao" : "deferido"} comPonto>
                  {degradado ? "Degradado" : "Normal"}
                </Selo>
              </LinhaDeAjuste>

              {avisoDeModo && (
                /* O motivo é a parte acionável: sem ele, "degradado" é um
                   diagnóstico sem conduta. Costuma apontar para um modelo que
                   não baixou ou uma dependência ausente. */
                <LinhaDeAjuste
                  titulo="Por que caiu"
                  descricao={
                    <>
                      Pedido <span className="font-mono text-text">{avisoDeModo.solicitado}</span>,
                      subiu <span className="font-mono text-text">{avisoDeModo.efetivo}</span>.{" "}
                      {avisoDeModo.motivo}
                    </>
                  }
                />
              )}
            </Secao>
          </div>
        </div>

        <Dialogo
          aberto={confirmandoEsvaziar}
          aoFechar={() => setConfirmandoEsvaziar(false)}
          titulo="Esvaziar o cofre"
          acoes={
            <>
              <Botao tipo="secundario" onClick={() => setConfirmandoEsvaziar(false)}>
                Cancelar
              </Botao>
              <Botao
                tipo="perigo"
                onClick={() => {
                  aoEsvaziarCofre();
                  setConfirmandoEsvaziar(false);
                }}
              >
                Esvaziar
              </Botao>
            </>
          }
        >
          <p>
            Os {itensNoCofre} documentos guardados são apagados do disco e não poderão ser
            reabertos. Os arquivos que você já salvou não são afetados.
          </p>
        </Dialogo>
      </div>
    </div>
  );
}
