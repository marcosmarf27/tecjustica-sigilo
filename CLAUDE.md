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

O corpus de OCR é apontado por `PRESIDIO_CORPUS_OCR` (pasta com os PDFs) e é o
que permite medir qualquer mudança de OCR com `eval/bench_ocr.py`. Sem ele o
teste que depende dele é pulado e nenhuma alteração de motor pode ser
verificada.

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

Gate: `cd python-backend && python -m eval.run_eval`. Baseline a bater: **99,92%
por ocorrência, 99,10% por valor único**, no modo BERT. Confira `modo_nlp` dentro
do JSON — se o motor cair para spaCy, o arquivo sai com números de spaCy.

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
- Reconferir os dois vazamentos residuais da auditoria de 14/08 (CPF truncado no
  fim da linha, sobrenome perdido na virada de página) com o motor de OCR novo.
