# Requisitos: Sigilo v2 — interface nova, cofre local, CLI/API/MCP

## Descrição

O TecJustiça Sigilo acerta (99,94% por ocorrência na v1.2.0), mas três coisas o
prendem:

1. **A interface é um formulário longo, não uma mesa de trabalho.** Para
   anonimizar um arquivo é preciso rolar por 14 chips de entidade e 3 cartões de
   política — toda vez, porque nenhuma preferência sobrevive ao fechamento
   (`src/App.tsx:44-60`). O formato de saída (MD/DOCX) só aparece **depois** do
   processamento, dentro da `RevisaoView`. E o histórico é uma promessa quebrada
   por desenho: é clicável e falha com um toast "processe o arquivo de novo"
   depois de reiniciar (`src/App.tsx:335-347`), porque `useHistory` guarda só
   metadados e o conteúdo vive num `useRef` de sessão.

2. **A CLI é meia CLI.** `python-backend/cli.py` existe e é instalada no PATH,
   mas `_read_input` faz `Path(path).read_text(encoding="utf-8")` (linha 37) —
   só texto puro. `tecjustica-sigilo autos.pdf` quebra com `UnicodeDecodeError`.
   O recurso mais caro do produto (ler PDF/imagem com OCR) é inalcançável fora
   da GUI. E a instalação só acontece se o usuário achar a tela "Linha de
   Comando": não há hook de pós-instalação NSIS.

