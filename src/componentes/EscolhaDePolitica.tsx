import { POLITICAS_MASCARA } from "../types";
import type { PoliticaMascara } from "../types";

/**
 * As três formas de substituir o dado encontrado.
 *
 * O exemplo concreto é o que torna a escolha informada: a diferença entre
 * `[PESSOA_1]`, `J**** d* S****` e `*************` é a diferença entre um
 * documento que pode circular e um que ainda permite reidentificar alguém.
 * Sem o exemplo, os três títulos parecem sinônimos.
 *
 * Compartilhado entre a receita da Mesa (popover, empilhado) e os Ajustes
 * (lado a lado), para que a mesma escolha tenha a mesma cara nos dois.
 */
interface EscolhaDePoliticaProps {
  valor: PoliticaMascara;
  aoMudar: (politica: PoliticaMascara) => void;
  horizontal?: boolean;
}

export function EscolhaDePolitica({
  valor,
  aoMudar,
  horizontal = false,
}: EscolhaDePoliticaProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Como substituir o dado encontrado"
      className={horizontal ? "grid grid-cols-3 gap-2" : "space-y-1"}
    >
      {POLITICAS_MASCARA.map((opcao) => {
        const ativa = opcao.id === valor;
        return (
          <button
            key={opcao.id}
            type="button"
            role="radio"
            aria-checked={ativa}
            onClick={() => aoMudar(opcao.id)}
            className={[
              "w-full rounded-lg border p-3 text-left transition-colors duration-[120ms]",
              ativa
                ? "border-accent bg-accent-muted"
                : "border-border-subtle hover:bg-surface-hover",
            ].join(" ")}
          >
            <span className="font-mono text-xs font-semibold text-text">{opcao.titulo}</span>
            <code className="mt-1.5 block truncate rounded bg-surface-sunken px-1.5 py-1 font-mono text-2xs text-text-secondary">
              {opcao.exemplo}
            </code>
            <span className="mt-1.5 block text-xs leading-normal text-text-tertiary">
              {opcao.descricao}
            </span>
          </button>
        );
      })}
    </div>
  );
}
