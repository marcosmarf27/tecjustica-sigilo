# Plano de Implementação: Sigilo v2

## Visão Geral

Nove fases em sequência. As fases 1–5 refazem o renderer na direção "papel de
processo" e trocam o histórico morto por uma biblioteca sobre cofre cifrado. As
fases 6–8 abrem o motor como serviço local (API v1 com pareamento, CLI com OCR,
servidor MCP) e movem a instalação da CLI para o instalador. A fase 9 acerta a
documentação e roda os gates.

**Ordem importa.** A fase 1 cria as primitivas que todas as telas usam; a fase 6
cria a API que a tela Conexões (fase 6) e a CLI (fase 7) consomem.

### Direção visual, em uma regra

Mono é o que a **máquina** diz (rótulo, botão, número, estado, código, CLI).
Serifa é o que se **lê** (o texto do processo e a prosa do próprio app). Num
revisor de tarjas, confundir texto do app com texto do documento é o erro mais
caro que existe; a distinção de fonte torna isso impossível de relance. Não há
sans no sistema.

---

## Fase 1: Fundação visual

Trocar a paleta, as fontes e a escala, e criar a camada de primitivas que hoje
não existe. Nada de comportamento muda nesta fase.

### Tarefas

- [x] Trocar as dependências de fonte no `package.json` e nos imports do `src/index.css`
- [x] Reescrever `src/styles/tokens.css` com os dois temas [complexo]
  - [x] Paleta papel no `:root`
  - [x] Paleta noite em `@media (prefers-color-scheme: dark)` guardada por `:root:not([data-tema="papel"])`
  - [x] Paleta noite de novo em `:root[data-tema="noite"]` para o alternador vencer nos dois sentidos
  - [x] Escala tipográfica nova (corpo 14px, metadado 12px, documento 16px/1,75)
  - [x] 14 tokens `--color-entity-*` recalculados para os dois temas
- [x] Conferir contraste dos 14 tokens de entidade nos dois temas e ajustar o que reprovar
- [x] Tirar `color` de `ALL_ENTITIES` em `src/types/index.ts` e apontar os consumidores para `var(--color-entity-*)`
- [x] Reescrever `.tarja` — preenchimento `--toner` sólido com filete de 2px na cor do tipo
- [x] Criar `.carimbo` — retângulo de filete duplo, girado −3°, mono caixa-alta com entreletra
- [x] Ajustar `.marcacao` para a paleta clara
- [x] Criar `src/ui/` com as primitivas [complexo]
  - [x] `Botao` (primário / secundário / discreto / perigo)
  - [x] `Cartao`, `Campo`, `Selo`, `GrupoSegmentado`, `Tabela`
  - [x] `Dialogo` e `Popover` — o app não tem **nenhum** modal hoje
  - [x] `Carimbo`, `Tarja`, `Marcacao`
- [x] Criar `src/ui/Icone.tsx` reunindo os SVG hoje colados no JSX (o mesmo cadeado aparece 3× e o mesmo "X" 3×)

### Detalhes Técnicos

**Fontes** — disponibilidade já confirmada no registro npm (5.3.0, variável):

```bash
npm remove @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
npm install @fontsource-variable/petrona @fontsource-variable/azeret-mono
```

Auto-hospedadas é requisito, não preferência: um `@import` do Google Fonts faria
o app telefonar para fora a cada abertura e, em máquina de vara sem internet, a
identidade cairia em silêncio para `system-ui`.

| Papel | Fonte | Por quê |
|---|---|---|
| Leitura | Petrona Variable | Serifa da Omnibus-Type, fundição latino-americana, desenhada para texto em português. Não é Playfair nem Instrument Serif. |
| Máquina | Azeret Mono Variable | Mono quadrada que aguenta caixa-alta com entreletra em 12px. O documento que o app lê é datilografado — a mono é o material. |

**Paleta papel (padrão)**

```css
--papel:            #F2F1EC;  /* fundo — sulfite, cast frio, não o creme quente */
--papel-fundo:      #E8E6DF;  /* área rebaixada, trilho */
--folha:            #FBFAF8;  /* cartão — MAIS CLARO que o fundo, folha sobre a mesa */
--folha-hover:      #F5F3EE;
--pauta:            #D8D5CB;  /* fio de divisão */
--pauta-forte:      #B9B5A8;  /* contorno */
--toner:            #16181D;  /* texto e preenchimento da tarja */
--toner-2:          #4C505A;
--toner-3:          #666B75;  /* metadado */
--esferografica:    #1B3FD1;  /* ação — azul de caneta */
--esferografica-h:  #133098;
--sobre-acao:       #FFFFFF;
--carimbo:          #B3322A;  /* vazamento e perigo — quase nunca aparece */
--deferido:         #1F6B47;
--atencao:          #8A5A00;
```

