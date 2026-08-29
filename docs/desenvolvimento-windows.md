# Desenvolver no Windows

Este é um aplicativo Windows. Desenvolvê-lo pelo WSL funciona até certo ponto e
depois atrapalha: o `python.exe` embarcado lido pela ponte `\\wsl.localhost` leva
**20 segundos para carregar 31 MB de modelo** que no disco local levam menos de
dois, e importar o torch de lá passa de dois minutos. Nenhum desses números tem
relação com o desempenho real do produto — são artefato do ambiente.

Este documento é o caminho para desenvolver direto no Windows.

## Pré-requisitos

| | Por quê |
|---|---|
| **Git for Windows** | Traz o Git Bash, que roda os `scripts/*.sh`. O PowerShell não os executa. |
| **Node 20+** | Interface e Electron. |
| **Python 3.12 ou 3.13, obrigatoriamente de 64 bits** | O backend. O instalador embarca 3.12.3; o desenvolvimento roda também em 3.13. A arquitetura não é negociável — ver abaixo. |

Na instalação do Python, marque **"Add python.exe to PATH"**.

### O Python tem de ser de 64 bits

`torch`, `onnxruntime` e `spacy` **não publicam wheel `win32`**, e nem sequer
publicam sdist nas versões pinadas. Num Python de 32 bits não há de onde
instalar, e o erro não diz isso: o pip recusa uma versão pinada e lista as
vizinhas como disponíveis, o que faz parecer que o pin foi removido do PyPI. As
vizinhas só aparecem porque publicam sdist, que é compatível com qualquer
plataforma.

Confira antes de criar o venv — `win-amd64` é o esperado, `win32` é o problema:

```bash
python -c "import sysconfig; print(sysconfig.get_platform())"
```

Uma máquina Windows costuma ter **mais de um Python no PATH**, e eles não são
intercambiáveis: `python` pode ser uma instalação de 32 bits e `python3`, o
atalho da Microsoft Store — que é uma terceira instalação, pelada. Se o
`get_platform()` acusar `win32`, crie o venv apontando o interpretador certo
pelo caminho completo em vez de confiar no PATH:

```bash
"/c/Users/$USER/AppData/Local/Programs/Python/Python312/python.exe" -m venv .venv
```

## Clonar e preparar

No **Git Bash** (não no PowerShell — os scripts precisam dele):

```bash
git clone https://github.com/marcosmarf27/tecjustica-sigilo.git
cd tecjustica-sigilo

npm install

python -m venv .venv
.venv/Scripts/pip install -r python-backend/requirements.txt
.venv/Scripts/python -m spacy download pt_core_news_lg

# Modelos do OCR (~31 MB, com SHA-256 conferido contra o MANIFESTO.json)
bash scripts/fetch-ocr-models.sh
```

O `spacy download` puxa 570 MB do GitHub Releases e costuma ser a etapa mais
demorada do preparo — bem mais que o `pip install`, torch incluído. Ele é
necessário mesmo no modo BERT: o `pt_core_news_lg` entra como tokenizador, e o
BERT só como reconhecedor de entidades.

Conferindo que o preparo ficou de pé, antes de abrir o app:

```bash
bash scripts/fetch-ocr-models.sh --check   # deve dizer "Modelos em dia."
curl -s http://127.0.0.1:8123/health       # com o app rodando
```

No `/health`, o campo que importa é `"nlp_mode":"transformer"` com
`"motivo_fallback":null`. Se vier `"spacy"`, o modo BERT não subiu e a
anonimização está rodando em qualidade inferior.

Rodar:

```bash
npm run dev:electron
```

**Na primeira execução o modo padrão baixa ~1,7 GB** do modelo BERT do Hugging
Face, e a tela fica em "Carregando motor de anonimização" enquanto isso. É uma
vez só; depois o modelo fica em `%USERPROFILE%\.cache\huggingface`. Para pular,
use o modo leve (menor qualidade de detecção):

```powershell
# PowerShell
$env:PRESIDIO_NLP_MODE="spacy"; npm run dev:electron
```

```bash
# Git Bash
PRESIDIO_NLP_MODE=spacy npm run dev:electron
```

## Gerar o instalador

Precisa de mais um passo, que só é feito uma vez: montar o **Python embarcado**,
o interpretador que vai dentro do `.exe`. Ele tem 1,8 GB e não está no git.

```bash
bash scripts/setup-python-embed.sh
npm run build:dist
```

O instalador sai em `release/TecJustiça Sigilo Setup <versão>.exe`.

O `build:dist` roda, nesta ordem: baixa e confere os modelos, sincroniza o
backend para `resources/`, **importa o backend empacotado para ver se ele
sobe**, compila a interface e empacota. Essa terceira etapa existe porque uma
biblioteca faltando no Python embarcado não quebra teste nenhum — quebra na
máquina do usuário, com o backend morrendo em silêncio e a tela presa em
"Carregando".

### Se `setup-python-embed.sh` falhar

A distribuição embeddable do Python **não tem pip**: `python.exe -m pip` responde
`No module named pip`. É esperado. As bibliotecas são resolvidas de fora, como
wheels de Windows, e copiadas:

```bash
pip install --target /tmp/libs \
    --platform win_amd64 --python-version 3.12 --only-binary=:all: \
    --no-deps <pacote>==<versão> ...
cp -rn /tmp/libs/* resources/python-backend/python-embed/Lib/site-packages/
```

Use sempre `--no-deps` com versões explícitas. O resolvedor livre traz
`numpy 2.5`, que conflita com o `numpy<2.5` exigido pelo presidio-analyzer.

## Testes

```bash
.venv/Scripts/python -m pytest python-backend/tests -q   # backend
npm run test:electron                                    # Electron
npm run check:backend                                    # o que o build exige
```

Alguns testes de OCR são pulados: dependem de um corpus de processos reais que
não está no repositório (são documentos de verdade). Os caminhos apontam para a
máquina onde foram escritos.

## O que muda em relação ao WSL

| | WSL | Windows |
|---|---|---|
| Python do venv | `.venv/bin/python` | `.venv/Scripts/python` |
| Variável de ambiente | `VAR=x comando` | `$env:VAR="x"; comando` (PowerShell) |
| Scripts `.sh` | direto | pelo Git Bash |
| Carregar modelo do OCR | ~20 s (ponte de rede) | **< 2 s** |
| Importar o torch | > 2 min (ponte de rede) | ~12 s |

Se algum `scripts/*.sh` reclamar de `python3: command not found`, é porque no
Windows o executável se chama `python`. O `fetch-ocr-models.sh` já trata os
dois; se aparecer em outro, use o mesmo padrão que está no topo dele.
