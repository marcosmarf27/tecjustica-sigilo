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
| BERT (~433 MB) | baixa sozinho na primeira execução, em `~/.cache/huggingface` — revisão pinada por SHA em `engine.py` |
| Corpus de OCR (22 PDFs reais, 125 MB) | não está em repositório nenhum — copiar entre máquinas à mão |
| Corpus de acurácia (3 processos do TJCE em markdown, 1,6 MB) | idem — são os documentos do gate |

Os dois corpora carregam dados pessoais reais, por isso ficam fora do git, e
cada um é apontado por uma variável:

| Variável | Aponta para | Sem ela |
|---|---|---|
| `PRESIDIO_CORPUS_OCR` | pasta com PDFs escaneados | `eval/bench_ocr.py` não roda; nenhuma mudança de motor de OCR pode ser medida |
| `PRESIDIO_EVAL_CORPUS` | pasta com os três `.md` | o gate de acurácia é **pulado**, não reprovado |

Repare no modo de falha: ausência de corpus vira *skip*, e skip parece sucesso
em log corrido. **E há um caso pior que a ausência: a variável definida
apontando para a pasta errada.** Aí não falta configuração — falta o arquivo
onde ela manda procurar, e quem configurou acredita que a verificação
aconteceu. O `run_eval` já tratava isso (imprime "Corpus não encontrado em
&lt;pasta&gt;" e sai com código 2), mas o `test_deteccao_ocr.py` pulava nos dois
casos. Agora ele distingue: variável ausente **pula**, variável mal configurada
**reprova**.

E o teste deixou de exigir um **nome de arquivo**. Ele afirma só que um PDF
escaneado real é reconhecido como tendo passado por OCR — nada sobre qual
documento —, mas o nome `06-matricula-pg4-ruim.pdf` estava cravado, e com isso
uma pasta cheia de escaneados era rejeitada por não ter aquele nome exato. Hoje
serve **qualquer** PDF sem camada de texto; o arquivo de referência continua
preferido quando existe, por ser a pior página do corpus.

Efeito prático nesta máquina: apontando `PRESIDIO_CORPUS_OCR` para um processo
real do PJe, a suíte vai de "155 passando, 2 pulados" para **157 passando, zero
pulos**. Antes era pior — havia um caminho padrão absoluto da máquina de
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

**O Presidio aplica `re.IGNORECASE` global em todo pattern — regex case-sensitive vira catch-all.**
O recognizer `nome_antes_papel` foi desenhado para "FULANO DE TAL (ADVOGADO)"
com classes `[A-Z]`, mas a caixa alta do regex não significa nada ali: casava
**qualquer** duas palavras antes de um parêntese — "relatório técnico (art.
33…)", "devido processo legal (§…)" entravam como `PERSON` a 0,6, e o
gazetteer multiplicava cada falso positivo pelo documento. Numa decisão real,
26 de 29 valores únicos de PERSON eram frase jurídica. A primeira suspeita —
"o modelo NER está ruim" — estava **errada**: rodando os dois modelos com o
mesmo recognizer, o lixo saía idêntico; o modelo direto, sem o recognizer,
não produzia nenhum. Foi preciso fazer o analyzer nomear o culpado
(`return_decision_process=True`) para ver que a origem era um pattern. O
recognizer foi removido em 02/09/2026 (lição comentada em `recognizers.py`):
nome é papel do NER e do recognizer ancorado em rótulo textual. Duas defesas
irmãs vieram no mesmo conserto: **score é por ocorrência** — `_fundir_spans`
guardava o máximo do tipo no documento inteiro e toda tarja exibia a mesma
nota (o revisor via 100% de confiança em lixo, sem como priorizar) — e **run
de 1 caractere não é entidade** — o piso do `_aparar` não alcançava os runs
que `_fundir_spans` quebra em cada `\n`, e um fragmento de OCR entre duas
quebras virava ocorrência "PERSON" de uma letra. Os três têm teste em
`tests/test_scores_por_ocorrencia.py`.

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

**Autossuficiência conferida em 31/08/2026.** "Máquina limpa" é aproximação de
uma pergunta concreta: *o app instalado depende de algo que só existe na máquina
de desenvolvimento?* Isso se testa sem máquina nenhuma — monte um ambiente sem a
entrada de desenvolvimento no PATH e rode o instalado. Feito: o CLI instalado
anonimizou um documento inteiro com o motor do `python-embed`, e o shim não
menciona o repositório nem o `.venv`.