**Contraste já medido — não refazer:**

| Par | Razão | |
|---|---|---|
| `--toner-3` `#666B75` sobre `--papel` | **4,73:1** | ✓ |
| `#6B707B` sobre `--papel` (o valor que parece óbvio) | 4,39:1 | ✗ reprova |
| `--esferografica` sobre `--papel` | **6,93:1** | ✓ |
| `--sobre-acao` sobre `--esferografica` | **7,84:1** | ✓ |

Os 14 tokens de entidade **não** foram medidos ainda.

**Paleta noite** — mesmos papéis, tinta invertida. Não é o grafite violeta
atual: um escuro mais frio, para o azul continuar lendo.

```css
--papel: #14161A;  --papel-fundo: #0E1013;  --folha: #1C1F25;
--folha-hover: #23272E;  --pauta: #2E333B;
--toner: #ECEAE4;  --toner-2: #A8ADB6;  --toner-3: #7E848E;
--esferografica: #7FA5FF;  --sobre-acao: #0E1013;
```

**Entidades — consolidar duas paletas conflitantes.** Hoje existem os 14 tokens
`--color-entity-*` em `tokens.css:64-77` (documentados e **mortos**, zero uso) e
14 cores default do Tailwind 3 em `src/types/index.ts:25-40` (**as que o usuário
vê**). O `docs/design-system.md:62` afirma que a migração foi feita — ela nunca
chegou ao JS. As cores saem do TS e ficam só no CSS, numa rampa de luminosidade
fixa (OKLCH L≈0,45 no tema papel) com os 14 matizes espalhados. Piso: 4,5:1
sobre `--papel` para texto, 3:1 para a marcação.

Entidades: `PERSON · CPF_BR · CNPJ_BR · RG_BR · PHONE_NUMBER_BR ·
EMAIL_ADDRESS · ENDERECO_BR · CEP_BR · LOCATION · OAB_BR · DATE_OF_BIRTH ·
NIT_PIS_PASEP · NUMERO_PROCESSO_CNJ · CONTA_BANCARIA`

**Tarja preta** — um documento tarjado de verdade é barra preta sobre papel. O
tipo continua legível pelo filete:

```css
.tarja {
  background: var(--toner);
  border-left: 2px solid var(--cor-entidade);
  color: transparent;
}
.tarja:hover, .tarja:focus-visible { background: transparent; color: var(--toner); }
```

**Carimbo** — a única ousadia do sistema, e só na biblioteca (fase 4):

```
   ╭═══════════════════╮
   ║  A N O N I M I Z  ║   ← --esferografica
   ╰═══════════════════╯
        EM REVISÃO         ← --toner-3
      2 VAZAMENTOS         ← --carimbo
```

**Tailwind v4** — não há `tailwind.config.js`; a configuração vive no bloco
`@theme` do próprio `tokens.css`, via `@tailwindcss/vite`.

Tokens hoje definidos e nunca usados, a reaproveitar ou remover: toda a escala
`--space-1..7` (zero ocorrências fora do `tokens.css`) e `--radius-*`/`--shadow-*`
(os componentes usam `rounded-lg`, `shadow-sm` do Tailwind).

---

## Fase 2: Casca e navegação

Trilho fixo que nunca desmonta, cinco destinos, estado central e preferências
persistidas.

### Tarefas

- [x] Criar `src/componentes/TrilhoNavegacao.tsx` com os quatro destinos e o rodapé de estado do motor
- [x] Criar `src/estado/` — contexto + reducer [complexo]
  - [x] Mover o estado hoje espalhado em `App.tsx:44-60` e `App.tsx:206`
  - [x] Extrair a orquestração do lote de `handleAnonymize` para um hook
  - [x] Eliminar o hack `await flush()` (`App.tsx:70`)
- [x] Criar `src/hooks/usePreferencias.ts` — entidades, política, formato, pasta de saída, tema, auto-arquivamento
- [x] Reduzir `src/App.tsx` de 544 linhas a casca + roteador
- [x] Fazer o carregamento e o erro do motor virarem estado **dentro** da casca, não early-return
- [x] Criar os arquivos vazios de `src/telas/{Mesa,Documentos,Revisao,Conexoes,Ajustes}.tsx`
- [x] Alternador de tema (papel / noite / seguir o sistema) escrevendo `data-tema` no `<html>`

### Detalhes Técnicos

```
┌────────────────┬──────────────────────────────────────────────┐
│ ▚ SIGILO       │                                              │
│                │                                              │
│ ▸ Anonimizar   │                 (conteúdo)                   │
│   Documentos   │                                              │
│   Conexões     │                                              │
│   Ajustes      │                                              │
│                │                                              │
│ ─────────────  │                                              │
│ BERT JURÍDICO  │  ← estado do motor + da API, sempre visível  │
│ API · 2 CLIENT │                                              │
└────────────────┴──────────────────────────────────────────────┘
```

