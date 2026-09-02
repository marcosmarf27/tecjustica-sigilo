import { forwardRef } from "react";
import type { ReactNode } from "react";
import { useApp } from "../estado/AppEstado";
import { ALL_ENTITIES, POLITICAS_MASCARA } from "../types";
import { Popover, Botao, Icone } from "../ui";
import { GradeDeEntidades } from "./GradeDeEntidades";
import { EscolhaDePolitica } from "./EscolhaDePolitica";

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
        <div className="w-[320px]">
          <GradeDeEntidades
            selecionadas={prefs.entidades}
            aoMudar={(e) => definirPref("entidades", e)}
          />
        </div>
      </Popover>{" "}
      com{" "}
      <Popover
        rotulo="Como substituir o dado encontrado"
        gatilho={(p) => (
          <Trecho {...p}>{politica?.titulo.toLowerCase() ?? prefs.politica}</Trecho>
        )}
      >
        <div className="w-[300px]">
          <EscolhaDePolitica
            valor={prefs.politica}
            aoMudar={(p) => definirPref("politica", p)}
          />
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
