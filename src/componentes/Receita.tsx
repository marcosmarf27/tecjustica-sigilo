import { forwardRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../estado/AppEstado";
import { ALL_ENTITIES, POLITICAS_MASCARA, corDaEntidade } from "../types";
import type { EntityType } from "../types";
import { Popover, Botao, Icone } from "../ui";

/**
 * A receita — a configuração escrita como uma frase.
 *
 * ## O problema que ela resolve
 *
 * Para anonimizar um arquivo era preciso percorrer três blocos empilhados: 14
 * chips de entidade, 3 cartões de política e, depois do processamento, a
 * escolha de formato lá dentro da revisão. Uns 17 controles, **toda vez** —
 * porque nenhuma preferência sobrevivia ao fechamento.
 *
 * Aqui a mesma configuração vira uma frase que se lê de uma vez:
 *
 *     Mascarar as 14 entidades com marcador, salvar em .md
 *     na pasta do original.
 *
 * Cada trecho sublinhado abre um popover, e o valor escolhido volta para a
 * frase. Quem aceita os padrões não toca em nada: soltar o arquivo e clicar em
 * Anonimizar são as duas ações do caminho normal.
 *
 * A frase é escrita como descrição do que **vai acontecer**, não como rótulo de
 * campo. "Salvar em .md" diz o resultado; "Formato de saída:" faria a pessoa
 * traduzir mentalmente rótulo em consequência.
 */

/** Trecho acionável: parece texto sublinhado, comporta-se como botão. */
const Trecho = forwardRef<
  HTMLButtonElement,
  { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Trecho({ children, ...resto }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={[
        "mx-0.5 rounded-sm font-mono text-sm font-medium text-accent",
        "underline decoration-accent/40 decoration-2 underline-offset-4",
        "transition-colors duration-[120ms] hover:decoration-accent",
      ].join(" ")}
      {...resto}
    >
      {children}
    </button>
  );
});

/** Painel de entidades — a lógica de seleção do antigo `EntityConfig`. */
function PainelEntidades({
  selecionadas,
  aoMudar,
}: {
  selecionadas: EntityType[];
  aoMudar: (e: EntityType[]) => void;
}) {
  const todas = selecionadas.length === ALL_ENTITIES.length;

  return (
    <div className="w-[320px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-2xs tracking-wide text-text-tertiary uppercase">
          {selecionadas.length} de {ALL_ENTITIES.length}
        </span>
        <Botao
          tamanho="mini"
          tipo="discreto"
          onClick={() => aoMudar(todas ? [] : ALL_ENTITIES.map((e) => e.id))}
        >
          {todas ? "Nenhuma" : "Todas"}
        </Botao>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {ALL_ENTITIES.map((entidade) => {
          const ativa = selecionadas.includes(entidade.id);
          const cor = corDaEntidade(entidade.id);
          return (
            <button
              key={entidade.id}
              type="button"
              role="checkbox"
              aria-checked={ativa}
              onClick={() =>
                aoMudar(
                  ativa
                    ? selecionadas.filter((e) => e !== entidade.id)
                    : [...selecionadas, entidade.id]
                )
              }
              className={[
                "flex min-h-6 items-center gap-2 rounded px-2 py-1.5 text-left",
                "font-mono text-2xs transition-colors duration-[120ms]",
                ativa
                  ? "text-text"
                  : "text-text-tertiary hover:bg-surface-hover",
              ].join(" ")}
              style={
                ativa
                  ? { backgroundColor: `color-mix(in srgb, ${cor} 10%, transparent)` }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: ativa ? cor : "var(--pauta-forte)",
                }}
              />
              {entidade.label}
            </button>
          );
        })}
      </div>

      {selecionadas.length === 0 && (
        <p role="alert" className="mt-2 text-2xs text-danger">
          Sem nenhum tipo escolhido não há o que mascarar.
        </p>
      )}
    </div>
  );
}