Trilho de 220px. Revisão **não** é destino de navegação — é o que abre ao clicar
num documento.

**Por que o trilho não pode desmontar:** hoje `status === "loading"`
(`App.tsx:350`) e `status === "error"` (`App.tsx:385`) são early-returns antes
da Sidebar, e sequestram a tela inteira. O app fica sem navegação nenhuma
durante um carregamento que chega a 180 s na primeira execução com BERT.

**Preferências** — hoje **nenhuma** sobrevive ao fechamento: entidades resetam
para "todas" (`App.tsx:46`), política para `"placeholder"` (`App.tsx:49`),
formato para `"md"` (`App.tsx:206`). Persistir em `localStorage` (chave
`tecjustica-sigilo-prefs`) — são preferências, não PII, e podem ficar em claro.

O estado do motor no rodapé importa por segurança: quando o BERT não carrega e o
motor cai para spaCy, menos nomes e locais são encontrados. Hoje isso é um badge
numa tela só (`App.tsx:455-466`) mais um banner (`App.tsx:430`).

---

## Fase 3: Mesa + receita

O maior ganho de usabilidade: três blocos empilhados viram uma frase.

### Tarefas

- [x] Construir `src/telas/Mesa.tsx` — área de soltar, receita, um botão
- [x] Criar `src/componentes/Receita.tsx` [complexo]
  - [x] Renderizar a configuração como frase com trechos acionáveis
  - [x] Popover de entidades (reaproveitar a lógica de `EntityConfig.tsx`)
  - [x] Popover de política (reaproveitar `PoliticaSelector.tsx` e seus exemplos concretos)
  - [x] Popover de formato de saída
  - [x] Popover de pasta de destino, com seletor de diretório
- [x] Adaptar `FileSelector.tsx` à área nova, mantendo `getPathForFile` para o arrastar-e-soltar
- [x] Acrescentar filtro de PDF/DOCX/XLSX/PPTX/imagem ao `dialog.showOpenDialog` do handler `select-files`
- [x] Marcar estado por arquivo na fila (na fila / lendo / anonimizando / pronto / falhou)
- [x] Reenquadrar `ProcessingView.tsx` na paleta nova

### Detalhes Técnicos

```
┌──────────────────────────────────────────────────────────────┐
│  Anonimizar                                                  │
│                                                              │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
│                                                              │
│   │        Arraste os autos como saem do PJe            │   │
│              PDF · DOCX · XLSX · imagem · TXT                │
│   │                                                     │   │
│                        [ escolher arquivos ]                 │
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
│                                                              │
│   Mascarar as 14 entidades com marcador, salvar em .md       │
│   ────────────────      ────────           ───              │
│   na pasta do original.                                      │
│   ──────────────────                                         │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │              A N O N I M I Z A R                   │    │
│   └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Caminho normal: soltar arquivo → um clique. Contra os ~17 controles de hoje.

A receita é escrita como descrição do que **vai acontecer**, não como rótulo de
campo. Cada trecho sublinhado abre um popover; o valor escolhido volta para a
frase.

**Bug herdado a consertar de passagem:** o filtro do `dialog.showOpenDialog` no
handler `select-files` (`electron/main.ts`) só oferece `txt/md/rtf`, embora o
backend leia PDF/DOCX/XLSX/PPTX/imagens. Os PDFs só entram hoje por
arrastar-e-soltar. (`selectFiles` está exposto no preload e nunca é chamado — o
`FileSelector` usa `<input type="file">`.)

Manter o corte em 10 arquivos por lote (`MAX_FILES` em `FileSelector.tsx:4`) e o
processamento em série; paralelizar não está no escopo.

---

## Fase 4: Cofre + biblioteca

Onde a mudança de promessa acontece. Cifragem e falha fechada são requisito, não
polimento.

### Tarefas

- [x] Criar `electron/cofre.ts` isolando `safeStorage` [complexo]
  - [x] `gravar`, `ler`, `listar`, `apagar`, `esvaziar`, `expurgar`
  - [x] Recusar gravação quando `safeStorage.isEncryptionAvailable()` for `false`
  - [x] Índice cifrado também — nome de arquivo carrega nome de pessoa
- [x] Expor o cofre por IPC no `electron/main.ts` e no `electron/preload.ts`; tipar em `src/vite-env.d.ts`
- [x] Diálogo de consentimento na primeira gravação, dizendo o que passa a ficar no disco
- [x] Criar `src/hooks/useBiblioteca.ts`
- [x] Construir `src/telas/Documentos.tsx` — tabela, pastas, busca [complexo]
- [x] Auto-arquivamento pela pasta do processo, a partir do CNJ detectado
- [x] Migrar `useHistory.ts`: o histórico de metadados em `localStorage` some, a biblioteca toma o lugar
- [x] Expurgo automático configurável, apagar item e "Esvaziar o cofre" nos Ajustes
- [x] Construir `src/telas/Ajustes.tsx` — padrões, tema, cofre, deny-list, motor
- [x] Dar à deny-list busca e **remoção** de termo

### Detalhes Técnicos

**Cifragem.** `safeStorage` do Electron; no Windows é DPAPI, atrelado à conta do
usuário. Chave gerenciada pelo SO — sem senha para o usuário lembrar e sem
arquivo de chave para vazar.

```ts
import { safeStorage, app } from "electron";
if (!safeStorage.isEncryptionAvailable()) {
  // Falha fechada. Nunca gravar em claro — mesma cultura do fetch-ocr-models.sh.
  throw new Error("cofre indisponível");
}
const cifrado = safeStorage.encryptString(JSON.stringify(entrada));
```

O `safeStorage` vive no **main process**, então quem grava é o main, por IPC. A
chave nunca passa pelo renderer.

**Limite honesto, que precisa estar escrito na interface e nos docs:** DPAPI
protege contra outro usuário da máquina e contra leitura do disco fora do
sistema. **Não** protege contra programa malicioso rodando como o próprio
usuário.

**Layout em disco** — `app.getPath('userData')`:

```
%APPDATA%\TecJustiça Sigilo\
  cofre\
    indice.bin          ← cifrado: id, nome, data, pasta, CNJ, contagens
    <id>.bin            ← cifrado: texto original, ocorrências, texto anonimizado
