# TecJustiça Sigilo — o que não está óbvio no código

Anonimizador de dados pessoais em processos judiciais brasileiros. Electron +
React + FastAPI + [Presidio](https://presidio.dataprivacystack.org/). Tudo roda
na máquina do usuário: nenhuma página sai daqui.

> O Presidio deixou de ser da Microsoft e virou projeto comunitário sob a **Data
> Privacy Stack** (licença MIT). Pacotes no PyPI e API continuam iguais, e o
> projeto o usa **em processo** — não há Docker aqui, então a mudança de
> registro (`mcr.microsoft.com` → `ghcr.io/data-privacy-stack`) não afeta nada.
> Documentação: `presidio.dataprivacystack.org`.

Este arquivo guarda o que custou caro descobrir. O resto está no código.

## Onde desenvolver

**No Windows.** É um aplicativo Windows e pelo WSL as medições que importam
ficam distorcidas: o `python.exe` embarcado lido pela ponte `\\wsl.localhost`
leva 20 s para carregar 31 MB de modelo (menos de 2 s no disco local) e mais de
2 minutos para importar o torch (~12 s local). Guia:
[`docs/desenvolvimento-windows.md`](docs/desenvolvimento-windows.md).

**Rodar a suíte não é a mesma coisa que abrir o app.** Os dois bugs mais graves
de agosto/2026 passaram por 110 testes verdes e só apareceram quando o usuário
instalou e usou. Antes de dizer que está pronto: abrir o app.

## O que não está no git e cada máquina precisa obter

| | Como |
|---|---|
| `resources/ocr-models/*.onnx` (163 MB) | `scripts/fetch-ocr-models.sh` |
| `resources/python-backend/python-embed/` (1,8 GB) | `scripts/setup-python-embed.sh` |
| `.venv/` | `pip install -r python-backend/requirements.txt` |
| BERT (~2,5 GB) | baixa sozinho na primeira execução, em `~/.cache/huggingface` |
| Corpus de OCR (22 PDFs reais, 125 MB) | não está em repositório nenhum — copiar entre máquinas à mão |
| Corpus de acurácia (3 processos do TJCE em markdown, 1,6 MB) | idem — são os documentos do gate |

Os dois corpora carregam dados pessoais reais, por isso ficam fora do git, e
cada um é apontado por uma variável:

| Variável | Aponta para | Sem ela |
|---|---|---|
| `PRESIDIO_CORPUS_OCR` | pasta com os PDFs escaneados | `eval/bench_ocr.py` não roda; nenhuma mudança de motor de OCR pode ser medida |
| `PRESIDIO_EVAL_CORPUS` | pasta com os três `.md` | o gate de acurácia é **pulado**, não reprovado |

Repare no modo de falha: ausência de corpus vira *skip*, e skip parece sucesso
em log corrido. Antes era pior — havia um caminho padrão absoluto da máquina de
origem, em formato WSL (`/mnt/c/...`), que no Windows não resolve para lugar
nenhum: o gate era pulado até onde o corpus existia, só que noutro diretório.
Agora não há padrão. Antes de confiar num "passou", confira que o corpus foi
lido.

O `MANIFESTO.json` **está** no git: é ele que pina versão e SHA-256 dos modelos.

## Armadilhas que já custaram bug

**Dependência que só existe no `.venv` mata o app instalado.** A rota `/ocr` usa
`multipart/form-data` e o FastAPI exige `python-multipart` para montá-la — falha
na *importação*, não na chamada. O pacote estava só no venv: todos os testes
passaram, o instalador foi entregue, e o backend morria na largada com a tela
presa em "Carregando motor de anonimização", sem erro visível. Defesa:
`scripts/smoke-backend.sh`, que o `build:dist` roda antes de empacotar. **Não
tirar do build.** Dependência nova de runtime entra no `requirements.txt` *e* no
`python-embed`.

**A distribuição embeddable do Python não tem pip.** `python.exe -m pip` responde
`No module named pip` — é esperado. Bibliotecas entram como wheels de Windows
resolvidos de fora, com `--platform win_amd64 --only-binary=:all: --no-deps` e
versões explícitas. Sem `--no-deps` o resolvedor traz numpy 2.5 e quebra o
presidio-analyzer, que exige `<2.5`.

**`--no-deps` desliga o resolvedor, e a conta chega calada.** O que não estiver
listado não entra, e ninguém reclama: o pip instala com sucesso, o script diz
"pronto" e o embarcado sai montado e quebrado. A lista era mantida à mão dentro
do `setup-python-embed.sh` e cobria cerca de um terço do fecho transitivo —
faltavam `thinc` (sem ele o spaCy não importa), `click` (sem ele o uvicorn não
importa) e mais de trinta pacotes. Por isso a lista virou lock versionado em
`python-backend/requirements-embed.txt`, tirado de um venv que comprova
funcionar. Mexeu no `requirements.txt`? Regere o lock — o cabeçalho dele diz
como.

**O `pt_core_news_lg` é pré-requisito dos dois modos, não só do leve.** No modo
BERT ele entra como *tokenizador* (`engine.py`, `_transformer_config`, chave
`"spacy"`), então sem ele nenhum dos dois motores sobe. Ele não vem por
dependência — o caminho normal é `spacy download`, que não existe no embarcado —
e por isso está fixado por URL no fim do lock. O `setup-python-embed.sh` e o
`smoke-backend.sh` carregam o modelo de propósito: import limpo e rotas
registradas não provam que o motor sobe.

**A mesma ocorrência era numerada de dois jeitos.** Na tela de Revisão, a lista
lateral identifica cada ocorrência por `entitiesFound.indexOf(e)` — posição no
array original — e a tarja no texto era marcada com a posição no array
**ordenado e filtrado** do `segmentar`. Só coincidem se o motor devolver tudo
ordenado por `start` e sem descartar nada; num documento de OCR não acontece.
Clicar no CPF na lista levava à tarja do nome. É o pior tipo de defeito aqui:
os dois números existem, são válidos, apontam para coisas diferentes, e nada
estoura — o revisor acredita ter conferido a ocorrência que pediu. O índice
original agora viaja junto no `segmentar`, antes de qualquer filtro.

**Um arquivo aparece em `processados` OU em `falhas`, nunca nos dois.** O
`push` do resultado acontece antes do despacho de "pronto"; com esse despacho
estourando, o mesmo documento entrava nas duas listas e a mensagem final
anunciava "1 de 2 processados" sobre um lote em que os dois passaram. O
`percorrerLote` marca `concluido` no ponto sem volta — depois dele, nada que
falhe transforma um documento processado numa falha. Achado pelo primeiro teste
de lote escrito, minutos depois de o harness existir.

**O renderer tem testes desde 30/08/2026** (`npm test`, vitest, recortado a
`src/`). Antes não tinha nenhum, e é por isso que os dois defeitos acima foram
achados lendo código em vez de por teste. Os três runners são separados de
propósito: o `test:electron` roda sobre JavaScript compilado e intercepta o
módulo `electron` no `require`, o que não faz sentido no vitest.

**A saída é texto, nunca o formato de entrada.** Gravar markdown num arquivo
`.pdf` produz um arquivo que nenhum leitor abre — foi o comportamento anterior,
para `.pdf`, `.docx`, `.xlsx` e imagens. A regra vive em `src/lib/nomeDeSaida.ts`
e não tem exceção: a extensão descreve o que o arquivo **é**.

**`127.0.0.1` não protege nada.** Qualquer página aberta no navegador alcança
portas locais, e `/processar` abre arquivo por caminho. Daí o token de sessão em
todas as rotas menos `/health`. Qualquer rota nova nasce atrás do token.

**O cabeçalho do token é o que exige CORS em dev.** `comTimeout` manda
`X-Presidio-Token` em *toda* requisição, `/health` inclusive. Cabeçalho
customizado torna a requisição não-simples: o navegador manda um `OPTIONS` de
preflight antes, e o backend não tinha o que responder. Em dev a interface vem
do Vite (`localhost:5173`) e o backend está em `127.0.0.1` — origem cruzada. O
preflight era reprovado, o `catch` do hook engolia o erro e a tela ficava presa
em "Carregando motor de anonimização" **com o backend perfeitamente no ar**, até
estourar os 180 s. Ou seja: a defesa criou a condição da falha. O `server.py` monta o CORS
**sempre** — o que é condicional é só a lista de origens de desenvolvimento
(`PRESIDIO_DEV_ORIGIN`). Empacotado essa lista sai vazia, e o que resta é o
regex `^chrome-extension://[a-p]{32}$`, que existe porque uma extensão passou a
ser cliente legítimo com a API v1. Nenhuma origem `http://` de página comum é
aceita, nem em desenvolvimento. A URL do Vite vive numa constante só
(`URL_DEV`, em `main.ts`) porque origem declarada e URL carregada têm de
coincidir — `localhost` de um lado e `127.0.0.1` do outro já reprova.

**Sem navegador não existe CORS**, e é por isso que os testes de rota passam:
eles falam HTTP direto com o backend. Só o renderer dentro do Chromium impõe a
regra sobre o que a página pode **ler**.

Mas metade da política é testável sem navegador, e está em
`tests/test_cors_extensao.py`: quem o backend autoriza no preflight. Os testes
negativos — página comum, `null`, `file://`, origem de extensão malformada —
são a metade que protege o usuário, porque `127.0.0.1` não impede a requisição
de chegar; o CORS decide quem lê a resposta. Provados por mutação: abrir o regex
faz oito dos dez falharem. O que continua exigindo humano é a metade positiva
com uma extensão instalada de verdade.

**O nome da pasta `userData` não é o que parece — confira, não deduza.**
`app.getPath("userData")` deriva de `app.getName()`, que lê o `package.json`
**embarcado**: `productName` se existir lá, senão `name`.

Aqui o `productName` está só no `electron-builder.yml`, e o `package.json` só tem
`name`. Resultado medido no instalador 1.3.0, rodando o app empacotado:
a pasta é **`tecjustica-sigilo`**, a mesma do desenvolvimento — **não**
`TecJustiça Sigilo`, como este arquivo afirmou até 30/08/2026.

O erro estava aqui como lição aprendida, com o motivo invertido, e sobreviveu
porque ninguém tinha rodado o app empacotado e olhado a pasta.

A defesa continua certa, e agora por um motivo mais honesto: **procurar nos dois
nomes** (`cliente_local.NOMES_DA_PASTA`). Não porque se saiba qual é qual, mas
porque isso depende de detalhe de empacotamento que muda sem aviso — mover o
`productName` para o `package.json` inverteria a resposta amanhã, e o cliente
externo não tem como saber.

**`app.routes` não enxerga rotas de router incluído.** O FastAPI atual mantém um
`_IncludedRouter` sem `path` no lugar das rotas expandidas, então uma checagem
por `app.routes` acha que as rotas `/v1` não existem. Quem precisa da lista de
verdade — o `smoke-backend.sh`, por exemplo — usa `app.openapi()["paths"]`.

**Classes de utilitário que nunca existiram.** O Tailwind v4 só gera utilities a
partir dos namespaces que conhece (`--color-*`, `--font-*`, `--text-*`,
`--radius-*`…). `--z-*` **não** é um deles: `z-sticky`, `z-overlay` e `z-toast`
estavam no CSS e no JSX desde a v1 e nunca produziram uma linha de CSS — o
navegador ignora classe inexistente sem reclamar. As camadas usam a escala
numérica (`z-10`, `z-100`, `z-200`). Pelo mesmo motivo, token alcançado por
`var()` a partir do JavaScript não pode depender do `@theme`: o Tailwind faz
tree-shaking do que nenhuma utility menciona, e uma string montada em runtime é
invisível para ele. Daí as 14 cores de entidade serem declaradas à mão no
`:root`.

## O instalador NSIS

O `build/installer.nsh` põe a CLI no PATH ao instalar e a tira ao desinstalar.
Ele **quebrava a geração do instalador inteiro**, e ninguém tinha visto porque o
`build:dist` nunca chegava ao passo NSIS nas tentativas anteriores. Dois
defeitos empilhados, os dois clássicos da linguagem:

**`${WordFind}` e `${WordReplace}` não são comandos do NSIS.** Vêm de
`WordFunc.nsh`, que precisa de `!include` **e** de um `!insertmacro` por função.
Sem isso o `makensis` aborta com `Error in macro customUnInstall`.

**Função usada no desinstalador precisa do prefixo `un.`** — declarada por
`!insertmacro un.WordReplace` e chamada como `${un.WordReplace}`. O NSIS compila
instalador e desinstalador como dois binários separados, e o segundo não enxerga
as funções do primeiro.

**E o arquivo precisa de BOM.** O `makensis` 3.0.4 sem BOM lê como ANSI e recusa
os acentos dos comentários em português com `Bad text encoding`. Gravar em
`utf-8-sig`.

**Verificado com o instalador REAL em 31/08/2026.** Instalar acrescenta a
entrada no PATH, o shim responde, e `tecjustica-sigilo status` roda num `cmd`
novo **sem a GUI aberta** — a cadeia inteira. Desinstalar devolve o PATH byte a
byte idêntico ao original.

Duas armadilhas na hora de testar isso: o instalador **ignora o `/D=` quando já
existe instalação registrada**? Não — ele honra, mas **remove a instalação
anterior** no processo. Verifique se há instalação prévia antes de apontar o
`/D=` para outro lugar, ou você troca a instalação do usuário por uma em pasta
temporária. E `du -sm` sobre a pasta instalada (2,3 GB) estoura o tempo de um
comando curto: acompanhe por um monitor, não por sondagem.

Antes disso, verificado também com um instalador mínimo que inclui as macros: instalar acrescenta a entrada (20 → 21 no PATH do usuário) e desinstalar
a remove, deixando o valor **byte a byte idêntico** ao original. Duas condições
que o teste precisa ter, e que custaram uma tentativa cada: `RequestExecutionLevel
user` (sem isso o NSIS pede elevação por padrão e o teste morre num UAC que
ninguém clica) e `SilentInstall silent`.

Um detalhe que a execução revelou: o gancho usa `WriteRegExpandStr`, então
**normaliza o PATH para `REG_EXPAND_SZ`** mesmo que estivesse como `REG_SZ`. É o
tipo correto para PATH — é o que permite `%USERPROFILE%` funcionar dentro dele —
mas note a diferença de política em relação ao `setUserPath` do `main.ts`, que
**preserva** o tipo original de propósito. As duas escolhas são defensáveis;
saber qual é qual evita concluir que uma delas está quebrada.

Dá para validar sem gastar um `build:dist` inteiro (que leva dezenas de minutos
até chegar lá): monte um `.nsi` mínimo que inclua o hook, chame as duas macros
**e um `WriteUninstaller`** — sem ele o NSIS avisa "Uninstaller script code
found but WriteUninstaller never used" e **não compila a seção de
desinstalação**, que é exatamente onde o defeito estava. Depois rode o
`makensis` do cache do electron-builder direto no arquivo.

## Portabilidade Windows

Quatro bugs numa única instalação limpa em 29/08/2026, todos em código que
nenhum teste exercita porque só roda no preparo ou no bootstrap.

**O Python tem de ser x64.** `torch`, `onnxruntime` e `spacy` não publicam wheel
`win32` nem sdist nas versões pinadas. Numa máquina com mais de um Python no
PATH — comum: um de 32 bits, mais o atalho da Microsoft Store — o venv pode
nascer errado. O erro engana: o pip recusa a versão pinada e lista as vizinhas
como disponíveis, o que parece pin removido do PyPI, quando as vizinhas só
aparecem porque publicam sdist. Sintoma real: `sysconfig.get_platform()`
devolvendo `win32`.

**O layout do venv difere por plataforma.** `Scripts/python.exe` no Windows,
`bin/python` no resto. O `main.ts` procurava só o segundo e caía no fallback
`python3`, que no Windows costuma ser o atalho da Store.

**Caminho do Git Bash não serve para `python.exe` nativo.** `/c/Users/...` vira
`C:\c\Users\...` e não existe. Converta com `cygpath -m`. Foi o que fazia o
`fetch-ocr-models.sh` recusar todo download com a mensagem de pin ausente.

**Gravação em modo texto reescreve fim de linha.** `Path.write_text` troca `\n`
por `\r\n` no Windows: mesmo conteúdo, outros bytes, outro SHA-256. Para
qualquer arquivo cujo hash é conferido, `newline="\n"` explícito.

## OCR

**PP-OCRv6** (pesos oficiais da PaddlePaddle em ONNX, Apache-2.0) sobre ONNX
Runtime em CPU. Substituiu o Tesseract em 29/08/2026: em matrícula de cartório
datilografada o Tesseract recuperava 17,7% das palavras. Texto não transcrito
não vaza — sai um documento mutilado parecendo completo, e nenhum recognizer
detecta o que o OCR não leu.

O liteparse **não aceita motor de OCR injetado em processo**. O único ponto de
extensão é `ocr_server_url` apontando para um `POST /ocr`, então a rota mora no
próprio backend, atrás do token, que o liteparse repassa em `ocr_server_headers`.

**Progresso página a página existe — o sinal sempre esteve lá.** O callback de
`documentos.extrair` disparava exatamente duas vezes, `(0,0)` e `(n,n)`, porque
o liteparse processa o documento inteiro numa chamada. Entre as duas, minutos de
tela imóvel dizendo "Lendo o documento": quem olha conclui que travou, com
razão. Mas toda página digitalizada passa pela rota `/ocr`, que já conta por
hash da imagem — bastava **ler o contador durante a corrida**, não só no fim.
Uma thread de vigília faz isso sem fatiar documento nenhum.

**Resolução alta parece melhor e não é.** O detector parte a linha em mais
caixas e um CPF atravessa duas; ponta a ponta, 16 ocorrências íntegras contra 6.
Ocorrência quebrada não casa com o recognizer e não é mascarada. Os valores
medidos estão comentados em `ocr_engine.py` — mexer neles exige rodar
`eval/bench_ocr.py` de novo.

**`cpu_count - 1` é a resposta errada duas vezes.** O `intra_op_num_threads` do
ONNX era 11 numa máquina de 12 threads, e isso é a **pior** configuração
possível — entre 2x e 5x mais lento que 4. O ONNX não distribui páginas entre
threads: ele fatia cada operação e **sincroniza numa barreira a cada camada**, e
numa barreira o grupo anda na velocidade da fatia mais lenta. O i5-12450HX tem 4
P-cores (8 threads lógicas) e 4 E-cores; com até 8 threads o escalonador mantém
tudo em P-core, com 11 ele é obrigado a derramar. Provado com afinidade de
núcleo: 4 threads só em E-core dão 13,78 s/página contra 5,89 s só em P-core, e
as mesmas 11 threads vão de 10,08 s para 6,83 s só por não encostarem nos
E-cores. Presas aos P-cores, 4/8/11 threads empatam — **subir de 4 nunca deu
ganho**. O texto reconhecido é idêntico; isto é só tempo.

Corolário: `THREADS_PADRAO = 4` é mitigação estatística, não a correção da
causa. A correção seria prender o OCR aos P-cores, e não cabe onde ele está — o
OCR roda no mesmo processo que o BERT e `SetProcessAffinityMask` no Windows
atinge todas as threads do processo. Sairia num processo separado.

O `_workers_padrao()` em `documentos.py` era o mesmo `cpu_count - 1`, e foi
medido em 30/08/2026: **3 workers ganha de 11 nos dois casos**, com texto
idêntico — 1,27x num documento digitalizado e **1,35x num nativo**, que foi
medido de propósito para testar a objeção óbvia (sem OCR não há lock, logo mais
workers deveriam ajudar; não ajudam, perdem por mais). A variância repete a
assinatura: 3 workers dá 61,31 e 61,15 s; 11 dá 83,69 e 81,65 s.

Não confie nos números absolutos de OCR deste notebook fora do ranking: a mesma
medição deu de 4,7 s a 20,7 s conforme o estado térmico. Meça sempre em ordem
direta **e** inversa, e compare medianas.

**A rota `/ocr` do modo offline respondeu 500 em toda chamada, sem ninguém
notar.** `ocr_engine.py` tem `from __future__ import annotations`, então as
anotações da rota chegam ao FastAPI como strings, e o Pydantic resolve string de
anotação nos **globais do módulo** — nunca nos locais da função onde a rota foi
definida. Com o `import` do FastAPI dentro da função, `UploadFile` virava um
ForwardRef que não resolvia, e o erro estourava na validação do corpo, antes do
`try` do handler. O `server.py` escapa por dois motivos que se somam: não tem o
`from __future__` e importa o FastAPI no topo.

O estrago era invisível pelo motivo abaixo: com o OCR morto o liteparse não
falha. O mesmo documento saía com 3.800 caracteres em vez de 55.453. Importar o
módulo não pega — as rotas registram normalmente. Só chamar pega, e é por isso
que existe `tests/test_servidor_ocr_offline.py`.

**O contador de páginas vive no processo que atende `/ocr` — e nem sempre é o
que extrai.** No aplicativo é o mesmo processo, então o dicionário de módulo
funciona. No modo offline o `MotorLocal` sobe o servidor num `subprocess`:
`registrar_atendimento` roda lá e a leitura vinha daqui, sempre zero. Efeito:
**alarme falso em todo documento digitalizado** pela CLI e pelo MCP — "as
páginas não chegaram ao motor de OCR, o texto delas não está neste resultado"
sobre um documento lido inteiro. Agora `_reconhecidas` pergunta a quem contou,
por HTTP (`/contagem` no servidor autônomo, `/contagem-ocr` no `server.py`).

Cuidado ao mexer nisso: quando a consulta **falha**, a resposta certa é zero, e
o alarme deve subir — servidor que não responde está fora do ar e não reconheceu
nada. Uma primeira versão do conserto devolvia "não sei" e mandava calar na
dúvida, o que suprimia o aviso exatamente na situação que ele existe para
denunciar. "Na dúvida não afirme" é boa regra para afirmar fato e péssima para
calar alarme.

**`ParseResult.page_errors` NÃO cobre falha de OCR.** Com o motor fora do ar o
liteparse termina sem erro e a página sai com o resto de texto nativo: o app
declarava "1 de 1 página lida por OCR" sobre uma página vazia. Por isso o
backend conta as páginas que realmente reconheceu, indexadas por hash da imagem
(não por número de chamadas — o liteparse repete página, e uma repetida
compensaria outra perdida).

## Acurácia

Gate: `PRESIDIO_EVAL_CORPUS=<pasta> python -m eval.run_eval`, de dentro de
`python-backend`. Baseline a bater: **99,92% por ocorrência, 99,10% por valor
único**, no modo BERT. Confira `modo_nlp` dentro do JSON — se o motor cair para
spaCy, o arquivo sai com números de spaCy.

**Gate completo na v1.3.0, 30/08/2026** (modo `transformer` nos três documentos,
14 entidades da interface, 819 páginas, 66 min):

| documento | ocorrências | valores únicos | escapes |
|---|---|---|---|
| `civel_0200161` | 747 / 747 | 87 / 87 | 0 |
| `juri_19-08` | 2.237 / 2.237 | 166 / 166 | 0 |
| `expedientes_13-08` | 629 / 631 | 77 / 79 | 2 |
| **total** | **3.613 / 3.615 — 99,94%** | **330 / 332 — 99,40%** | **2** |

Acima da baseline (99,92% / 99,10%) nos dois critérios. Os dois escapes são
exatamente os residuais que a auditoria de 14/08 já descrevia — o CPF
`004.811.253-` cortado no fim da linha e `ELIONEUDO EVARISTO DE`, nome partido
na quebra. Nenhum tipo novo.

**A contagem por ocorrência saiu idêntica à da v1.2.0** — os mesmos 3.613/3.615,
numerador e denominador. Serve de referência para uma pergunta que aparece toda
entrega: "mexer em X afetou a acurácia?". Aqui as nove correções do dia mexeram
em threads de OCR, paralelismo de páginas, rota de OCR offline, progresso, cofre,
CLI, descoberta e interface — e nenhuma tocou a detecção. A medição confirma o
que o diff sugeria.

Custa ~66 min de CPU. Não é gate de cada commit, é gate de release. E **não roda
como tarefa de fundo do harness**: aquelas morrem na virada do turno. Um processo
destacado pelo sistema operacional sobrevive:

```powershell
$env:PRESIDIO_EVAL_CORPUS = "<pasta>"; $env:PRESIDIO_NLP_MODE = "transformer"
Start-Process -FilePath "<venv>\Scripts\python.exe" `
  -ArgumentList "-u","-m","eval.run_eval","--json","$env:TEMP\gate.json" `
  -WorkingDirectory "<repo>\python-backend" `
  -RedirectStandardOutput "$env:TEMP\gate.log" -WindowStyle Hidden
```

Termos novos vão em `python-backend/config/deny_list.json`, não hardcoded;
palavras de contexto em `config/context_words.json`. Documentos brasileiros usam
dígito verificador (`validators.py`) para elevar score ou descartar falso
positivo.

## Cofre

Guarda o texto original e as ocorrências para a revisão poder ser reaberta. Isso
**é** o índice pesquisável de CPFs que o produto existe para evitar, e a decisão
foi tomada com o custo à vista — o que a torna defensável não é opcional:
`safeStorage` (DPAPI) cifrando conteúdo **e** índice, desligado por padrão,
consentimento explícito na primeira gravação, expurgo automático (30 dias).

**Falha fechada:** com `isEncryptionAvailable()` falso, o cofre **recusa
gravar**. Nunca grava em claro. Mesma cultura do `fetch-ocr-models.sh`, que
recusa download sem pin.

**O limite, que precisa estar escrito na interface:** DPAPI protege contra outro
usuário da máquina e contra leitura do disco fora do sistema. **Não** protege
contra programa malicioso rodando como o próprio usuário.

Armadilhas de integridade, todas cobertas por teste em `cofre.test.mjs`, e cada
guarda provada por mutação:

**Gravar por cima de um índice ilegível** apagaria a referência a tudo que já
está guardado — acontece quando o perfil do Windows muda. A guarda existia em
`gravar` e **faltava em `apagar`**, que com índice ilegível gravava uma lista
vazia por cima: apagava um documento e perdia todos.

**A ordem é espelhada.** `gravar` põe o conteúdo antes do índice; `apagar` e
`expurgar` põem o índice antes do conteúdo. Os dois pelo mesmo motivo: o índice
nunca pode apontar para arquivo que não existe. Na ordem errada, apagar não tem
rollback — arquivo apagado não volta.

**Ausência de referência não prova que o arquivo é lixo.** A primeira tentativa
de recolher restos varria a pasta apagando todo `.bin` que o índice não
mencionasse. Com o `indice.bin` **apagado** (antivírus, restauração parcial de
perfil), `indiceIlegivel()` devolve `false` — arquivo ausente não é arquivo
ilegível — e `listar()` devolve `[]`: todo documento vira órfão e a faxina apaga
a biblioteca inteira. Por isso a limpeza trabalha com uma **fila explícita**
(`pendentes.bin`) do que alguém mandou apagar e não saiu. Perder o índice não
destrói mais nada.

`limparPendentes` roda no boot, no main — ao contrário do expurgo, ela não
depende de preferência do usuário.

**O expurgo roda no renderer, nunca no main.** O prazo é preferência do usuário,
e o processo principal não a lê: um `expurgar(30)` no boot apagaria documentos
60 dias antes da hora de quem configurou 90.

## API local v1

`sessao.json` no `userData` publica **porta e pid, nunca o token**. É a fronteira
do desenho: página de navegador não lê arquivo, programa local lê. Quem descobre
a porta ainda precisa parear, com aprovação humana e código conferido nos dois
lados.

**Status 200 não prova que é este aplicativo.** O `sessao.json` fica órfão sempre
que o app morre sem passar pelo `before-quit`, e a porta volta ao pool. Um
cliente que confia no código de status manda os autos para o programa que ficou
com ela. Todo cliente confere a identidade em `GET /v1/info` (`produto` e `api`)
antes de enviar conteúdo — `cliente_local.app_no_ar`. Não se confere o pid: ele
é reciclado pelo sistema, e `os.kill(pid, 0)`, o idioma POSIX para "existe?", no
Windows chama `TerminateProcess` e **mataria o app**.

**Quem fala com o app usa a rota do app.** O servidor MCP extraía documento no
próprio processo mesmo com o aplicativo aberto — e quem chama
`documentos.configurar_ocr` é o `MotorLocal`, que só entra quando o app está
*fechado*. Resultado: o liteparse caía no OCR embutido, sem erro nenhum. O envio
mora em `cliente_local.enviar_documento`, e é por lá que CLI e MCP passam.

**`arquivo-local` nunca é concedido em pareamento.** Cliente externo manda o
conteúdo; quem abre arquivo por caminho continua sendo só a janela. `escopo_da_rota`
em `clientes.py` mapeia apenas três rotas — tudo que não estiver lá fica fora do
alcance de cliente externo **por omissão**, o que é o padrão certo: rota nova
nasce inacessível.

**Dois detalhes do MCP que custaram diagnóstico errado**, ambos travados em
`tests/test_mcp_protocolo.py`:

O cliente **tem** de mandar `notifications/initialized` depois do `initialize`.
Sem ela, o SDK oficial responde `-32602 Invalid request parameters` à primeira
chamada seguinte e **para de responder**. Parece servidor quebrado; é o aperto
de mão incompleto.

E não dá para testar despejando tudo no stdin e fechando. O SDK encerra a sessão
ao ver EOF e **cancela as chamadas em voo** — como toda ferramenta roda numa
thread (algumas levam minutos), um `tools/call` simplesmente nunca responde.
Parece `tools/call` quebrado; é o canal fechado cedo demais. O teste mantém o
processo aberto e lê enquanto escreve, como um cliente de verdade.

Contrato completo para quem for escrever cliente: [`docs/api-local.md`](docs/api-local.md).

**`--in-place` na CLI só vale para texto.** A opção era inofensiva quando a CLI
só lia `.txt`; ao ganhar leitura de PDF, passaria a gravar markdown por cima dos
autos originais. A recusa vem antes de qualquer trabalho — validar depois de
OCRizar 800 páginas seria cobrar minutos para então dizer que não dá.

**E a guarda não pode olhar para o nome da opção.** `-o autos.pdf` faz a mesma
destruição e escapava — a mensagem de erro do `--in-place` chegava a *sugerir*
`-o`. Quem decide é o arquivo que vai ser aberto para escrita, comparado com
`samefile`, que resolve link, junction e a diferença de maiúsculas do NTFS.
Comparar strings não resolve.

## Pendências

- Segundo passe do OCR para página ruim. Medido: subir a resolução do `small`
  rende mais que trocar para o `medium`, pela metade do tempo.
- Tarja de redação em PDF (queimar pixels, sanear metadados, verificar resíduo).
  O `presidio-image-redactor` **não** serve de atalho: roda sobre Tesseract, o
  motor descartado por recuperar 17,7% em datilografado, e não aceita OCR
  injetado.
- Extensão de navegador para o PJe — o **contrato existe** (`docs/api-local.md`)
  e a escolha foi HTTP local com pareamento; falta escrever a extensão.
- Os dois vazamentos residuais da auditoria de 14/08 **continuam**, reconferidos
  com o motor de OCR novo em 29/08/2026. Ambos em `expedientes_13-08`: o CPF
  `004.811.253-` cortado no fim da linha, com o dígito verificador na linha
  seguinte, e `ELIONEUDO EVARISTO DE`, nome partido na quebra. São entidades
  interrompidas no meio do texto — a janela com sobreposição resolve o caso de
  linha adjacente, não o de token truncado. Nenhum outro tipo vaza: CEP, CNJ,
  CNPJ, e-mail, OAB, RG e telefone deram 100% nos três documentos.