export function Receita() {
  const { prefs, definirPref } = useApp();

  const politica = POLITICAS_MASCARA.find((p) => p.id === prefs.politica);
  const qtdEntidades = prefs.entidades.length;
  const rotuloEntidades =
    qtdEntidades === ALL_ENTITIES.length
      ? `as ${ALL_ENTITIES.length} entidades`
      : qtdEntidades === 1
        ? "1 tipo de dado"
        : `${qtdEntidades} tipos de dado`;

  const escolherPasta = async () => {
    if (!window.electronAPI?.selectDirectory) return;
    const pasta = await window.electronAPI.selectDirectory();
    /* `null` é cancelamento, e cancelar tem de manter o que estava. Tratar
       como "voltar ao padrão" perderia a escolha de quem só abriu o diálogo
       por engano. */
    if (pasta) definirPref("pastaDeSaida", pasta);
  };

  const nomeCurtoDaPasta = (caminho: string) => {
    const sep = caminho.includes("\\") ? "\\" : "/";
    return caminho.split(sep).filter(Boolean).pop() ?? caminho;
  };

  return (
    /* `<div>`, não `<p>`, apesar de ser prosa: os popovers desta frase abrem
       painéis com `<div>` e `<p>` dentro, e HTML não permite conteúdo de bloco
       dentro de parágrafo. O navegador "conserta" fechando o `<p>` sozinho no
       meio da frase, o que quebra a hidratação do React e embaralha o layout.
       Serifa e entrelinha de leitura vêm das classes. */
    <div className="text-base leading-loose text-text">
      Mascarar{" "}
      <Popover
        rotulo="Tipos de dado a mascarar"
        gatilho={(p) => <Trecho {...p}>{rotuloEntidades}</Trecho>}
      >
        <PainelEntidades
          selecionadas={prefs.entidades}
          aoMudar={(e) => definirPref("entidades", e)}
        />
      </Popover>{" "}
      com{" "}
      <Popover
        rotulo="Como substituir o dado encontrado"
        gatilho={(p) => (
          <Trecho {...p}>{politica?.titulo.toLowerCase() ?? prefs.politica}</Trecho>
        )}
      >
        <div className="w-[300px] space-y-1">
          {POLITICAS_MASCARA.map((opcao) => {
            const ativa = opcao.id === prefs.politica;
            return (
              <button
                key={opcao.id}
                type="button"
                role="radio"
                aria-checked={ativa}
                onClick={() => definirPref("politica", opcao.id)}
                className={[
                  "w-full rounded-md border p-2.5 text-left transition-colors duration-[120ms]",
                  ativa
                    ? "border-accent bg-accent-muted"
                    : "border-transparent hover:bg-surface-hover",
                ].join(" ")}
              >
                <span className="font-mono text-2xs font-semibold tracking-wide text-text uppercase">
                  {opcao.titulo}
                </span>
                {/* O exemplo concreto é o que faz a escolha ser informada: a
                    diferença entre as três é a diferença entre um documento que
                    pode circular e um que ainda permite reidentificar alguém. */}
                <code className="mt-1 block rounded bg-surface-sunken px-1.5 py-1 font-mono text-2xs text-text-secondary">
                  {opcao.exemplo}
                </code>
                <span className="mt-1 block text-2xs leading-normal text-text-tertiary">
                  {opcao.descricao}
                </span>
              </button>
            );
          })}
        </div>
      </Popover>
      , salvar em{" "}
      <Popover
        rotulo="Formato do arquivo salvo"
        gatilho={(p) => <Trecho {...p}>.{prefs.formato}</Trecho>}
      >
        <div className="w-[280px] space-y-1">
          {(
            [
              { id: "md", titulo: ".md", desc: "Markdown — abre em qualquer editor de texto" },
              { id: "docx", titulo: ".docx", desc: "Word, LibreOffice ou Google Docs" },
            ] as const
          ).map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              role="radio"
              aria-checked={prefs.formato === opcao.id}
              onClick={() => definirPref("formato", opcao.id)}
              className={[
                "w-full rounded-md border p-2.5 text-left transition-colors duration-[120ms]",
                prefs.formato === opcao.id
                  ? "border-accent bg-accent-muted"
                  : "border-transparent hover:bg-surface-hover",
              ].join(" ")}
            >
              <span className="font-mono text-2xs font-semibold text-text">
                {opcao.titulo}
              </span>
              <span className="mt-0.5 block text-2xs text-text-tertiary">
                {opcao.desc}
              </span>
            </button>
          ))}
          <p className="pt-1 text-2xs leading-normal text-text-tertiary">
            A saída é sempre texto, nunca o formato de entrada — um PDF
            anonimizado sai como documento de texto.
          </p>
        </div>
      </Popover>{" "}
      <Popover
        rotulo="Onde salvar"
        alinhamento="fim"
        gatilho={(p) => (
          <Trecho {...p}>
            {prefs.pastaDeSaida
              ? `em ${nomeCurtoDaPasta(prefs.pastaDeSaida)}`
              : "na pasta do original"}
          </Trecho>
        )}
      >
        <div className="w-[320px] space-y-2">
          <p className="text-xs leading-normal text-text-secondary">
            {prefs.pastaDeSaida ? (
              <>
                Salvando em{" "}
                <code className="font-mono text-2xs break-all text-text">
                  {prefs.pastaDeSaida}
                </code>
              </>
            ) : (
              "Cada arquivo é salvo ao lado do original, com o nome acrescido do formato escolhido."
            )}
          </p>

          <div className="flex gap-2">
            <Botao
              tamanho="mini"
              icone="pasta"
              onClick={escolherPasta}
              disabled={!window.electronAPI?.selectDirectory}
              title={
                window.electronAPI?.selectDirectory
                  ? undefined
                  : "Só disponível no aplicativo instalado"
              }
            >
              Escolher pasta
            </Botao>
            {prefs.pastaDeSaida && (
              <Botao
                tamanho="mini"
                tipo="discreto"
                onClick={() => definirPref("pastaDeSaida", null)}
              >
                Ao lado do original
              </Botao>
            )}
          </div>
        </div>
      </Popover>
      .
      {qtdEntidades === 0 && (
        <span className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <Icone nome="alerta" tamanho={13} />
          Escolha ao menos um tipo de dado.
        </span>
      )}
    </div>
  );
}