```

A saída que o usuário salva ao lado do original continua **em claro** — é segura
por construção e é o arquivo dele.

**Duas camadas, propósitos diferentes:**

| | Cofre (cifrado) | Saída (claro) |
|---|---|---|
| Conteúdo | texto original, ocorrências, texto anonimizado, nome, CNJ | só o texto anonimizado |
| Onde | `userData` | pasta escolhida pelo usuário |
| Some quando | expurgo, apagar, esvaziar | nunca — é do usuário |

```
┌──────────────────────────────────────────────────────────────┐
│ Documentos                          [ buscar          ] [+]  │
│                                                              │
│ PASTAS   Todos · 0001234-56.2023.8.06.0001 · Ocara · Avulsos │
│ ──────────────────────────────────────────────────────────── │
│                                                              │
│  ╱ANONIMIZ╱  Petição inicial.pdf                             │
│              0001234-56.2023.8.06.0001 · 30 ago · fls. 1–14  │
│              Nome 12 · CPF 4 · Endereço 2       [abrir] [⋯]  │
│ ──────────────────────────────────────────────────────────── │
│  ╱2 VAZAM╱   Expedientes 13-08.pdf                    (red)  │
│              Avulsos · 29 ago · fls. 1–819                   │
│              3.613 de 3.615 mascaradas          [abrir] [⋯]  │
└──────────────────────────────────────────────────────────────┘
```

Tabela, não grade de cartões: o operador varre por nome, data e contagem, e um
índice de cartório é uma tabela.

**Numeração em `fls.`** — ocorrências e páginas contadas no vocabulário dos
autos ("fls. 1–14 · 3.615 ocorrências"), não em `01 / 02 / 03`. Numeração só
onde a ordem carrega informação.

**Auto-arquivamento.** O detector já encontra o número CNJ com validação de
checksum (`python-backend/recognizers.py` + `validators.py`,
`processo_cnj_valid`). A entidade `NUMERO_PROCESSO_CNJ` vem em
`entities_found`; a pasta sai daí. Sem CNJ, "Avulsos". Desligável nos Ajustes.

**Deny-list.** Hoje só dá para **adicionar** termo, pela tela de revisão
(`POST /config/deny-list`), sem nenhuma forma de tirar. Tamanho atual do
`deny_list.json`: 8.170 B, chaves `{"*": 193, "LOCATION": 81, "PERSON": 76,
"ORGANIZATION": 39}`. `save_deny_list()` sobrescreve o JSON inteiro **sem lock**
— com GUI e extensão escrevendo juntas dá para perder escrita; serializar as
gravações no `config_loader`.

`context_words.json` **não** tem recarga a quente: é lido uma vez em
`recognizers.criar_recognizers_brasil()` dentro de `initialize()`. Editar exige
reiniciar o backend — a interface precisa dizer isso.

---

## Fase 5: Revisão

### Tarefas

- [x] Reconstruir `src/telas/Revisao.tsx` a partir de `RevisaoView.tsx`, preservando a lógica de tarjas e ocorrências
- [x] Texto do documento em serifa 16px/1,75
- [x] Trocar o painel lateral `hidden lg:block` por gaveta com botão abaixo de 1024px
- [x] Varredura das tarjas ao concluir — 240 ms, escalonada pela ordem da ocorrência
- [x] Respeitar `prefers-reduced-motion` na varredura
- [x] Abrir documento vindo da biblioteca com as tarjas intactas
- [x] Manter "Não é PII" gravando na deny-list, agora com confirmação

### Detalhes Técnicos

**Movimento — um momento orquestrado só.** Ao terminar o processamento as tarjas
entram varrendo da esquerda para a direita, escalonadas, 240 ms no total: o
documento sendo carimbado. Todo o resto é 120 ms de hover/foco.

**Acessibilidade que a tela atual quebra:** o painel de ocorrências é
`hidden ... lg:block`, então some abaixo de 1024px e a auditoria fica
inalcançável em janela estreita — justamente a tarefa central de quem responde
pelo sigilo.

O modo `.marcacao` (localizar sem esconder, `data-ativa="true"` para a
ocorrência sob foco) continua como está, adaptado à paleta clara.

`InfoOcr.paginas_com_erro` **não pode ser escondido**: são páginas que
precisavam de OCR e não voltaram. O texto delas não está no resultado, e quem
revisa precisa saber antes de assinar embaixo.

---

## Fase 6: API v1 + Conexões

### Tarefas

- [x] Escrever `sessao.json` no `userData` quando o backend ficar pronto; apagar no `before-quit`
- [x] Extrair `preparar_runtime()` no `server.py` a partir do bloco `__main__` [complexo]
- [x] Criar `python-backend/clientes.py` — registro de clientes pareados com escopos
- [x] Criar `python-backend/api_v1.py` com as rotas versionadas [complexo]
  - [x] `GET /v1/info` (pública)
  - [x] `POST /v1/parear` e `GET /v1/parear/{id}`
  - [x] `POST /v1/anonimizar`, `POST /v1/ocr`, `POST /v1/documento`
  - [x] `GET /v1/clientes` e `DELETE /v1/clientes/{id}`
- [x] Estender o middleware `exigir_token` para aceitar token de cliente com escopo
- [x] Trocar o CORS estático por `allow_origin_regex` de extensão
- [x] Criar `electron/pareamento.ts` e o diálogo de aprovação com código
- [x] Construir `src/telas/Conexoes.tsx`
- [x] Absorver `CliInstaller.tsx` como painel de status dentro de Conexões

### Detalhes Técnicos

**Descoberta — o gap nº 1.** `app.getPath('userData')/sessao.json`:

```json
{ "versao": 1, "porta": 8123, "pid": 4242, "api": "habilitada" }
```

**Sem token dentro.** É essa a fronteira que importa: uma página de navegador não
lê arquivo, um programa local lê. Descoberta chega para quem deve e não chega
para quem não deve, sem criptografia nenhuma envolvida.

**Pareamento:**

1. `POST /v1/parear {nome, escopos}` → `202 {codigo: "X7K2QP", pedido}`
2. O app levanta diálogo com nome, origem (`Origin`/`User-Agent`), escopos
   pedidos e o **mesmo código** — ver o código nos dois lados é o que impede
   aprovação às cegas
3. `GET /v1/parear/{pedido}` → `200 {token}` (uma vez) · `202` pendente · `403` negado
4. Cliente guardado cifrado: id, nome, escopos, criado_em, último uso, hash do token

**Escopos:**

| Escopo | Rota | Risco |
|---|---|---|
| `anonimizar` | `POST /v1/anonimizar` (texto entra, texto sai) | baixo |
| `ocr` | `POST /v1/ocr` (bytes entram) | baixo |
| `documento` | `POST /v1/documento` (arquivo **enviado**, multipart) | baixo |
| `arquivo-local` | `/processar` com `caminho` | **alto — só o app tem, nunca concedido no pareamento** |

Responde direto ao aviso do `CLAUDE.md`: "`127.0.0.1` não protege nada… e
`/processar` abre arquivo por caminho". Cliente externo manda o conteúdo; quem
lê o disco continua sendo só a GUI.

**Middleware.** Hoje (`server.py:38-56`):

```python
TOKEN_SESSAO = os.environ.get("PRESIDIO_TOKEN") or secrets.token_urlsafe(32)
ROTAS_PUBLICAS = {"/health", "/docs", "/openapi.json"}

