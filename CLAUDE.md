# TecJustiça Sigilo — o que não está óbvio no código

Anonimizador de dados pessoais em processos judiciais brasileiros. Electron +
React + FastAPI + Microsoft Presidio. Tudo roda na máquina do usuário: nenhuma
página sai daqui.

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
estourar os 180 s. Ou seja: a defesa criou a condição da falha. O `server.py` só
monta CORS quando o Electron declara `PRESIDIO_DEV_ORIGIN`; empacotado não há
origem cruzada e nada é montado. A URL do Vite vive numa constante só
(`URL_DEV`, em `main.ts`) porque origem declarada e URL carregada têm de
coincidir — `localhost` de um lado e `127.0.0.1` do outro já reprova.

**Sem navegador não existe CORS**, e é por isso que os 110 testes passam: eles
falam HTTP direto com o backend. Só o renderer dentro do Chromium impõe a regra.

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

**Resolução alta parece melhor e não é.** O detector parte a linha em mais
caixas e um CPF atravessa duas; ponta a ponta, 16 ocorrências íntegras contra 6.
Ocorrência quebrada não casa com o recognizer e não é mascarada. Os valores
medidos estão comentados em `ocr_engine.py` — mexer neles exige rodar
`eval/bench_ocr.py` de novo.

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

Última execução, 29/08/2026, na v1.2.0 (modo efetivo `transformer`, 14 entidades
da interface, 819 páginas): **99,94% por ocorrência** (3.613/3.615) e **99,40%
por valor único** (331/333). Acima da baseline. Custa ~62 min de CPU — não é
gate de cada commit, é gate de release.

Termos novos vão em `python-backend/config/deny_list.json`, não hardcoded;
palavras de contexto em `config/context_words.json`. Documentos brasileiros usam
dígito verificador (`validators.py`) para elevar score ou descartar falso
positivo.

## Pendências

- Segundo passe do OCR para página ruim. Medido: subir a resolução do `small`
  rende mais que trocar para o `medium`, pela metade do tempo.
- Tarja de redação em PDF (queimar pixels, sanear metadados, verificar resíduo).
- Extensão de navegador para o PJe — desenho ainda não escolhido entre Native
  Messaging (sem porta aberta) e HTTP local com pareamento.
- Os dois vazamentos residuais da auditoria de 14/08 **continuam**, reconferidos
  com o motor de OCR novo em 29/08/2026. Ambos em `expedientes_13-08`: o CPF
  `004.811.253-` cortado no fim da linha, com o dígito verificador na linha
  seguinte, e `ELIONEUDO EVARISTO DE`, nome partido na quebra. São entidades
  interrompidas no meio do texto — a janela com sobreposição resolve o caso de
  linha adjacente, não o de token truncado. Nenhum outro tipo vaza: CEP, CNJ,
  CNPJ, e-mail, OAB, RG e telefone deram 100% nos três documentos.