Sobre o cache do HuggingFace (~2,5 GB do BERT): é de **usuário**, não do
repositório. Numa máquina sem ele e sem rede, o motor **cai para o spaCy e diz
por quê** — verificado em 31/08/2026 com `HF_HOME` numa pasta vazia e
`HF_HUB_OFFLINE=1`. O `motivo_fallback` chega ao `/health` (que a interface lê
para montar o `avisoDeModo`) e ao `/v1/info`. Isso importa mais que o download:
anonimizar com qualidade de spaCy acreditando ter BERT é o risco de verdade, e é
o que a degradação silenciosa causaria.

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

**E o checkout reescreve na outra direção — o que quebrava o `build:dist`
inteiro.** Descoberto em 31/08/2026, na primeira tentativa de gerar o instalador
depois das correções da madrugada. Os quatro `scripts/*.sh` estavam **100% em
CRLF no disco**, embora os blobs no repositório sempre tenham sido LF puro: quem
converteu foi o `core.autocrlf=true` desta máquina, e não havia `.gitattributes`
para impedir.

Isso ficou latente por dias, e o motivo de ficar latente é o mais instrutivo:
**bash não é bash.** O do Git (`x86_64-pc-msys`) tolera o CR e roda o script sem
reclamar — é por ele que passa todo comando digitado num terminal. O do WSL
(`x86_64-pc-linux-gnu`, em `C:/Windows/System32/bash.exe`) é Linux puro e aborta
na linha 18:

```
scripts/fetch-ocr-models.sh: line 18: set: pipefail
: invalid option name
```

A quebra de linha no meio da mensagem **é** o CR devolvendo o cursor. E qual dos
dois roda depende de quem invoca: rodando `npm run build:dist` a partir do
PowerShell, o `bash` do `System32` vem antes no PATH; do Git Bash, não. O mesmo
comando, na mesma máquina, com dois desfechos.

Dois consertos, porque são dois problemas:

- `.gitattributes` com `*.sh text eol=lf` — vence sobre o `autocrlf` e
  materializa LF em qualquer máquina. É a correção de fundo.
- **O build precisa do Git Bash no PATH, à frente do `System32`.** Só o LF não
  basta: com o WSL o script passa da linha 18 e falha adiante dizendo
  `MANIFESTO.json ilegível em /mnt/c/...` e `SEM PIN`, que lido sozinho parece
  corrupção dos modelos. Os scripts usam `cygpath` (que não existe no WSL) e o
  `python.exe` do Windows — é o cenário que a seção *Onde desenvolver* proíbe,
  chegando disfarçado de erro de dados.

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

## Capacidade: quanto custa processar

Medido em 31/08/2026 sobre um processo real do PJe inteiro — 19 peças, 97
páginas (53 dependendo de OCR), 242 mil caracteres —, com a máquina folgada
(5,4 GB livres) e o motor no modo `transformer`.

| | |
|---|---|
| lote completo | 12,9 min |
| por página | 8,0 s |
| **páginas por hora** | **452** |
| leitura + OCR | 373 s (48%) |
| detecção | 399 s (52%) |
| carga do motor | 3,3 s, uma vez por processo |

**O preditor do custo é o CARACTERE, não a página — e muito menos o OCR.**
Correlação com o tempo total, nas 19 peças:

| preditor | correlação |
|---|---|
| caracteres | **0,927** |
| páginas | 0,508 |
| páginas de OCR | **0,192** |

Daí a unidade de dimensionamento ser **~3,2 s por mil caracteres**, e não
segundos por página: a fórmula por caractere sobrevive à mudança da mistura de
peças, a por página não.

> **Re-medido em 02/09/2026 com o BERT base** (troca registrada em Acurácia): a
> detecção caiu para **~0,94 s/1000 caracteres** — o gate completo (1,64M
> caracteres, 819 páginas) rodou em 25,7 min. O coeficiente por caractere
> continua sendo o preditor; o valor muda com o modelo, e cada troca de modelo
> pede re-medição.

O custo por tipo de página sai **invertido** em relação à intuição:

| | medido |
|---|---|
| página nativa | 14,0 s |
| página escaneada | 3,9 s |

Os dois extremos do lote explicam sozinhos: um anexo de 22 páginas todas
escaneadas, com 1.315 caracteres por página, deu 2,2 s/página; um documento
constitutivo de 2 páginas nativas, com 24.164 caracteres por página, deu
**79,9 s/página**. Um documento de identidade escaneado tem vinte palavras; um
contrato tem vinte e quatro mil caracteres. O OCR cobra pela imagem, a detecção
cobra pelo texto, e a detecção leva mais da metade do tempo.