@app.middleware("http")
async def exigir_token(request, call_next):
    if request.url.path in ROTAS_PUBLICAS or request.method == "OPTIONS":
        return await call_next(request)
    enviado = request.headers.get("x-presidio-token", "")
    if not secrets.compare_digest(enviado, TOKEN_SESSAO):
        return JSONResponse(status_code=403, content={"detail": "requisição sem credencial desta sessão"})
```

Passa a aceitar `TOKEN_SESSAO` (o renderer, escopo total) **ou** token de cliente
cujos escopos cubram a rota. `/v1/info` entra em `ROTAS_PUBLICAS`. Comparação
continua em `secrets.compare_digest`. O gancho já existe: `PRESIDIO_TOKEN` é
injetável por ambiente.

**CORS.** Hoje (`server.py:83-90`) monta `CORSMiddleware` com lista estática só
quando `PRESIDIO_DEV_ORIGIN` existe. Trocar por:

```python
allow_origin_regex=r"^chrome-extension://[a-p]{32}$"
allow_methods=["GET", "POST", "DELETE", "OPTIONS"]
allow_headers=["Content-Type", "X-Presidio-Token"]
```

mais a origem de dev. Nunca origem `http://` de página comum. **CORS não é
autorização** — quem autoriza é o token; o regex só evita que o preflight
reprove o cliente legítimo. `allow_credentials` continua desligado.

