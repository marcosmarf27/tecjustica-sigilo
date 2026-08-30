import { ALL_ENTITIES, corDaEntidade, type EntityType } from "../types";

interface EntityConfigProps {
  selected: EntityType[];
  onChange: (entities: EntityType[]) => void;
}

export function EntityConfig({ selected, onChange }: EntityConfigProps) {
  const toggleEntity = (id: EntityType) => {
    if (selected.includes(id)) {
      onChange(selected.filter((e) => e !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const allSelected = selected.length === ALL_ENTITIES.length;

  return (
    <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Entidades</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Selecione o que anonimizar
          </p>
        </div>
        <button
          onClick={() =>
            onChange(allSelected ? [] : ALL_ENTITIES.map((e) => e.id))
          }
          className="rounded-md px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/10"
        >
          {allSelected ? "Nenhuma" : "Todas"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {ALL_ENTITIES.map((entity) => {
          const isSelected = selected.includes(entity.id);
          /* `var(--color-entity-*)`, que responde ao tema. Os hex cravados que
             estavam aqui traziam a opacidade concatenada no próprio literal
             (`${entity.color}12`) — truque que só funciona com hex, e por isso
             prendia a cor ao TypeScript. Com `var()`, a mistura é `color-mix`. */
          const cor = corDaEntidade(entity.id);
          return (
            <button
              key={entity.id}
              onClick={() => toggleEntity(entity.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all duration-150 ${
                isSelected
                  ? "border-transparent text-text"
                  : "border-border-subtle bg-transparent text-text-tertiary hover:border-border hover:text-text-secondary"
              }`}
              style={
                isSelected
                  ? {
                      backgroundColor: `color-mix(in srgb, ${cor} 7%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${cor} 19%, transparent)`,
                    }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full transition-all"
                style={{
                  backgroundColor: isSelected ? cor : "var(--pauta-forte)",
                  boxShadow: isSelected
                    ? `0 0 6px color-mix(in srgb, ${cor} 25%, transparent)`
                    : "none",
                }}
              />
              {entity.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