**O erro de amostragem que produziu a conclusão contrária, e que vale evitar.**
A primeira medição usou "um documento nativo e um escaneado", o que parecia
justo. Só que a escolha foi uma petição nativa (densa) e uma procuração
escaneada (também densa): sem querer, o texto ficou constante e só o OCR variou
— e a conclusão inevitável foi "o OCR é a variável". O lote real desfaz isso
porque traz as combinações que ninguém escolheria de propósito: escaneado
esparso e nativo densíssimo no mesmo pacote. **Amostra representativa é a que
chega, não a que se monta.**

### A memória domina a variação, e não é sutil

Três medições de naturezas diferentes, no mesmo dia, apontando para o mesmo
mecanismo:

| ensaio | efeito |
|---|---|
| mesma extração, com e sem o BERT residente (não usado na etapa) | 1,48x |
| mesma detecção, mesmo texto, corridas diferentes | 3,9x (59,9 s → 15,5 s) |
| instalador NSIS, máquina saturada vs. livre | **15x** (110 min → 7,3 min) |

O caso do instalador é o mais didático porque a magnitude não deixa margem: o
mesmo `Setup.exe`, na mesma máquina, na mesma sessão, escrevendo a 2,1 MB/s com
a RAM em 0,1 GB livre e a 31,5 MB/s depois que os processos pesados saíram.

Duas consequências práticas:

- **Medir com a máquina ocupada mede a paginação, não o motor.** Antes de
  qualquer benchmark: fechar navegador e `wsl --shutdown` (a VM do WSL sobrevive
  ao fechamento do terminal e segura mais de 1 GB).
- **Na faixa em que a memória acaba, o desempenho não degrada suavemente — ele
  desaba.** É o que torna "16 GB dá conta" uma frase perigosa.

O medidor de capacidade fica em `eval/` do scratchpad da sessão, não no
repositório: ele aponta para corpus com dados pessoais reais.

## Acurácia

Gate: `PRESIDIO_EVAL_CORPUS=<pasta> python -m eval.run_eval`, de dentro de
`python-backend`. Baseline a bater: **99,97% por ocorrência, 99,70% por valor
único**, no modo BERT. Confira `modo_nlp` dentro do JSON — se o motor cair para
spaCy, o arquivo sai com números de spaCy.

**Troca de modelo em 02/09/2026: pierreguillou-large → dominguesm/legal-bert-ner-base-cased-ptbr**
(revisão `44210927c925448df025985e0ed48081bb5ac57c`, pinada em `engine.py`;
atribuição CC BY 4.0 no `NOTICE` da raiz). Motivos: domínio jurídico (treinado
em ~1M de peças do STF), PESSOA F1 0,969 auto-relatado, licença explícita — o
anterior não declara licença — e BERT base no lugar do large. A troca **não**
consertou os falsos positivos que motivaram o ciclo: o A/B das 43 peças do
processo 0201848 deu output de lixo **idêntico** nos dois modelos, porque o
lixo nascia num recognizer de padrão, não no NER (ver a armadilha do
`re.IGNORECASE` adiante). O comparador ficou em `eval/comparar_modelos.py` —
um processo por modelo, nunca dois BERTs na memória.

**Gate completo no modelo novo, 02/09/2026** (modo `transformer`, 14 entidades
da interface, 819 páginas, 25,7 min):

| documento | ocorrências | valores únicos | escapes |
|---|---|---|---|
| `civel_0200161` | 747 / 747 | 87 / 87 | 0 |
| `juri_19-08` | 2.237 / 2.237 | 166 / 166 | 0 |
| `expedientes_13-08` | 630 / 631 | 78 / 79 | 1 |
| **total** | **3.614 / 3.615 — 99,97%** | **331 / 332 — 99,70%** | **1** |

Acima da baseline nos dois critérios. O escape `ELIONEUDO EVARISTO DE` (nome
partido na quebra de linha, residual da auditoria de 14/08) **desapareceu** —
PERSON fechou 100% nos três documentos. O único escape é o CPF `004.811.253`
cortado no fim da linha, o mesmo de sempre. O denominador de valores únicos de
`juri_19-08` voltou a 166 — a oscilação de gabarito entre corridas já anotada
abaixo continua sem investigação.

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

**Reconferido em 31/08/2026, depois do rebuild do instalador** — mesma pergunta,
terceira resposta igual. Modo `transformer` nos três documentos, 55,3 min:

| documento | ocorrências | valores únicos | escapes |
|---|---|---|---|
| `civel_0200161` | 747 / 747 | 87 / 87 | 0 |
| `juri_19-08` | 2.237 / 2.237 | 167 / 167 | 0 |
| `expedientes_13-08` | 629 / 631 | 77 / 79 | 2 |
| **total** | **3.613 / 3.615 — 99,94%** | **331 / 333 — 99,40%** | **2** |

