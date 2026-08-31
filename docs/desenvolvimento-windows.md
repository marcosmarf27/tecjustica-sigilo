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

### O lock do embarcado

O que entra no `python-embed` está em **`python-backend/requirements-embed.txt`**
— 89 pacotes, o fecho transitivo inteiro. Ele existe separado do
`requirements.txt` porque `--no-deps` desliga o resolvedor: o que não estiver
escrito ali não entra, e o pip não reclama. A lista já foi mantida à mão e
chegou a cobrir só um terço do necessário; o embarcado saía sem `thinc` e sem
`click`, montado e incapaz de importar spaCy ou uvicorn.

Depois de mexer no `requirements.txt`, regere o lock a partir de um venv que
funcione:

```bash
.venv/Scripts/pip.exe freeze | grep -vE '^(antlr4|pt_core_news_lg)' \
  >> python-backend/requirements-embed.txt
```

As duas exclusões são deliberadas e estão explicadas no cabeçalho do arquivo:
`antlr4-python3-runtime` só existe como sdist (o script o copia do venv) e
`pt_core_news_lg` vem por URL, não do PyPI.

Esse modelo do spaCy **não é opcional e não é só do modo leve**: no modo BERT
ele é o tokenizador. O `setup-python-embed.sh` termina carregando-o justamente
para não declarar sucesso sobre um embarcado que não sobe.

## Testes

```bash
.venv/Scripts/python -m pytest python-backend/tests -q   # backend
npm run test:electron                                    # Electron
npm run check:backend                                    # o que o build exige
```

Alguns testes de OCR são pulados: dependem de um corpus de processos reais que
não está no repositório (são documentos de verdade). Os caminhos apontam para a
máquina onde foram escritos.

## Não teste comportamento contra um servidor que alguém está editando

O `dev:electron` sobe o Vite com HMR. Toda edição em `src/` empurra uma
atualização para o renderer, e certas edições — `src/main.tsx`, por exemplo —
disparam **`page reload`**, que apaga o estado inteiro da janela: fila,
progresso do lote, revisão aberta. A tela volta ao ponto inicial enquanto o
backend segue processando sem erro nenhum, e o log dele não registra nada de
anormal, porque nada de anormal aconteceu **nele**.

Confirmado nos logs desta máquina em 30/08/2026:

```
19:30:14 [vite] (client) page reload src/main.tsx
```

O sintoma que isso produz é indistinguível de um defeito no lote: "começou o
processamento, aí de repente parou e voltou para a tela de juntar documentos".
Se alguém estiver mexendo no código enquanto outra pessoa testa, **os dois vão
perseguir um bug que talvez não exista**.

Para investigar comportamento de verdade: teste no app empacotado
(`release/win-unpacked`), ou num `dev` que ninguém vai tocar até o teste acabar.

## Medir desempenho de OCR neste notebook

Se você for tocar em qualquer parâmetro do OCR, leia isto antes — foi uma tarde
inteira de números que não faziam sentido.

**Uma medição isolada não vale nada aqui.** Repetindo *a mesma* configuração em
estados térmicos diferentes, a mesma página deu de 4,7 s a 20,7 s. O notebook
sobe e desce de clock conforme a temperatura, e uma bancada que roda as
configurações em sequência mede a temperatura, não a configuração: a última
sempre parece pior.

Como medir para valer:

1. **Máquina ociosa.** Feche o app, o `npm run dev`, o Docker. Confira com
   `Get-Process | Sort-Object CPU -Descending | Select-Object -First 5` — o
   `com.docker.backend` sozinho já chegou a 9.000 s de CPU acumulada aqui.
2. **Ordem direta e inversa.** Rode a lista de configurações, depois a lista
   invertida, e compare **medianas**. A deriva térmica atinge as duas passadas,
   e a inversão a cancela.
3. **Aqueça antes de cronometrar.** A primeira chamada carrega as três sessões
   ONNX (~13 s) e não é o que você quer medir.
4. **Confira que a saída não mudou.** Parâmetro de desempenho que altera o texto
   reconhecido não é ganho, é troca — e troca em OCR mexe em recall.

**Cuidado com o CPU híbrido.** Os Intel de 12ª geração em diante misturam
P-cores e E-cores, e o `cpu_count` conta os dois como iguais. Foi assim que o
`intra_op_num_threads` acabou em 11 numa máquina de 12 threads e ficou entre 2x
e 5x mais lento que 4 — o ONNX fatia cada operação em partes iguais e sincroniza
a cada camada, então a fatia que caiu num E-core segura todas as outras.

Para isolar o efeito, prenda o processo a um conjunto de núcleos com
`SetProcessAffinityMask` antes de criar a sessão (as threads herdam a afinidade
na criação do pool). Na numeração do Windows os P-cores vêm primeiro:
`0x0FF` = só P-cores, `0xF00` = só E-cores neste i5-12450HX. Declare o
`argtypes` no `ctypes` — em x64 o HANDLE tem 64 bits e sem isso a chamada falha
calada.

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
