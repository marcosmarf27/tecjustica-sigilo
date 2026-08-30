# Design system — papel de processo

A interface se comporta como a mesa em que autos judiciais são lidos: sulfite
claro, tinta preta, caneta azul para o que é ação, carimbo vermelho para o que é
grave.

Tudo o que é valor vive em [`src/styles/tokens.css`](../src/styles/tokens.css).
Este documento explica as decisões; o arquivo é a fonte da verdade.

---

## A regra das duas vozes

**Mono é o que a máquina diz.** Rótulo, botão, número, estado, código, CLI.
**Serifa é o que se lê.** O texto do processo e a prosa do próprio aplicativo.

Não há sans no sistema, de propósito.

Num revisor de tarjas, confundir o texto do aplicativo com o texto do documento
é o erro mais caro que existe — é a diferença entre conferir uma anonimização e
conferir uma legenda. A distinção de fonte torna isso impossível de relance, sem
depender de cor nem de borda.

| Papel | Fonte | Por quê |
|---|---|---|
| Leitura | **Petrona Variable** | Serifa da Omnibus-Type, fundição latino-americana, desenhada para texto em português |
| Máquina | **Azeret Mono Variable** | Mono quadrada que aguenta caixa-alta com entreletra em 12px; o documento que o app lê é datilografado — a mono é o material |

Auto-hospedadas via `@fontsource-variable`, e isso é requisito e não preferência:
um `@import` do Google Fonts faria o aplicativo telefonar para fora a cada
abertura, e numa máquina de vara sem internet a identidade cairia em silêncio
para `system-ui`. São fontes variáveis — um arquivo por família cobre o
intervalo de peso inteiro.

### Escala

| Token | | Uso |
|---|---|---|
| `--text-2xs` | 11px | numeral em tabela densa |
| `--text-xs` | 12px | metadado, rótulo de campo |
| `--text-sm` | 14px | corpo da interface |
| `--text-base` | 16px | **texto do documento**, entrelinha 1,75 |
| `--text-lg` | 18px | título de seção |
| `--text-xl` | 24px | título de tela |

O piso subiu em relação à versão anterior: o corpo era 13px e o texto do
documento 15px, ambos abaixo do confortável para ler páginas de autos.

---

## Duas camadas de token

As **primitivas** (`--papel`, `--folha`, `--toner`, `--esferografica`…) carregam
os valores e são a única coisa que a troca de tema mexe. Os **semânticos**
(`--color-*`) apenas apontam para elas, e existem porque é deles que o Tailwind
gera as utilities (`bg-surface`, `text-text`…).

O bloco é `@theme inline`, **não** `@theme`, e a diferença decide se o alternador
de tema funciona: com `@theme`, a utility referenciaria `var(--color-surface)` e
o valor poderia ser resolvido em build, congelando o tema em que o CSS foi
compilado. Com `inline`, a utility emite a referência à primitiva, e redefinir
`--folha` repinta a interface na hora.

**Regra que decorre disso: toda cor tem seu valor no `:root`.** Nenhuma cor pode
ter sua única definição dentro de um `@media` ou de um `[data-tema]` — esses
blocos só redefinem o que já existe. Um token que só nasce no modo escuro fica
indefinido para quem está no claro, e o navegador não avisa: a cor não pinta.

### Paleta papel (padrão)

```css
--papel:            #F2F1EC;  /* fundo — sulfite de cast frio */
--papel-fundo:      #E8E6DF;  /* área rebaixada, trilho */
--folha:            #FBFAF8;  /* cartão — MAIS claro que o fundo */
--pauta:            #D8D5CB;  /* fio de divisão */
--toner:            #16181D;  /* texto e preenchimento da tarja */
--toner-3:          #666B75;  /* metadado */
--esferografica:    #1B3FD1;  /* ação */
--carimbo:          #B3322A;  /* vazamento e perigo */
```

`--folha` é **mais clara** que `--papel`, ao contrário do que sistemas escuros
costumam fazer: uma folha apoiada numa mesa recebe mais luz que a mesa. Inverter
faz o cartão parecer um buraco em vez de um objeto pousado.

**Contraste medido, não estimado:**

| Par | Razão | |
|---|---|---|
| `--toner-3` sobre `--papel` | 4,73:1 | ✓ |
| `#6B707B` (o valor que parece óbvio) | 4,39:1 | ✗ reprova, por pouco |
| `--esferografica` sobre `--papel` | 6,93:1 | ✓ |
| `--sobre-acao` sobre `--esferografica` | 7,84:1 | ✓ |

### Tema noite

Mesmos papéis, tinta invertida — um escuro frio, para o azul continuar lendo
como azul. Declarado **duas vezes**, e as duas precisam existir:

1. `@media (prefers-color-scheme: dark)` guardada por `:root:not([data-tema="papel"])`
   — atende quem nunca tocou no alternador e tem o sistema no escuro, sem
   sequestrar quem escolheu papel de propósito;
2. `:root[data-tema="noite"]` — faz o alternador vencer nos **dois** sentidos.
   Sem ela, escolher "noite" num sistema claro não teria efeito.

"Seguir o sistema" **remove** o atributo em vez de escrever um valor: é o que
devolve a decisão ao `@media`.

---

## As 14 cores de entidade