A contagem por ocorrência saiu **outra vez** idêntica: 3.613/3.615 pela terceira
medição seguida, atravessando v1.2.0, v1.3.0 e o rebuild. Os dois escapes são os
mesmos de sempre, com o mesmo texto — `004.811.253` cortado antes do dígito e
`ELIONEUDO EVARISTO` partido na quebra.

Uma diferença pequena e honesta: os valores únicos deram **331/333** contra os
330/332 registrados acima, e a diferença inteira está no `juri_19-08` (167 contra
166). Um valor único a mais no gabarito, e protegido — o percentual não se move
(99,40% nos dois casos). Não investigado; fica anotado porque contagem de
gabarito que muda sozinha entre corridas do mesmo arquivo é o tipo de coisa que
vale conferir se alguém voltar a mexer nisso.

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

## Conversar com os autos (v1.4.0)

O primeiro recurso que **manda dado para fora**. Até aqui o pior defeito
possível entregava um documento mal anonimizado ao próprio usuário; agora ele
manda dado sigiloso para a internet. Tudo abaixo existe por causa dessa
mudança de natureza.

O que sustenta a decisão é a Resolução CNJ 615/2025: dado sigiloso pode ser
processado fora desde que anonimizado. O produto inteiro existe para fabricar
exatamente esse artefato — a conversa é o primeiro consumidor dele.

**A peça mais difícil já existia, e ninguém tinha percebido.** O `Mascarador`
(`mask_config.py:278-284`) numera por valor e mantém o número estável dentro do
documento: `[PESSOA_1]` é sempre a mesma pessoa. Sem isso não haveria conversa
possível — só com rótulo genérico, o modelo não distingue autor de réu.

**Mas a numeração é por documento, e isso quebra o caso real.** `Mascarador` é
instanciado por chamada de `anonymize()` e descartado (`engine.py:591`). Juntar
a petição e a procuração como estão no cofre entrega ao modelo um texto em que
`[PESSOA_1]` designa duas pessoas diferentes — e ele responde com confiança
sobre quem assinou o quê, trocando as pessoas. Não estoura nada.

`electron/pseudonimos.ts` dá a todas as peças um espaço de numeração comum,
**traduzindo rótulo para rótulo**. A entrada é o texto já anonimizado e a saída
é o mesmo texto com outros números: o `textoOriginal` não é lido em ponto
nenhum desse caminho, e por isso o pior defeito ali produz um rótulo errado, e
não um vazamento. Efeito colateral bom: o autor que aparece nas 19 peças passa
a ter **um** rótulo no processo inteiro, coisa que a anonimização
documento-a-documento não entrega.

**A pergunta do usuário é o vetor de vazamento, não o documento.** O documento
foi anonimizado com cuidado; a pergunta é digitada com os dados reais na frente
("o CPF 123.456.789-00 do João aparece?"). Ela passa pelo detector antes de
sair. E há uma armadilha: chamar `/anonymize` com a pergunta isolada **não
resolve**, porque o `Mascarador` recomeça do 1 e o `[PESSOA_1]` da pergunta
seria outra pessoa que a do contexto. O backend é usado como **detector**, e o
`anonymized_text` da resposta é descartado — a numeração é feita no Electron,
contra o mapa da conversa.

**Numerar e substituir são duas passadas.** A numeração segue a ordem de
leitura; a substituição vai de trás para frente, para não deslocar offsets.
Fundir as duas inverte os números de duas entidades na mesma frase. O
`_aplicar_mascaras` já avisava isso em comentário (`engine.py:756-760`), e a
primeira versão do `prepararPergunta` errou mesmo assim — pego pelo teste das
entidades coladas.

**O cofre esquecia quatro coisas que decidem se o documento pode sair.** Nem
`EntradaDoCofre` nem `ConteudoDoCofre` guardavam `politicaMascara`,
`entidadesSolicitadas`, `modoNlp` nem `valoresDistintos`. A pior é a segunda:
`porTipo` conta o que foi **encontrado**, então a ausência de `LOCATION` ali é
ambígua entre "não pedi" e "não achei" — e um documento anonimizado com
`LOCATION` desmarcado carrega endereços em claro. O conserto não tocou o
Python: `/processar/{job}/resultado` já devolvia o dicionário inteiro
(`server.py:409-429`), e os campos eram descartados em `useLote.ts` por não
estarem declarados. Campo ausente = desconhecido = recusa ou aviso, nunca
`?? "placeholder"`.