3. **Nenhum programa externo consegue chegar no motor.** A porta é dinâmica
   (`findAvailablePort(8123)`, `electron/main.ts:37`), o token é sorteado e
   anunciado por stdout (`python-backend/server.py:414`), e ambos só existem na
   memória de dois processos. Sem arquivo de sessão, sem porta fixa, sem
   registro — descoberta é o gap número 1. A pendência registrada no
   `CLAUDE.md` ("extensão do PJe: Native Messaging ou HTTP local com
   pareamento") continua em aberto.

Esta spec entrega: interface refeita na direção "papel de processo" (tema claro
padrão + modo noturno), biblioteca de documentos com pastas e reabertura de
verdade sobre um cofre cifrado, e o motor exposto como serviço local para CLI,
extensões e agentes MCP, com permissão explícita e revogável.

## Decisões já tomadas

| | Escolha |
|---|---|
| Paleta | **Papel claro como padrão + modo noturno** derivado dos mesmos tokens |
| Integrações | **CLI completa (com OCR)** + **API HTTP local com pareamento** + **servidor MCP**. Native Messaging fica fora do escopo. |
| Biblioteca | **Guarda tudo** — texto original e ocorrências — para a revisão reabrir intacta |
| Estrutura | Uma spec só, nove fases em sequência |

## ⚠ Mudança de promessa do produto

Guardar o texto original e as ocorrências cria no perfil do usuário exatamente o
artefato que o `README.md:118-127` promete não criar: um índice pesquisável de
CPFs, nomes e endereços. A decisão foi tomada com o custo à vista. O que a torna
defensável **não é opcional** e está nos critérios de aceitação: cifragem em
repouso, falha fechada, opt-in, expurgo, limite escrito e documentação
corrigida.

## Critérios de Aceitação

### Interface

- [ ] Tema papel é o padrão; existe modo noturno; a escolha persiste entre sessões
- [ ] Todo token de cor tem valor definido no `:root` — nenhuma cor tem sua única definição dentro de um bloco `@media` ou `[data-tema]`
- [ ] As 14 cores de entidade existem em **um só lugar** (`tokens.css`); `ALL_ENTITIES` em `src/types/index.ts` não carrega mais `color`
- [ ] Contraste conferido nos dois temas: 4,5:1 para texto, 3:1 para a marcação e elementos de interface
- [ ] Corpo da interface ≥14px, metadado ≥12px, texto do documento 16px/1,75
- [ ] Duas fontes, auto-hospedadas via `@fontsource`, nenhuma requisição de rede na abertura
- [ ] Regra das duas vozes respeitada: mono para rótulo/botão/número/estado/código, serifa para prosa e para o texto do processo
- [ ] Trilho de navegação nunca desmonta — está presente durante o carregamento do motor e na tela de erro
- [ ] Anonimizar um arquivo com os padrões salvos custa **duas ações**: soltar o arquivo e clicar
- [ ] Entidades, política, formato de saída e pasta de destino persistem entre sessões
- [ ] O painel de ocorrências continua alcançável abaixo de 1024px (hoje é `hidden lg:block`)
- [ ] Percurso completo por teclado nas cinco telas; alvos ≥24px; foco visível
- [ ] `prefers-reduced-motion` desliga a varredura das tarjas

### Cofre e biblioteca

- [ ] Cofre desligado por padrão; primeira gravação pede consentimento explícito dizendo o que passa a ficar no disco
- [ ] Conteúdo cifrado com `safeStorage`; um editor hexadecimal não encontra CPF legível no arquivo do cofre
- [ ] Com `safeStorage.isEncryptionAvailable() === false` o cofre **recusa gravar** — nunca grava em claro
- [ ] Documento gravado reabre com as tarjas intactas depois de fechar e abrir o app
- [ ] Documento cai sozinho na pasta do processo pelo número CNJ que o próprio detector encontrou; sem CNJ vai para "Avulsos"; o auto-arquivamento é desligável
- [ ] Expurgo automático configurável (padrão 30 dias), apagar item e "Esvaziar o cofre" funcionam
- [ ] `README.md`, `CLAUDE.md` e `docs/design-system.md` descrevem o que o app faz de verdade

### API local

- [ ] `sessao.json` escrito quando o backend fica pronto e apagado no encerramento; **não contém token**
- [ ] Pareamento mostra o mesmo código nos dois lados, com nome, origem e escopos pedidos
- [ ] Token de cliente é revogável em Conexões, e depois de revogado a requisição volta 403
- [ ] Escopo `arquivo-local` nunca é concedido em pareamento; cliente externo com esse pedido recebe 403 ao chamar `/processar` com `caminho`
- [ ] `GET /v1/info` é pública e descreve versão, modo NLP, entidades, políticas, formatos e prontidão do OCR
- [ ] Preflight `OPTIONS` de uma extensão passa; origem `http://` de página comum não é aceita
- [ ] As rotas atuais continuam funcionando — o renderer não quebra

### CLI e MCP

- [ ] `tecjustica-sigilo autos.pdf` funciona, com OCR
- [ ] Com o app aberto a CLI delega por HTTP (motor quente); fechado, sobe em processo avisando o custo
- [ ] `--offline` e `--remoto` forçam cada modo
- [ ] O modo offline usa PP-OCRv6, **não** o Tesseract embutido no wheel
- [ ] A forma atual `tecjustica-sigilo arquivo.txt -o saida.txt` continua válida
- [ ] `tecjustica-sigilo mcp` responde às ferramentas `anonimizar_texto`, `ler_documento`, `ocr_imagem` e `status` num cliente MCP real

### Instalação

- [ ] Depois de instalar, `tecjustica-sigilo status` roda num `cmd` novo **sem** o usuário ter aberto a GUI
- [ ] Desinstalar remove a entrada do PATH
- [ ] `scripts/smoke-backend.sh` exige as rotas `/v1` e continua rodando dentro do `build:dist`

### Não regressão

- [ ] Suíte Python e `npm run test:electron` verdes
- [ ] Gate de acurácia ≥ baseline: 99,92% por ocorrência, 99,10% por valor único, com `modo_nlp` = `transformer` e o corpus comprovadamente lido

## Dependências

- `@fontsource-variable/petrona` 5.3.0 e `@fontsource-variable/azeret-mono` 5.3.0 (disponibilidade confirmada)
- `safeStorage` do Electron (já disponível — projeto em Electron 41)
- Pacote Python `mcp` — dependência de runtime nova, entra no `requirements.txt` **e** no `requirements-embed.txt`
- Modelos de OCR (`resources/ocr-models/*.onnx`) e `python-embed` presentes para build
- Corpus de acurácia apontado por `PRESIDIO_EVAL_CORPUS` para o gate de release

## Features Relacionadas

- Extensão de navegador para o PJe — passa a ter contrato para ser escrita (`docs/api-local.md`); a extensão em si fica fora desta spec
- Tarja de redação em PDF (queimar pixels, sanear metadados) — pendência anterior, não incluída
- Segundo passe do OCR para página ruim — pendência anterior, não incluída
- Os dois vazamentos residuais da auditoria de 14/08 (CPF truncado no fim da linha, nome partido na quebra) — continuam abertos, não são alvo desta spec
