import { ALL_ENTITIES, corDaEntidade } from "../types";
import type { EntityType } from "../types";
import { Botao } from "../ui";

/**
 * Os 14 tipos de dado, para marcar quais serão mascarados.
 *
 * Vivia dentro da receita da Mesa, como painel de um popover. Agora também
 * mora nos Ajustes, onde os padrões ficam à vista sem abrir nada — e um
 * componente só garante que os dois lugares mostrem os mesmos 14 nomes, nas
 * mesmas cores, com o mesmo gesto.
 *
 * Cada tipo é um `role="checkbox"`. A cor é canal secundário: o ponto colorido
 * ajuda a reconhecer, mas o nome está sempre escrito — 14 cores é mais do que
 * a visão distingue com folga, e quem não vê cor não recebe nenhuma delas.
 */
interface GradeDeEntidadesProps {
  selecionadas: EntityType[];
  aoMudar: (entidades: EntityType[]) => void;
  colunas?: 2 | 3;
}

export function GradeDeEntidades({
  selecionadas,
  aoMudar,
  colunas = 2,
}: GradeDeEntidadesProps) {
  const todas = selecionadas.length === ALL_ENTITIES.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-text-tertiary">
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

      <div className={["grid gap-1", colunas === 3 ? "grid-cols-3" : "grid-cols-2"].join(" ")}>
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
                "flex min-h-7 items-center gap-2 rounded-md px-2 py-1 text-left",
                "font-mono text-xs transition-colors duration-[120ms]",
                ativa ? "text-text" : "text-text-tertiary hover:bg-surface-hover",
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
                style={{ backgroundColor: ativa ? cor : "var(--pauta-forte)" }}
              />
              {entidade.label}
            </button>
          );
        })}
      </div>

      {selecionadas.length === 0 && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Sem nenhum tipo escolhido não há o que mascarar.
        </p>
      )}
    </div>
  );
}
