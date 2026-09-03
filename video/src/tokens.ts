/**
 * As cores e as fontes do aplicativo, copiadas de `src/styles/tokens.css`.
 *
 * É uma cópia, e a cópia é deliberada: o vídeo não compila o CSS do produto e
 * não deve arrastar o Tailwind para cá só para ler quatro hexadecimais. O
 * custo dessa escolha é conhecido — se a paleta do aplicativo mudar, este
 * arquivo envelhece em silêncio. Por isso ele guarda só o tema claro e só as
 * cores que o vídeo realmente usa.
 */

/** Tema "papel": sulfite de cast frio, tinta preta, caneta azul. */
export const cor = {
  papel: "#f2f1ec",
  papelFundo: "#e8e6df",
  folha: "#fbfaf8",
  pauta: "#d8d5cb",
  pautaForte: "#b9b5a8",

  toner: "#16181d",
  toner2: "#4c505a",
  toner3: "#666b75",

  esferografica: "#1b3fd1",
  carimbo: "#b3322a",
  deferido: "#1f6b47",
} as const;

/**
 * Cores de entidade. No aplicativo elas são declaradas à mão no `:root`
 * porque o Tailwind faz tree-shaking do que só é alcançado por `var()` montado
 * em runtime — aqui o motivo não se aplica, mas os valores são os mesmos.
 */
export const corEntidade = {
  pessoa: "#63450c",
  cpf: "#991517",
  local: "#115978",
  processo: "#3f4a7a",
  oab: "#0f5c4a",
} as const;

/**
 * A regra das duas vozes, que é o coração do design system: mono é o que a
 * **máquina** diz — rótulo, número, estado; serifa é o que se **lê** — o texto
 * do processo. Num vídeo sobre um revisor de tarjas, confundir os dois seria
 * repetir na tela o erro que o produto existe para evitar.
 */
export const fonte = {
  mono: '"Azeret Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
  serifa: '"Petrona", Georgia, "Times New Roman", serif',
} as const;

export const FPS = 30;
