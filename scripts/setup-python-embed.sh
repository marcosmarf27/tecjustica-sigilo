#!/usr/bin/env bash
#
# Monta o Python embarcado que vai dentro do instalador, do zero.
#
# Este script existia só na cabeça de quem montou a primeira vez: o
# `resources/python-backend/python-embed/` tem 1,8 GB, está no .gitignore, e um
# clone limpo não tinha como reconstruí-lo. Sem ele não sai instalador.
#
# O que ele faz:
#   1. Baixa a distribuição "embeddable" do python.org (a mesma que o Windows
#      usa para embarcar Python em outro programa — sem instalador, sem pip).
#   2. Habilita `Lib\site-packages` no `._pth`, que vem desabilitado.
#   3. Instala as dependências como wheels de WINDOWS, mesmo rodando no Linux.
#
# O passo 3 é o que tem armadilha. A distribuição embeddable não traz pip, então
# `python.exe -m pip` falha com "No module named pip". A saída é resolver os
# wheels de fora, com `--platform win_amd64 --only-binary`, e copiar. E tem de
# ser `--no-deps` com pins explícitos: o resolvedor livre puxa numpy 2.5, que
# briga com o `numpy<2.5` que o presidio-analyzer exige.
#
# O que essa lista de pins tem de ser é COMPLETA, e é onde ela falhou. Ela era
# mantida à mão aqui dentro e cobria cerca de um terço do fecho transitivo:
# faltavam `thinc` (sem ele o spaCy nem importa), `click` (sem ele o uvicorn não
# importa) e mais de trinta pacotes. Como `--no-deps` desliga o resolvedor, nada
# disso é reclamado na instalação — o embarcado sai montado e quebrado. Agora a
# lista mora em `python-backend/requirements-embed.txt`, versionada e tirada de
# um venv que comprova funcionar.
#
# Uso:  scripts/setup-python-embed.sh [--forcar]
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="$RAIZ/resources/python-backend/python-embed"
VERSAO="3.12.3"
URL="https://www.python.org/ftp/python/${VERSAO}/python-${VERSAO}-embed-amd64.zip"

PIP_CMD="${PIP_CMD:-}"
if [[ -z "$PIP_CMD" ]]; then
  if [[ -x "$RAIZ/.venv/bin/pip" ]]; then
    PIP_CMD="$RAIZ/.venv/bin/pip"
  elif [[ -x "$RAIZ/.venv/Scripts/pip.exe" ]]; then
    PIP_CMD="$RAIZ/.venv/Scripts/pip.exe"
  else
    PIP_CMD="$(command -v pip3 || command -v pip || true)"
  fi
fi
[[ -n "$PIP_CMD" ]] || { echo "pip não encontrado. Crie o .venv primeiro." >&2; exit 1; }

if [[ -d "$DESTINO" && "${1:-}" != "--forcar" ]]; then
  echo "python-embed já existe em resources/python-backend/."
  echo "Use --forcar para refazer do zero (apaga o que está lá)."
  exit 0
fi

echo "1/3  Baixando Python ${VERSAO} embeddable..."
rm -rf "$DESTINO"
mkdir -p "$DESTINO"
temporario="$(mktemp -d)"
trap 'rm -rf "$temporario"' EXIT
curl -sL --fail "$URL" -o "$temporario/python-embed.zip"
unzip -q "$temporario/python-embed.zip" -d "$DESTINO"

echo "2/3  Habilitando site-packages..."
# O `._pth` vem com `#import site` comentado, o que desliga o carregamento de
# `Lib\site-packages` — nenhuma biblioteca instalada seria encontrada.
pth="$(find "$DESTINO" -maxdepth 1 -name 'python*._pth' | head -1)"
[[ -n "$pth" ]] || { echo "._pth não encontrado no zip." >&2; exit 1; }
{
  echo "python312.zip"
  echo "."
  echo 'Lib\site-packages'
  echo '..\'
  echo "import site"
} > "$pth"
mkdir -p "$DESTINO/Lib/site-packages"

LOCK="$RAIZ/python-backend/requirements-embed.txt"
[[ -f "$LOCK" ]] || { echo "requirements-embed.txt não encontrado." >&2; exit 1; }

echo "3/3  Instalando as dependências como wheels de Windows..."
echo "     ($(grep -cvE '^\s*(#|$)' "$LOCK") pacotes; o torch sozinho são ~800 MB)"
# Fecho transitivo completo e --no-deps: ver o cabeçalho deste arquivo.
"$PIP_CMD" install --quiet --target "$DESTINO/Lib/site-packages" \
  --platform win_amd64 --python-version 3.12 --only-binary=:all: --no-deps \
  -r "$LOCK"

# `antlr4-python3-runtime` (exigido pelo omegaconf) só existe como sdist na
# versão que usamos, então não passa pelo --only-binary. É Python puro, então
# copiar do venv serve para qualquer plataforma.
for origem in "$RAIZ/.venv/lib/python3.12/site-packages" "$RAIZ/.venv/Lib/site-packages"; do
  if [[ -d "$origem/antlr4" ]]; then
    cp -r "$origem/antlr4" "$origem"/antlr4_python3_runtime-*.dist-info \
      "$DESTINO/Lib/site-packages/" 2>/dev/null || true
    break
  fi
done

# Os modelos que vêm dentro do wheel do rapidocr são a conversão de terceiros.
# Nós usamos os oficiais, por caminho explícito — estes só ocupariam 31 MB no
# instalador e criariam dúvida sobre quais pesos estão rodando.
rm -f "$DESTINO/Lib/site-packages/rapidocr/models/"*.onnx 2>/dev/null || true

# Confere aqui mesmo que o embarcado é capaz de carregar o motor de linguagem.
# Antes o script terminava dizendo "pronto" sobre uma árvore que não importava
# nem o spaCy, e a descoberta ficava para o usuário final. Importar é barato;
# o modelo BERT não é tocado — esse baixa na primeira execução do app.
echo
echo "Conferindo o embarcado..."
VERIFICACAO='
from importlib.metadata import version

import spacy
nlp = spacy.load("pt_core_news_lg")
print("  spaCy %s + pt_core_news_lg: %d tokens em teste"
      % (spacy.__version__, len(nlp("Fulano de Tal, CPF 123.456.789-09."))))

# Os módulos são importados de verdade, e não apenas consultados nos metadados:
# o que quebra aqui é dependência ausente, e isso só aparece no import. A
# VERSÃO, ao contrário, vem de `importlib.metadata` — `presidio_analyzer` não
# expõe `__version__`, e ler o atributo direto derrubava esta conferência sobre
# um embarcado perfeitamente bom.
import torch, transformers, presidio_analyzer, rapidocr, multipart  # noqa: F401
print("  torch %s, transformers %s, presidio-analyzer %s"
      % (torch.__version__, transformers.__version__,
         version("presidio-analyzer")))
'
if ! saida="$("$DESTINO/python.exe" -c "$VERIFICACAO" 2>&1)"; then
  echo "O EMBARCADO NÃO CARREGA O MOTOR:" >&2
  echo "$saida" | tail -15 | sed 's/^/  /' >&2
  echo >&2
  echo "Falta pacote em python-backend/requirements-embed.txt." >&2
  exit 1
fi
echo "$saida"

echo
echo "Pronto. Confira o backend inteiro com:"
echo "  scripts/smoke-backend.sh"