**Nome de arquivo e CNJ são dado pessoal.** O caminho óbvio — cabeçalhar cada
peça com `nome (processo CNJ)` — desfaria a anonimização de graça, e o
`cofre.ts:42-45` já dizia por que o índice é cifrado. Pior: o CNJ é uma das 14
entidades mascaradas dentro do texto. No prompt vão `Documento 1`,
`Documento 2`; os três valores (nome, CNJ, caminho) entram no conjunto proibido
da trava.

**Lista embutida de provedores ZDR envelhece e vira alarme falso.** A primeira
versão cravou dezesseis provedores, tirados da documentação. Na primeira sonda
real, o roteamento mandou o DeepSeek V4 Flash para a **OpenInference** e o
alarme disparou. Estava errado: `/api/v1/endpoints/zdr` tem **816 endpoints de
50 provedores**, e a OpenInference tem exatamente um — justamente aquele
modelo. O `zdr: true` foi honrado; desatualizado estava o aplicativo. A lição
não é completar a lista: **alarme falso é desligado na primeira semana**, e aí
a defesa some. A lista passou a ser buscada da API, com a embutida só de
reserva para quando não houver rede.

**`net.fetch`, não o `fetch` do Node.** O primeiro usa a pilha do Chromium e
respeita proxy do sistema e certificados do Windows; o segundo não. Numa
máquina de vara atrás de proxy corporativo com inspeção TLS, o recurso
funcionaria aqui e falharia lá, com erro de certificado que parece problema do
OpenRouter. A exceção é a chamada ao backend local, que usa o `fetch` do Node
de propósito — para o proxy não tentar rotear `127.0.0.1`.

**A CSP precisa estar no HTML, não só no cabeçalho.** `onHeadersReceived` não é
acionado de forma confiável para respostas `file://`, que é como a janela
carrega empacotada. Só por cabeçalho, a política valeria em desenvolvimento e
sumiria na versão instalada — a mesma classe do `z-sticky` que nunca gerou uma
linha de CSS. As duas camadas existem: a `<meta>` do `index.html` é o chão.

**Nada de compressão de contexto.** O plugin `context-compression` do OpenRouter
trunca o **meio** do prompt quando ele não cabe, e a resposta sai confiante
sobre metade do processo. Ele só é automático em endpoints de ≤8 mil tokens, e
todos os modelos aceitos aqui têm 1 milhão — sem o plugin, prompt grande demais
falha com erro, que é o desfecho certo. Não declarar nunca.

**Sem RAG, e a medição justifica.** Os três documentos do corpus de acurácia
somam 1.683.252 caracteres (~480 mil tokens) contra 1 milhão de contexto. Um
índice vetorial de trechos de autos seria mais uma estrutura guardando dado
pessoal — o que o Cofre custou tanto a justificar — para resolver um problema
que não existe nesta escala.

Conversas vivem só em memória e morrem com o app, pelo mesmo motivo.

### A trava bloqueava o próprio produto (01/09/2026)

A primeira conversa real não saiu: `um valor do tipo "LOCATION" apareceu no que
seria enviado (posição 1209)`. Nenhuma das camadas estava com defeito — a trava
achou mesmo o que disse ter achado. O erro era de escopo, e em dois lugares.

**A trava varria texto que o próprio aplicativo escreve.** A instrução do
sistema fala em "documento", "peça" e termina em "Responda em português do
Brasil". Basta o motor ter rotulado uma dessas palavras como `LOCATION` em
qualquer ponto do processo para ela entrar na lista de proibidos e a trava
encontrá-la ali. Medido: `"Brasil"` bloqueia na posição 1066, dentro da
instrução. Uma trava que dispara sobre a própria frase é desligada na primeira
semana, e aí não há trava nenhuma. `verificarSaida` passou a aceitar **regiões
isentas**, definidas pela ocorrência literal de uma constante do programa —
nada que o usuário forneça cai dentro delas. O teste que importa é o negativo:
o mesmo valor **fora** da região continua bloqueando.