**Armadilha herdada, a consertar agora.** `documentos.configurar_ocr(...)` só
roda dentro do `if __name__ == "__main__"` (`server.py:405-408`). Qualquer
entrypoint novo que não repita a chamada faz o liteparse cair **em silêncio**
para o Tesseract embutido no wheel — o motor descartado por recuperar 17,7% das
palavras em matrícula datilografada. Extrair para `preparar_runtime()` e chamar
do `__main__`, do MCP e do modo offline da CLI.

O token vai para a stdout **depois** de `engine.initialize()`
(`server.py:410-416`), e o Electron faz parsing linha a linha com buffer
(`electron/saidaBackend.ts`, `/^PRESIDIO_TOKEN=(\S+)$/`) porque o chunk pode
cortar o token no meio. Não mexer nessa ordem.

```
┌──────────────────────────────────────────────────────────────┐
│ Conexões                            API local   [ ligada  ]  │
│                                     127.0.0.1:8123           │
│ ──────────────────────────────────────────────────────────── │
│ ● Linha de comando          tecjustica-sigilo                │
│   no PATH do Windows        anonimizar · ocr · documento     │
│                                                    [ testar ]│
│ ──────────────────────────────────────────────────────────── │
│ ● Extensão PJe (Chrome)     usada há 3 min                   │
│   chrome-extension://abc…   anonimizar                       │
│                                       [ escopos ] [ revogar ]│
│ ──────────────────────────────────────────────────────────── │
│ ○ Claude Code (MCP)         nunca usada                      │
│   stdio                     anonimizar · ler · ocr           │
│                                       [ escopos ] [ revogar ]│
│                                                              │
│                          [ + parear novo cliente ]           │
└──────────────────────────────────────────────────────────────┘
```

As rotas atuais (`/health`, `/extract-text`, `/ocr`, `/anonymize`,
`/processar…`, `/config/deny-list`) continuam funcionando — a v1 é casca sobre
`engine.py`, `documentos.py` e `ocr_engine.py`, que já são chamáveis em
processo.

---

## Fase 7: CLI v2 + MCP

### Tarefas

- [x] Reescrever `python-backend/cli.py` com subcomandos, preservando a forma atual [complexo]
- [x] Implementar a resolução de backend (delegar ao app quente / subir em processo)
- [x] Dar leitura de documento e OCR à CLI
- [x] Implementar `status` e `conectar`
- [x] Criar `python-backend/mcp_server.py` com as quatro ferramentas
- [x] Acrescentar `mcp` ao `requirements.txt` e regerar `requirements-embed.txt` [complexo]
- [x] Atualizar `python-backend/tecjustica-sigilo.cmd` e o shim WSL para os subcomandos

### Detalhes Técnicos

```
tecjustica-sigilo <arquivo>...                     # forma atual, preservada
tecjustica-sigilo anonimizar <arquivo>... [-o|--output-dir|--in-place]
                                          [-e ENTIDADES] [-m POLÍTICA] [-f text|json]
tecjustica-sigilo ler <arquivo>...                 # extrai + OCR → markdown
tecjustica-sigilo ocr <imagem>
tecjustica-sigilo status                           # app no ar? porta, motor, OCR
tecjustica-sigilo conectar                         # pareia esta CLI
tecjustica-sigilo mcp                              # servidor MCP em stdio
```