Uma volta completa em OKLCH: 14 matizes com passo de 360/14 = 25,7°, ancorada em
27° para que CPF caia no vermelho, e-mail no ciano, endereço no verde e telefone
no violeta — perto do que o usuário já associa a eles.

**A luminosidade não é fixa, e isso é deliberado.** Com L constante, a única
dimensão que separa 14 cores é o matiz, e 25,7° é pouco nas regiões onde o olho
discrimina mal (o arco amarelo-verde e o ciano-azul). Medido: com L fixo em 0,45,
**dezoito pares** ficavam perceptualmente confundíveis — `nit` e `email` a uma
distância OK de 0,033, que é a mesma cor na prática. Todas passavam em contraste
contra o fundo e mesmo assim falhavam no propósito de distinguir tipo de PII.

| | L fixo | L intercalado |
|---|---|---|
| Menor distância entre pares (papel) | 0,033 | **0,086** |
| Menor distância entre pares (noite) | 0,054 | **0,110** |
| Menor contraste | ✓ | 4,70:1 / 5,05:1 ✓ |

**A cor é canal secundário.** 14 categorias é mais do que a visão de cor separa
com folga, e quem tem deficiência de cor não recebe nenhuma delas. O rótulo
textual é o canal primário em toda a interface, por WCAG 1.4.1 — nenhuma tela
informa o tipo só pela cor.

### Onde elas moram

Declaradas à mão no `:root`, **não** no `@theme`. O Tailwind faz tree-shaking
dos tokens de tema, emitindo só os que alguma utility gerada referencia — e o
acesso a estas é sempre dinâmico (`corDaEntidade()` monta
`var(--color-entity-${token})` por interpolação). Uma string montada em runtime
é invisível para quem escaneia arquivos: treze dos catorze tokens eram
descartados, e o sintoma seria uma cor que não pinta, sem erro nenhum.

`ALL_ENTITIES`, em `src/types/index.ts`, guarda o **nome** do token, nunca o
valor. Antes havia duas paletas em desacordo: estes tokens, documentados e sem
uso, e 14 cores default do Tailwind 3 cravadas no TypeScript — que eram as que o
usuário via. Cor em constante de TypeScript não sabe que existe modo noturno.

---

## Elementos de assinatura

### Tarja

Um documento tarjado de verdade é barra **preta** sobre papel. O preenchimento é
sempre `--toner`; o tipo se identifica pelo filete de 2px na lateral. A versão
anterior pintava a tarja inteira na cor da entidade, o que fazia a página parecer
marcada a marca-texto em vez de censurada.

Cada tarja é um `<button>`: o revisor tem de alcançar **todas** as ocorrências
por Tab, não só as que couberem no mouse. O nome acessível diz tipo e valor —
para quem usa leitor de tela, a barra preta não comunica nada, e a cor do filete
menos ainda.

### Carimbo

A única ousadia do sistema, e só na biblioteca. Filete duplo, girado −3°, mono
caixa-alta com entreletra. `--carimbo` é reservado ao grave: uma cor de alarme
usada em botão comum perde o efeito.

### Movimento

**Um momento orquestrado só:** ao terminar o processamento, as tarjas entram
varrendo da esquerda para a direita, escalonadas, 240 ms no total — o documento
sendo carimbado. Todo o resto é 120 ms de hover e foco.

`prefers-reduced-motion` desliga a varredura e endireita o carimbo.

---

## Primitivas

`src/ui/` — `Botao`, `Cartao`, `Campo`, `Selo`, `GrupoSegmentado`, `Tabela`,
`Dialogo`, `Popover`, `Carimbo`, `Tarja`, `Marcacao`, `Icone`.

Antes desta camada, cada tela montava seus próprios botões e cartões com classes
soltas — dois botões com a mesma função tinham alturas diferentes, e o mesmo SVG
de cadeado existia em três cópias.

Notas que valem registro:

- **`Dialogo` usa o `<dialog>` nativo** com `showModal()`, não uma `<div>` com
  overlay. O elemento nativo entrega de graça o que uma reimplementação erra:
  foco preso, Esc que fecha, `inert` no resto da página e a camada superior do
  navegador — sem depender de z-index.
- **`GrupoSegmentado` é um radiogroup**: Tab entra uma vez só e as setas trocam a
  opção. Um grupo em que cada item é parada de Tab obriga quem usa teclado a
  passar por todos para chegar ao próximo controle.
- **`Campo` amarra rótulo e controle com `useId`**, por construção. Rótulo
  desamarrado é a falha de acessibilidade mais comum em formulário, e não aparece
  em nenhum teste que não seja de leitor de tela.
- **Alvo mínimo de 24px**, inclusive no tamanho `mini` — piso de WCAG 2.2.

### Camadas

`z-10` fixo no topo de lista · `z-100` popover e diálogo · `z-200` aviso.

Escala numérica do próprio Tailwind, e não token: existiam `--z-sticky`,
`--z-overlay` e `--z-toast` no CSS, com `z-sticky`/`z-overlay`/`z-toast` usados
no JSX. **Nunca foram classes** — o Tailwind v4 não gera utilities do namespace
`--z-*`, e o navegador ignora classe inexistente sem reclamar. Passou
despercebido porque, até o primeiro popover, a ordem do DOM já resolvia o
empilhamento sozinha.