**E a isenção não funcionava no aplicativo — só no teste.** A trava verifica o
corpo **serializado**, e o JSON reescreve o texto: quebra de linha vira `
`
(dois caracteres), aspas viram `\"`, barra vira `\`. A instrução real tem
parágrafos; a do teste tinha uma linha. `localizarIsentas` procurava a
constante crua no JSON, nunca a achava, e a trava seguia bloqueando "Brasil"
na posição 1037 — o mesmo defeito que a isenção existia para consertar, com
83 testes verdes. Achado pelo Codex em revisão, no mesmo dia, e reproduzido
por sonda antes de mexer. O efeito inverso também valia: um proibido com aspas
ou barra (`"Zé" Lima`, caminho de arquivo) atravessava. `carimbar` agora
escapa proibidos e isenções como o JSON escaparia (`escaparComoJson`), e o
teste usa uma instrução com parágrafos. A lição de método: **o teste que
prova a correção tem de usar a entrada real, ou uma com a mesma forma** —
uma constante de fachada com a forma errada prova a forma errada.

Do mesmo lote de revisão: a fronteira de palavra exigia não-alfanumérico dos
dois lados, e `CPF111.444.777-35` — o OCR come o espaço o tempo todo — passava
pelo arremate **e** pela trava, que usam a mesma regra. Fronteira agora é
**troca de classe** (`ehFronteira`): letra encostada em dígito é fronteira,
letra em letra não ("Fernanda" continua não contendo "Ana").

**E o resíduo da anonimização derrubava a conversa inteira.** O backend numera
pseudônimos por **valor** e substitui por **span**: reconhecido "FORTALEZA" nas
posições 10 e 500 e perdido na 900, o texto anonimizado carrega a terceira em
claro. É o resíduo que o gate mede — 2 escapes em 3.615 — e que até aqui só
importava para quem lia o documento. Recusar por causa dele é a resposta certa
para um vazamento e a errada para este caso: o dado já estava no arquivo que o
usuário guardou, e ele não tem o que fazer com a recusa.

`pseudonimos.arrematar` fecha em vez de recusar: toda aparição de um valor **já
reconhecido como entidade** vira o rótulo que aquele valor já tem. Vale para os
documentos, para a pergunta e para o histórico — a resposta do modelo é texto
que ninguém controla e volta a sair no turno seguinte.

Isto **não** é o "varredor de resíduo" descartado acima, e a distinção é a que
decide se funciona: aquele rodaria o motor outra vez e, por definição, não
acharia o que ele já não achou. Este não detecta nada — usa a decisão que o
motor já tomou e completa a aplicação dela. O que sai para a nuvem fica mais
anonimizado que o arquivo guardado, nunca menos.

Dois detalhes que custaram teste:

- **O arremate roda depois de todos os `incorporar`**, com o mapa completo. Peça
  a peça, um nome que o detector só pegou na procuração continuaria em claro na
  petição — e é entre peças que o resíduo mora, porque cada uma foi analisada
  sozinha.
- **A busca acontece na forma comparável e o recorte no texto real**, o que
  exige guardar de onde veio cada caractere (`normalizarComIndice`). Deduzir o
  deslocamento por contagem falha exatamente onde a normalização mexeu no
  comprimento: acento e espaço duplo, as duas coisas que o OCR mais produz.

O arremate e a trava têm de concordar sobre o que conta como valor e onde
começa uma palavra. Por isso `MINIMO_VERIFICAVEL` e `ehLetraOuDigito` moram na
trava e são importados, e por isso existe o teste "o que o arremate fecha, a
trava não encontra". Divergindo, o arremate declara ter fechado e a trava
bloqueia mesmo assim — sem conserto possível pela interface.

**Um documento recusado não derruba mais a conversa inteira.** Quem seleciona
doze peças e tem uma antiga no meio ficava sem nada, sem saber qual tirar. A
peça recusada sai da seleção com o motivo na tela; ela continua sem sair da
máquina, que é o que a recusa protege.

### "Não é PII" não fazia nada visível

O botão gravava na deny-list e avisava "processe de novo para ver o efeito" —
sobre um documento aberto, com a ocorrência ainda na lista e a tarja ainda no
texto. O revisor clicava, nada mudava, e clicava de novo.

Reprocessar para isso custaria minutos de CPU e chegaria ao **mesmo texto**: a
detecção não muda, muda um item de uma lista já decidida. Daí `POST
/remascarar`, que recebe a lista revisada e só reescreve a saída. Três coisas a
respeitar nela:

- **É estática (`PresidioEngine.remascarar`) e não chama `get_engine()`.**
  Tirar um falso positivo de uma lista já decidida não é trabalho de NLP, e a
  rota funciona com o motor subindo ou fora do ar. Trocar por
  `get_engine().remascarar` carregaria 2,5 GB de BERT para reescrever uma linha.
- **A numeração é recalculada do zero.** Tirar a terceira pessoa renumera a
  quarta; deixar buraco na sequência faz `pseudonimos.conferir` recusar o
  documento, e um "não é PII" viraria "este documento não pode mais ser
  conversado".
- **Spans sobrepostos são recusados com 400.** `_aplicar_mascaras` substitui de
  trás para frente e pressupõe disjunção: sobrepostos, ele corrompe o texto em
  silêncio e produz um documento que parece anonimizado e não está.

Todas as aparições do termo saem juntas, porque a deny-list é por termo. Um
falso positivo que o motor repetiu quarenta vezes — e ele repete, via
`_propagar_nomes` — exigiria quarenta cliques para o efeito que a gravação já
teve.

**Em desenvolvimento, o clique grava no repositório.** O caminho da deny-list é
relativo ao módulo (`Path(__file__).parent / "config"`), então o app em dev
escreve em `python-backend/config/deny_list.json` — o arquivo versionado. Testar
o botão num município ("Ocara", 01/09/2026) commitou a política de nunca mais
mascarar aquela cidade, e foi parar no `origin/main` num `git add` de rotina.
Antes de commitar, `git diff python-backend/config/`.

**E o conserto só ficou de pé com `cofre.atualizar`.** O cofre é gravado assim
que o processamento termina (`App.tsx`, logo depois de `abrir-revisao`),
**antes** de qualquer revisão. Sem regravar, rejeitar um falso positivo
corrigia a tela e o arquivo salvo em disco, e deixava no cofre a versão suja —
que é de onde a conversa lê. O revisor veria a lista limpa e o modelo receberia
o texto com `[PESSOA_7]` no lugar de "os dados", sem nada na tela dizendo isso.

Não é `apagar` + `gravar`: isso trocaria o id, e o id é o que a revisão aberta e
a seleção da conversa carregam — trocá-lo no meio da sessão transformaria uma
correção em "documento não está mais no cofre". Provado por mutação: trocar
`id: anterior.id` por um id novo faz o teste reprovar. E id ausente devolve
`null` em vez de criar a entrada, porque gravar tem consentimento próprio e
recriar aqui gravaria dado pessoal no disco de quem escolheu não guardar
nenhum.

**Rota nova nasce atrás do token, e agora isso é testado por varredura.** Era
testado por amostragem: `/processar`, `/anonymize` e a deny-list tinham um
teste cada, e as demais dependiam de alguém lembrar. Quem esquecesse não veria
falha nenhuma. `test_toda_rota_menos_health_exige_o_token` percorre
`app.openapi()["paths"]` e exige 403 — **404 e 422 reprovam**, porque as duas
significam que a requisição atravessou a autenticação. As públicas são quatro e
estão numa lista branca com o motivo escrito: `/health`, `/v1/info` e as duas
de `/v1/parear`, que não podem exigir token porque são a única forma de obter um.

## A repaginação de 02/09/2026

O desenho está em [`docs/design-system.md`](docs/design-system.md). O que
custou caro descobrir fica aqui.

**A caixa alta era o "veio".** Cor, fonte e paleta continuam as mesmas da
v1.3.0; o que fazia a interface parecer um painel de terminal era `uppercase
tracking-wide` em todo botão, título e item de menu. Trocar por caixa baixa
nas primitivas (`Botao`, `Cartao`, `GrupoSegmentado`, `Tabela`, `Campo`,
`Dialogo`) rendeu mais do que qualquer mudança de layout, e custou uma hora.
Caixa alta com entreletra ficou reservada a rótulo de seção com 12px ou
menos. Antes de redesenhar uma tela, conferir se o problema não é só esse.

**A moldura da janela é do aplicativo.** `titleBarStyle: "hidden"` +
`titleBarOverlay` no `main.ts` tiram a barra do sistema e deixam só os três
controles no canto; `BarraDeTitulo` (40px, `-webkit-app-region: drag`) faz o
resto. Duas armadilhas: a cor da moldura é pintada pelo Electron, fora do
CSS, então `aplicarTema` lê `--papel-fundo` e `--toner` do `:root` já pintado
e manda por IPC (`barra-de-titulo`, que só aceita hexadecimal de seis
dígitos) — sem isso, trocar o tema deixa a moldura na cor antiga; e os
controles cobrem os últimos ~140px da faixa, então nada pode morar ali. O
menu nativo ficou em `autoHideMenuBar` (volta pelo Alt), porque `View →
Toggle DevTools` ainda serve em desenvolvimento.

**A conversa morria ao trocar de tela.** `useConversa` fechava a conversa no
desmonte, e `Conversa` desmonta a cada navegação — ir aos Ajustes trocar o
modelo e voltar apagava pergunta e resposta. Com `Ctrl+1…5` isso ficou a um
toque. Agora um registro de módulo guarda `{chave, id}` e a tela retoma por
`chat.estado(id)` quando a seleção e o modelo são os mesmos; quem fecha é a
próxima seleção diferente. O custo é a conversa ficar viva na memória do
processo principal até isso acontecer — é texto, não é dado pessoal em claro,
e o mapa de pseudônimos já vivia lá de qualquer jeito.

**O modelo escolhido nos Ajustes não era usado.** `chat.abrir(ids, modelo?)`
aceitava o parâmetro, o preload o repassava, e o renderer nunca o mandava: a
escolha valia só para o teste da chave. Virou preferência (`modeloDaNuvem`)
lida pela `Conversa`. Checar a ponta que consome, não só a que oferece.

**Fotografar o app pelo PowerShell exige `SetProcessDPIAware()`** (já estava
na memória) **e não pode depender do título da janela**: depois de
`setTitleBarOverlay` o `MainWindowTitle` do processo veio vazio e o script
parou de achar a janela. Procurar por `MainWindowHandle -ne 0` entre os
processos `electron`. E `SendKeys` só digita no campo se o clique cair
**dentro** do `<textarea>` — o preenchimento da moldura em volta não conta.
## Pendências

- **A deny-list do app instalado mora dentro da pasta de instalação.** O
  `config_loader.py` resolve `Path(__file__).parent / "config"`, que no
  instalado é `resources/python-backend/config/deny_list.json`, e o NSIS remove
  a instalação anterior antes de gravar a nova. Toda atualização descarta os
  "Não é PII" que o usuário acumulou — e foi em 01/09/2026 que o botão passou a
  valer a pena clicar. Direção: gravar no `userData`, semeando do arquivo
  embarcado na primeira execução, com o caminho chegando ao backend pelo
  Electron. Enquanto isso, a nota está no corpo da release v1.4.0.
- **Janelas de texto em lote na detecção.** O laço do `anonymize` passa uma
  janela de 1.200 caracteres por vez pelo modelo, e a detecção é 52% do tempo.
  Agrupar dezenas por chamada é a mudança de melhor retorno medido/esforço, e é
  ela que destrava qualquer uso sério de GPU — com lote de um, a placa fica
  ociosa esperando a próxima janela. Nada disso foi medido ainda; é a próxima
  medição a fazer.
- **Documentos do lote em paralelo.** O `percorrerLote` é estritamente
  sequencial. Enquanto o OCR espera no lock, há folga que outro documento
  usaria. O custo é memória: cada documento simultâneo quer a sua fatia.
- **Escala horizontal já funciona, e ninguém aproveita.** Os locks do
  `ocr_engine` são `threading.Lock` — de processo. Duas cópias do backend não
  disputam entre si, então N processos multiplicam a vazão quase linearmente. O
  que falta é quem distribua trabalho entre eles: o `RegistroDeJobs` é um
  dicionário em memória, teto de 20, que morre com o processo, e o
  `uvicorn.run` sobe um processo só.
- Segundo passe do OCR para página ruim. Medido: subir a resolução do `small`
  rende mais que trocar para o `medium`, pela metade do tempo.
- Tarja de redação em PDF (queimar pixels, sanear metadados, verificar resíduo).
  O `presidio-image-redactor` **não** serve de atalho: roda sobre Tesseract, o
  motor descartado por recuperar 17,7% em datilografado, e não aceita OCR
  injetado.
- Extensão de navegador para o PJe — o **contrato existe** (`docs/api-local.md`)
  e a escolha foi HTTP local com pareamento; falta escrever a extensão.
- O vazamento residual da auditoria de 14/08 **continua**: o CPF
  `004.811.253-` cortado no fim da linha, com o dígito verificador na linha
  seguinte (reconferido em 02/09/2026 com o modelo novo). O outro —
  `ELIONEUDO EVARISTO DE`, nome partido na quebra — **saiu** com a troca de
  modelo e os consertos em `_fundir_spans`: PERSON fechou 100% nos três
  documentos. São entidades interrompidas no meio do texto — a janela com
  sobreposição resolve o caso de linha adjacente, não o de token truncado.
  Nenhum outro tipo vaza: CEP, CNJ, CNPJ, e-mail, OAB, RG e telefone deram
  100% nos três documentos.
- Falsos positivos de PERSON em OCR hostil. No A/B das 43 peças do processo
  0201848 (inquérito com caixa alta e lixo de reconhecimento), o modelo novo
  traz 76 valores únicos que o antigo não tinha — metade nomes reais a mais,
  metade lixo ("MACONHA DOZE TROUXAS", "TABLET MULTILASER", "USUÁRIO PADRÃO").
  Ciclo separado, já combinado: teto de score na semente da propagação
  (`_propagar_nomes`) e vocabulário de qualificadores, uma variável por vez,
  medindo no mesmo A/B (`eval/comparar_modelos.py`).
