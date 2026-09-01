import { useApp } from "../estado/AppEstado";
import { useState } from "react";
import { Cartao, GrupoSegmentado, Botao, Selo, Dialogo } from "../ui";
import type { Tema } from "../hooks/usePreferencias";
import type { AvisoDeModo } from "../hooks/usePythonBackend";
import { PainelDenyList } from "../componentes/PainelDenyList";
import { PainelNuvem } from "../componentes/PainelNuvem";

/**
 * Ajustes — os padrões que a Mesa usa, o tema, o cofre e o motor.
 *
 * Nesta fase entram o alternador de tema e os padrões de saída. O cofre (com
 * expurgo, apagar e "esvaziar") chega na fase 4, junto com a deny-list ganhando
 * busca e remoção de termo — hoje só dá para **adicionar** termo, pela tela de
 * revisão, sem nenhuma forma de tirar.
 */

const TEMAS: { valor: Tema; rotulo: string; descricao: string }[] = [
  { valor: "papel", rotulo: "Papel", descricao: "Sempre claro" },
  { valor: "noite", rotulo: "Noite", descricao: "Sempre escuro" },
  { valor: "sistema", rotulo: "Sistema", descricao: "Seguir o sistema operacional" },
];

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
  const degradado = avisoDeModo !== null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 px-8 py-8">
        <h1 className="font-mono text-xl font-semibold tracking-tight text-text">
          Ajustes
        </h1>

        <Cartao
          titulo="Aparência"
          descricao="O tema escolhido vale para as próximas aberturas."
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text">Tema</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                “Sistema” acompanha a configuração do Windows.
              </p>
            </div>
            <GrupoSegmentado
              rotulo="Tema da interface"
              opcoes={TEMAS.map((t) => ({
                valor: t.valor,
                rotulo: t.rotulo,
                descricao: t.descricao,
              }))}
              valor={prefs.tema}
              onChange={(tema) => definirPref("tema", tema)}
            />
          </div>
        </Cartao>

        <Cartao
          titulo="Padrões de saída"
          descricao="O que a Mesa usa quando você não muda nada."
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text">Formato do arquivo salvo</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                A saída é sempre texto — nunca o formato de entrada.
              </p>
            </div>
            <GrupoSegmentado
              rotulo="Formato de saída"
              opcoes={[
                { valor: "md" as const, rotulo: "MD", descricao: "Markdown — abre em qualquer editor" },
                { valor: "docx" as const, rotulo: "DOCX", descricao: "Word, LibreOffice ou Google Docs" },
              ]}
              valor={prefs.formato}
              onChange={(formato) => definirPref("formato", formato)}
            />
          </div>
        </Cartao>

        <PainelNuvem />

        <Cartao titulo="Motor de anonimização">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text">
                {modoNlp === "transformer"
                  ? "BERT jurídico"
                  : modoNlp === "spacy"
                    ? "spaCy rápido"
                    : "Indeterminado"}
              </p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {modoNlp === "transformer"
                  ? "Modelo treinado em jurisprudência brasileira (LeNER-Br)."
                  : "Modelo leve: encontra menos nomes e locais."}
              </p>
            </div>
            <Selo tom={degradado ? "atencao" : "deferido"} comPonto>
              {degradado ? "Degradado" : "Normal"}
            </Selo>
          </div>

          {avisoDeModo && (
            /* O motivo é a parte acionável: sem ele, "degradado" é um diagnóstico
               sem conduta. Costuma apontar para um modelo que não baixou ou uma
               dependência ausente — coisas que a pessoa pode resolver. */
            <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-text-secondary">
              Pedido <span className="font-mono">{avisoDeModo.solicitado}</span>,
              subiu <span className="font-mono">{avisoDeModo.efetivo}</span>.{" "}
              {avisoDeModo.motivo}
            </p>
          )}
        </Cartao>

        <Cartao
          titulo="Cofre"
          descricao="Guardar documentos cifrados para reabrir a revisão depois."
        >
          {cofreDisponivel === false ? (
            <p className="text-sm text-text-secondary">
              O sistema não oferece cifragem para esta conta. O cofre{" "}
              <strong className="text-text">recusa gravar</strong> nessa
              situação, em vez de gravar em claro — então ele fica indisponível
              aqui.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-text">Guardar documentos</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    Texto original, ocorrências e texto anonimizado, cifrados
                    com a proteção de dados do Windows.
                  </p>
                </div>
                <GrupoSegmentado
                  rotulo="Cofre ligado"
                  opcoes={[
                    { valor: "sim" as const, rotulo: "Ligado", descricao: "Guarda cada documento anonimizado" },
                    { valor: "nao" as const, rotulo: "Desligado", descricao: "Nada é gravado em disco" },
                  ]}
                  valor={prefs.cofreLigado ? "sim" : "nao"}
                  onChange={(v) => {
                    definirPref("cofreLigado", v === "sim");
                    definirPref("cofrePerguntado", true);
                  }}
                />
              </div>

              {/* O limite honesto, também aqui e não só no consentimento: quem
                  chega pelos Ajustes nunca viu aquele diálogo. */}
              <p className="border-l-2 border-warning pl-3 text-xs leading-normal text-text-secondary">
                A cifragem protege contra outro usuário desta máquina e contra a
                leitura do disco fora do sistema. Não protege contra um programa
                malicioso rodando com a sua própria conta.
              </p>

              <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                <div>
                  <p className="text-sm text-text">Apagar sozinho depois de</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    O valor de reabrir cai rápido; o risco de manter dado
                    pessoal no disco, não.
                  </p>
                </div>
                <GrupoSegmentado
                  rotulo="Prazo de guarda"
                  opcoes={[
                    { valor: "7" as const, rotulo: "7 d", descricao: "Uma semana" },
                    { valor: "30" as const, rotulo: "30 d", descricao: "Um mês" },
                    { valor: "90" as const, rotulo: "90 d", descricao: "Um trimestre" },
                    { valor: "0" as const, rotulo: "Nunca", descricao: "Só apagando à mão" },
                  ]}
                  valor={String(prefs.diasDeExpurgo) as "7" | "30" | "90" | "0"}
                  onChange={(v) => definirPref("diasDeExpurgo", Number(v))}
                />
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                <div>
                  <p className="text-sm text-text">Arquivar por processo</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    Usa o número CNJ que o detector encontrou. Sem número, vai
                    para “Avulsos”.
                  </p>
                </div>
                <GrupoSegmentado
                  rotulo="Auto-arquivamento"
                  opcoes={[
                    { valor: "sim" as const, rotulo: "Ligado", descricao: "Agrupa por número de processo" },
                    { valor: "nao" as const, rotulo: "Desligado", descricao: "Tudo em Avulsos" },
                  ]}
                  valor={prefs.autoArquivamento ? "sim" : "nao"}
                  onChange={(v) => definirPref("autoArquivamento", v === "sim")}
                />
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                <p className="font-mono text-2xs tracking-wide text-text-tertiary uppercase">
                  {itensNoCofre} documento{itensNoCofre === 1 ? "" : "s"} guardado
                  {itensNoCofre === 1 ? "" : "s"}
                </p>
                <Botao
                  tipo="perigo"
                  tamanho="mini"
                  icone="lixeira"
                  disabled={itensNoCofre === 0}
                  onClick={() => setConfirmandoEsvaziar(true)}
                >
                  Esvaziar o cofre
                </Botao>
              </div>
            </div>
          )}
        </Cartao>

        <PainelDenyList
          buscar={buscarDenyList}
          gravar={gravarDenyList}
          avisar={avisar}
        />

        <div className="flex justify-end">
          <Botao tipo="discreto" onClick={restaurarPreferencias}>
            Restaurar padrões
          </Botao>
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
            Os {itensNoCofre} documentos guardados são apagados do disco e não
            poderão ser reabertos. Os arquivos que você já salvou não são
            afetados.
          </p>
        </Dialogo>
      </div>
    </div>
  );
}
