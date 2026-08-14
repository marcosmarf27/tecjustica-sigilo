# Design system — Presidio Anon

Referência única de estilo do aplicativo. Os valores vivem em
`src/styles/tokens.css`; este documento explica **por que** cada escolha existe,
para que uma tela nova nasça coerente sem precisar adivinhar.

## Direção: tinta de cartório

O produto vive dentro do vocabulário do processo judicial brasileiro, e é de lá
que vem a identidade — não do cinza-ardósia com acento índigo que qualquer
aplicativo usa hoje.

| Escolha | Motivo |
|---|---|
| **Violeta-anilina** como cor de ação | É a tinta do carimbo de cartório. Quem lida com autos reconhece na hora; um índigo genérico não diz nada sobre o domínio. |
| **Grafite quente** no fundo, não azulado | O azul-ardósia é o default de interface. O grafite levemente terroso lembra papel impresso sob luz fraca e deixa o violeta brilhar sem competir. |
| **Tarja de redação** como elemento de assinatura | O retângulo sólido sobre o dado sigiloso é o gesto que define o produto. É o único lugar onde a interface se permite ser enfática. |
| **IBM Plex Sans + Mono** | Seriedade institucional sem parecer software genérico. A mono é irmã da sans, então o texto do documento e a interface ficam visivelmente da mesma casa. |

### Fontes auto-hospedadas — requisito, não preferência

As fontes vêm de `@fontsource/*` e são empacotadas no build. Um `@import` do
Google Fonts faria o aplicativo telefonar para fora a cada abertura,
contradizendo a promessa de operação 100% local — e, em máquina de vara sem
internet, a identidade visual cairia silenciosamente para `system-ui`.

## Cor

### Superfícies e texto

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#17151a` | Fundo da janela |
| `--color-surface` | `#201d24` | Cartões, barras |
| `--color-surface-raised` | `#2a262f` | Painel lateral, chips |
| `--color-surface-hover` | `#34303a` | Estado de passagem |
| `--color-border` | `#413c48` | Borda visível |
| `--color-border-subtle` | `#2e2a34` | Divisória |
| `--color-text` | `#f2eff5` | Corpo |
| `--color-text-secondary` | `#b9b2c2` | Apoio |
| `--color-text-tertiary` | `#918a9b` | Metadado |

`--color-text-secondary` e `--color-text-tertiary` foram clareados em relação à
paleta anterior (`#8892a8` e `#5c6478`). O motivo é objetivo: o terciário
antigo tinha **3,23:1** de contraste e reprovava em WCAG AA, apesar de ser
usado na maior parte do texto de apoio, em tamanhos de 11 a 13px.

### Ação

| Token | Valor |
|---|---|
| `--color-accent` | `#a680ff` |
| `--color-accent-hover` | `#bda0ff` |
| `--color-accent-strong` | `#6d3aa8` |
| `--color-on-accent` | `#14101c` |

Texto sobre a cor de ação usa `--color-on-accent` (escuro), não branco: branco
sobre o violeta claro reprovaria em contraste.

### Entidades

Uma cor por tipo de PII, todas legíveis sobre `--color-surface-raised`. Antes
essas cores viviam soltas em `src/types/index.ts`, fora do sistema, com
fallbacks divergentes entre componentes.

`person` · `cpf` · `cnpj` · `rg` · `phone` · `email` · `address` · `cep` ·
`location` · `oab` · `birthdate` · `nit` · `process` · `bank`

## Tipografia

| Token | Tamanho | Uso |
|---|---|---|
| `--text-2xs` | 11px | Metadado, contagem |
| `--text-xs` | 12px | Rótulo, chip |
| `--text-sm` | 13px | Corpo da interface |
| `--text-base` | 15px | Corpo do documento |
| `--text-lg` | 18px | Título de seção |
| `--text-xl` | 24px | Título de tela |
| `--text-2xl` | 32px | Número de destaque |

Altura de linha: `--leading-tight` (1.25) para títulos, `--leading-normal`
(1.5) para interface, `--leading-document` (1.75) para o texto do processo —
que é lido com atenção e merece respiro.

Antes disso a interface usava valores avulsos (`text-[10px]` a `text-[15px]`)
sem regra nenhuma.

## Espaçamento e forma

Espaçamento: `--space-1` (4px) a `--space-7` (48px).
Raio: `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px),
`--radius-full`.
Sombra: `--shadow-sm`, `--shadow-md`, `--shadow-lg`.

## Componentes de assinatura

### `.tarja`

O trecho mascarado aparece como retângulo sólido na cor do tipo de entidade.
Passar o cursor ou focar pelo teclado revela o valor original por baixo — é o
que permite conferir se a anonimização acertou, que é a tarefa central de quem
responde pelo sigilo do documento.

```html
<span class="tarja" style="--cor-entidade: var(--color-entity-cpf)">123.456.789-09</span>
```

### `.marcacao`

Alternativa leve, para quando o objetivo é localizar sem esconder: fundo
translúcido e sublinhado na cor do tipo. `data-ativa="true"` destaca a
ocorrência sob foco na navegação pela lista.

## Acessibilidade — piso obrigatório

Não é polimento; é o piso que qualquer tela precisa respeitar.

- **Foco visível** em tudo que é focável (`:focus-visible` global com anel na
  cor de ação). O projeto não tinha nenhum estilo de foco.
- **Contraste AA**: 4,5:1 para texto, 3:1 para elementos de interface.
- **Alvos de no mínimo 24px** (WCAG 2.2, 2.5.8).
- **Estado anunciado**: `aria-pressed` em alternadores, `role="progressbar"` com
  `aria-valuenow` no progresso, `aria-live` em avisos.
- **Operável por teclado**: nada pode depender de passar o mouse. Um controle
  que só aparece no hover é inalcançável por teclado.
- **`prefers-reduced-motion`** respeitado globalmente.

## Escrita

O texto da interface é design, não decoração.

- **Nomeie pelo que a pessoa controla**, não pela implementação. "O motor de
  anonimização não respondeu", não "Erro ao conectar na porta 8123".
- **Voz ativa e verbo do que acontece.** O botão diz "Salvar"; o aviso que
  aparece depois diz "Salvo em...". Mesma palavra do começo ao fim do fluxo.
- **Erro explica o que fazer.** Sem pedido de desculpas, sem vaguidão. Um erro
  sem saída — como a tela que só dizia "verifique se o servidor está rodando" —
  é um beco para quem não é desenvolvedor.
- **Sem inglês solto.** "Baixar cópia", não "Download".
- **Sem prometer o que não se cumpre.** Se a máscara é parcial, a interface não
  diz que o dado foi removido.
