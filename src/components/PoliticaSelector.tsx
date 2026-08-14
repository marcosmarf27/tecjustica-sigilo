import type { PoliticaMascara } from "../types";
import { POLITICAS_MASCARA } from "../types";

interface PoliticaSelectorProps {
  valor: PoliticaMascara;
  onChange: (politica: PoliticaMascara) => void;
}

/**
 * Escolha de como o dado detectado é substituído.
 *
 * Vale a tela que ocupa: a diferença entre as três opções é a diferença entre
 * um documento que pode circular e um que ainda permite reidentificar alguém.
 * Por isso cada opção mostra o resultado concreto, não só o nome.
 */
export function PoliticaSelector({ valor, onChange }: PoliticaSelectorProps) {
  return (
    <fieldset className="animate-fade-in border-0 p-0 m-0">
      <legend className="mb-1 text-base font-semibold text-text">
        Como substituir
      </legend>
      <p className="mb-3 text-xs text-text-tertiary">
        O que aparece no lugar de cada dado encontrado
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {POLITICAS_MASCARA.map((opcao) => {
          const ativa = valor === opcao.id;
          return (
            <button
              key={opcao.id}
              type="button"
              onClick={() => onChange(opcao.id)}
              aria-pressed={ativa}
              className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition ${
                ativa
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface-raised/50 hover:border-text-tertiary hover:bg-surface-raised"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    ativa ? "border-accent" : "border-border"
                  }`}
                >
                  {ativa && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    ativa ? "text-accent" : "text-text"
                  }`}
                >
                  {opcao.titulo}
                </span>
              </span>

              <code className="rounded bg-bg/60 px-1.5 py-1 font-mono text-2xs text-text-secondary">
                {opcao.exemplo}
              </code>

              <span className="text-2xs leading-normal text-text-tertiary">
                {opcao.descricao}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