**A decisão de arquitetura: a CLI é cliente fino, não uma segunda cópia do
motor.** Carregar o BERT custa minutos e ~2,5 GB. Uma CLI que sobe o próprio
motor a cada chamada é inútil para script. Lê `sessao.json`; app no ar → delega
por HTTP com o motor quente; app fechado → sobe em processo avisando o custo.
`--offline` força local, `--remoto` força falhar em vez de esperar.

**OCR na CLI offline.** O liteparse **não aceita motor de OCR injetado em
processo** — o único ponto de extensão é `ocr_server_url`. O modo offline sobe o
`_servidor_autonomo()` que já existe em `ocr_engine.py:599-638`
(`python -m ocr_engine --port 8829 --perfil small`) numa porta efêmera e o
derruba ao terminar. Atenção: esse servidor autônomo hoje é **sem token** — no
uso da CLI ele fica em `127.0.0.1` e some ao fim do comando.

**API interna já chamável, sem HTTP:**

```python
from engine import get_engine
motor = get_engine(); motor.initialize()
motor.anonymize(text, entities, language="pt", progresso=None,
                politica_mascara="placeholder", cancelado=None)
# → {"anonymized_text", "entities_found", "politica_mascara", "valores_distintos"}
# levanta CancelamentoSolicitado se cancelado() virar True

import documentos
documentos.configurar_ocr(url, headers)          # OBRIGATÓRIO antes
documentos.extrair(caminho, progresso=None, max_paginas=None)
# → DocumentoExtraido: .como_markdown(), houve_ocr, paginas_ocr,
#   paginas_com_erro, erros, total_paginas

import ocr_engine
ocr_engine.reconhecer(conteudo: bytes, idioma=None, perfil=None)
```

**A limitação que a fase corrige:** `cli.py:37` faz
`Path(path).read_text(encoding="utf-8")`. Nunca importa `documentos.py`. Hoje
`tecjustica-sigilo autos.pdf` termina em `UnicodeDecodeError`.

**MCP** — `tecjustica-sigilo mcp`, stdio. Ferramentas `anonimizar_texto`,
`ler_documento`, `ocr_imagem`, `status`. Mesma resolução de backend da CLI.

⚠ **Dependência nova de runtime entra nos dois lugares.** Uma dependência que só
existe no `.venv` mata o app instalado — foi o que aconteceu com
`python-multipart`: todos os testes passaram, o instalador foi entregue, e o
backend morria na largada com a tela presa em "Carregando motor de anonimização".
A distribuição embeddable não tem pip; wheels entram com
`--platform win_amd64 --only-binary=:all: --no-deps` e versões explícitas. E
`--no-deps` desliga o resolvedor **caladamente**: o que não estiver listado não
entra e ninguém reclama. Regerar `requirements-embed.txt` a partir de um venv que
comprove funcionar, como manda o cabeçalho do próprio arquivo.

Ambientais que controlam o motor: `PRESIDIO_NLP_MODE` (`transformer` padrão |
`spacy`), `PRESIDIO_OCR_PERFIL` (`small`/`medium`/`tiny`),
`PRESIDIO_OCR_THREADS`, `PRESIDIO_OCR_MODELOS`, `PRESIDIO_TOKEN`,
`PRESIDIO_DEV_ORIGIN`.

---

## Fase 8: Instalador

### Tarefas

- [x] Criar `build/installer.nsh` com `customInstall` e `customUnInstall`
- [x] Referenciar o `.nsh` no `electron-builder.yml`
- [x] Acrescentar os arquivos novos do backend à lista do `scripts/sync-backend.sh`
- [x] Exigir as rotas `/v1` no `scripts/smoke-backend.sh`
- [x] Manter os handlers IPC de CLI como conserto manual dentro de Conexões

### Detalhes Técnicos

Hoje **não existe** hook de pós-instalação: nenhum `.nsh` no repositório, nenhum
`afterPack`/`afterSign`. A instalação da CLI acontece em runtime, pelo handler
`cli-install-windows`, que mexe no PATH do usuário via
`powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', $args[0], 'User')"`.

O alvo NSIS é **por usuário** (`perMachine` não está definido), então HKCU é o
lugar certo. Depois de escrever, propagar `WM_SETTINGCHANGE` para o `cmd` novo
enxergar sem reboot.

`electron-builder.yml` atual:

```yaml
appId: com.tecjustica.sigilo
productName: TecJustiça Sigilo
extraResources:
  - from: resources/python-backend/
    to: python-backend/
win: { target: [{ target: nsis, arch: [x64] }] }
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Acrescentar `nsis.include: build/installer.nsh`.

O diretório a entrar no PATH é onde vive o `tecjustica-sigilo.cmd`:
`<install>\resources\python-backend`. Em dev, `./resources/python-backend`
(`backendResourcePath()` em `electron/main.ts`).

`scripts/smoke-backend.sh` hoje importa `server` com o Python embarcado e exige
que `{"/health","/ocr","/processar","/anonymize"}` estejam registradas. **Não
tirar do `build:dist`** — é a defesa que pegaria o `python-multipart` faltando.
Acrescentar as rotas `/v1`.

`scripts/sync-backend.sh` tem lista explícita do que é copiado (`tests/` e
`eval/` ficam de fora). `api_v1.py`, `clientes.py` e `mcp_server.py` precisam
entrar, senão o app instalado sobe sem elas.

**Armadilhas de Windows que já custaram uma instalação inteira:**
`Path.write_text` troca `\n` por `\r\n` — para qualquer arquivo cujo hash é
conferido, `newline="\n"` explícito. Caminho do Git Bash (`/c/Users/...`) não
serve para `python.exe` nativo; converter com `cygpath -m`. O layout do venv
difere: `Scripts/python.exe` no Windows, `bin/python` no resto.

---

## Fase 9: Documentação e gates

### Tarefas

- [x] Corrigir `README.md:118-127` — a promessa de que nada de PII vai para o disco
- [x] Atualizar a seção de CLI do `README.md` com os subcomandos e o MCP
- [x] Atualizar `CLAUDE.md` — cofre, API v1, escopos; fechar a pendência da extensão
- [x] Reescrever `docs/design-system.md` na direção nova
- [x] Criar `docs/api-local.md` — contrato para quem for escrever a extensão
- [x] Rodar a suíte Python e `npm run test:electron`
- [ ] Rodar o gate de acurácia e registrar o resultado
- [x] Abrir o app e percorrer os cinco destinos

### Detalhes Técnicos

**`README.md:118-127` hoje afirma:** "O texto do documento e a lista de dados
encontrados nunca vão para o disco — ficam só na memória, enquanto o app está
aberto. Um índice de todos os CPFs e endereços de um processo é exatamente o
artefato que este app existe para evitar." Com o cofre isso deixa de ser
verdade. O texto novo precisa dizer o que fica no disco, cifrado com o quê,
contra o que protege e contra o que **não** protege.

**Gates:**

```bash
cd python-backend
PRESIDIO_NLP_MODE=spacy ../.venv/Scripts/python.exe -m pytest tests -q
npm run test:electron

PRESIDIO_EVAL_CORPUS=<pasta> ../.venv/Scripts/python.exe -m eval.run_eval
```

Baseline a bater: **99,92% por ocorrência, 99,10% por valor único**, no modo
BERT. Última execução (29/08/2026, v1.2.0, `transformer`, 14 entidades, 819
páginas): 99,94% por ocorrência (3.613/3.615) e 99,40% por valor único
(331/333). Custa ~62 min de CPU — é gate de release, não de commit.

Conferir `modo_nlp` dentro do JSON: se o motor cair para spaCy, o arquivo sai
com números de spaCy. E conferir no cabeçalho que o corpus foi lido — sem
`PRESIDIO_EVAL_CORPUS` o gate é **pulado**, e pulado passa por aprovado em log
corrido.

**Abrir o app é obrigatório.** Os dois bugs mais graves de agosto passaram por
110 testes verdes e só apareceram quando o usuário instalou e usou. Rodar a
suíte não é a mesma coisa que abrir o app.

**Verificação manual que a suíte não cobre:**

- **Contraste** — 14 tokens de entidade nos dois temas: 4,5:1 texto, 3:1 marcação
- **Teclado** — cinco telas só com Tab; nada dependendo de hover; alvos ≥24px
- **Cofre** — gravar, fechar, reabrir, ver as tarjas intactas. Depois forçar
  `isEncryptionAvailable()` a `false` e confirmar que **recusa gravar**.
  Conferir com editor hexadecimal que não há CPF legível no arquivo.
- **API** — parear cliente falso com `curl`, ver o código no diálogo, aprovar,
  usar, revogar, confirmar 403. Tentar `arquivo-local` com token de cliente: 403.
- **CORS** — de uma extensão de teste, confirmar que o preflight `OPTIONS`
  passa. **Sem navegador não existe CORS**: os 110 testes falam HTTP direto e
  não cobrem isso — foi exatamente assim que a tela travou em "Carregando motor
  de anonimização" com o backend perfeitamente no ar.
- **CLI** — `tecjustica-sigilo autos.pdf` com o app aberto (rápido) e fechado
  (`--offline`, lento). Confirmar PP-OCRv6 e **não** Tesseract: a degradação é
  silenciosa.
- **MCP** — registrar num cliente MCP real e chamar as quatro ferramentas.
- **Instalador** — `npm run build:dist`, instalar, abrir `cmd` novo e rodar
  `tecjustica-sigilo status` **sem** ter aberto a GUI.
