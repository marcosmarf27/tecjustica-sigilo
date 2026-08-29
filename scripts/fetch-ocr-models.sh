#!/usr/bin/env bash
#
# Baixa os modelos de OCR (PP-OCRv6) para resources/ocr-models/.
#
# Os pesos são os OFICIAIS da PaddlePaddle, publicados no Hugging Face sob
# Apache-2.0 — não a conversão de terceiros que o `rapidocr` baixaria sozinho
# do modelscope.cn na primeira execução. As duas produzem saída idêntica
# (conferido byte a byte), mas só uma tem procedência oficial e hash pinado.
#
# O MANIFESTO.json é a fonte da verdade: ele fica no git, os .onnx não. Um
# arquivo que não bate com o hash é apagado, não usado — modelo é código que
# roda, e um .onnx trocado decide o que a anonimização deixa passar.
#
# Uso:
#   scripts/fetch-ocr-models.sh              # perfil small (padrão)
#   scripts/fetch-ocr-models.sh medium       # segundo passe
#   scripts/fetch-ocr-models.sh --check      # só confere o que já está no disco
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# O interpretador do projeto é o do venv, e é ele que se procura primeiro: é o
# único que se garante ter as dependências. A extração do dicionário precisa de
# PyYAML, que chega junto com o rapidocr — não é razoável exigi-lo de um Python
# qualquer do sistema.
#
# Numa máquina Windows há tipicamente mais de um Python no PATH, e eles não são
# intercambiáveis: `python3` costuma ser o atalho da Microsoft Store, uma
# instalação separada e pelada. Escolhê-lo fazia o script baixar os 31 MB de
# modelo e só então morrer com "No module named 'yaml'".
#
# Sem venv, cai para o PATH. Aí `python` entra como segundo candidato porque no
# Git Bash é esse o nome do executável — sem ele o script morria com
# "command not found" na primeira máquina Windows.
PY_CMD=""
for candidato in "$RAIZ/.venv/Scripts/python.exe" "$RAIZ/.venv/bin/python"; do
  if [[ -x "$candidato" ]]; then
    PY_CMD="$candidato"
    break
  fi
done
if [[ -z "$PY_CMD" ]]; then
  PY_CMD="$(command -v python3 || command -v python || true)"
fi
if [[ -z "$PY_CMD" ]]; then
  echo "Python não encontrado (procurei .venv, python3 e python)." >&2
  exit 1
fi
DESTINO="$RAIZ/resources/ocr-models"
MANIFESTO="$DESTINO/MANIFESTO.json"

PERFIL="${1:-small}"
modo_verificacao=0
if [[ "$PERFIL" == "--check" ]]; then
  modo_verificacao=1
  PERFIL="small"
fi

# O classificador de orientação de linha não faz parte do PP-OCRv6: é o PP-OCR
# v2.0, que o pipeline do RapidOCR exige e que endireita a linha de cabeça para
# baixo. Vem do catálogo do próprio RapidOCR.
CLS_URL="https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx"

mkdir -p "$DESTINO"

# O python.exe nativo do Windows não entende o caminho estilo Git Bash
# (`/c/Users/...`): ele tenta abrir `C:\c\Users\...`, não encontra, e o
# manifesto passa por inexistente. O efeito era o script recusar TODO download
# com "não há entrada no MANIFESTO.json" — a mensagem de um pin faltando, não a
# de um arquivo ilegível. `cygpath` existe no Git Bash e não no Linux, então a
# conversão só acontece onde faz falta.
para_python() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

sha() { sha256sum "$1" | cut -d' ' -f1; }

esperado() {
  # O nome vai por argv, não interpolado no fonte: caminho do Windows tem
  # barra invertida, que dentro de literal Python vira escape.
  "$PY_CMD" - "$(para_python "$MANIFESTO")" "$1" <<'FIM'
import json, sys
try:
    m = json.load(open(sys.argv[1], encoding="utf-8"))
except FileNotFoundError:
    print(f"  MANIFESTO.json ilegível em {sys.argv[1]}", file=sys.stderr)
    sys.exit(0)
print(m.get(sys.argv[2], {}).get("sha256", ""))
FIM
}

conferir() {
  local nome="$1" arquivo="$DESTINO/$1"
  local alvo; alvo="$(esperado "$nome")"
  [[ -f "$arquivo" ]] || { echo "  FALTA   $nome"; return 1; }
  if [[ -z "$alvo" ]]; then
    echo "  SEM PIN $nome (ausente do MANIFESTO.json)"
    return 1
  fi
  if [[ "$(sha "$arquivo")" != "$alvo" ]]; then
    echo "  DIVERGE $nome — SHA-256 não confere" >&2
    return 1
  fi
  echo "  ok      $nome"
}

baixar() {
  local nome="$1" url="$2" arquivo="$DESTINO/$1"
  if [[ -f "$arquivo" ]] && conferir "$nome" >/dev/null 2>&1; then
    echo "  já ok   $nome"
    return 0
  fi
  echo "  baixando $nome ..."
  curl -sL --fail "$url" -o "$arquivo.parcial"
  local alvo; alvo="$(esperado "$nome")"
  if [[ -n "$alvo" && "$(sha "$arquivo.parcial")" != "$alvo" ]]; then
    rm -f "$arquivo.parcial"
    echo "  RECUSADO $nome: SHA-256 diferente do MANIFESTO.json" >&2
    echo "  O arquivo publicado mudou. Não use sem revisar a origem." >&2
    return 1
  fi
  if [[ -z "$alvo" ]]; then
    # Falha fechado: instalar artefato sem hash conferido derrota o propósito
    # do manifesto. Modelo é código que roda — um .onnx trocado decide o que o
    # OCR lê e, por tabela, o que a anonimização deixa passar.
    rm -f "$arquivo.parcial"
    echo "  RECUSADO $nome: não há entrada no MANIFESTO.json." >&2
    echo "  Para adotar este arquivo, registre o SHA-256 dele no manifesto" >&2
    echo "  depois de conferir a origem. Baixado, o hash é:" >&2
    return 1
  fi
  mv "$arquivo.parcial" "$arquivo"
}

ARQUIVOS=(
  "PP-OCRv6_det_${PERFIL}.onnx|https://huggingface.co/PaddlePaddle/PP-OCRv6_${PERFIL}_det_onnx/resolve/main/inference.onnx"
  "PP-OCRv6_rec_${PERFIL}.onnx|https://huggingface.co/PaddlePaddle/PP-OCRv6_${PERFIL}_rec_onnx/resolve/main/inference.onnx"
  "ch_ppocr_mobile_v2.0_cls_mobile.onnx|$CLS_URL"
)

if (( modo_verificacao )); then
  echo "Conferindo resources/ocr-models/ contra o MANIFESTO.json:"
  falhou=0
  for par in "${ARQUIVOS[@]}"; do
    conferir "${par%%|*}" || falhou=1
  done
  conferir "PP-OCRv6_rec_dict.txt" || falhou=1
  if (( falhou )); then
    echo "Rode: scripts/fetch-ocr-models.sh $PERFIL" >&2
    exit 1
  fi
  echo "Modelos em dia."
  exit 0
fi

echo "Modelos de OCR (perfil $PERFIL) em resources/ocr-models/:"
for par in "${ARQUIVOS[@]}"; do
  baixar "${par%%|*}" "${par##*|}"
done

# O dicionário de caracteres do reconhecedor. O ONNX oficial não o embute na
# metadata (o convertido pela RapidAI embute), então ele sai do inference.yml.
DICT="$DESTINO/PP-OCRv6_rec_dict.txt"
if [[ ! -f "$DICT" ]]; then
  echo "  extraindo PP-OCRv6_rec_dict.txt ..."
  "$PY_CMD" - "$PERFIL" "$(para_python "$DICT")" <<'PY'
import sys, urllib.request, yaml, pathlib
perfil, destino = sys.argv[1], sys.argv[2]
url = f"https://huggingface.co/PaddlePaddle/PP-OCRv6_{perfil}_rec_onnx/raw/main/inference.yml"
cfg = yaml.safe_load(urllib.request.urlopen(url).read().decode("utf-8"))
chars = cfg["PostProcess"]["character_dict"]
# O newline explícito não é detalhe: em modo texto o Windows reescreve cada \n
# como \r\n, e o arquivo sai com o dobro de quebras — mesmo conteúdo, outros
# bytes, outro SHA-256. O MANIFESTO.json pina bytes, então o --check recusava o
# dicionário recém-extraído na própria máquina que acabara de gerá-lo.
pathlib.Path(destino).write_text(
    "\n".join(chars) + "\n", encoding="utf-8", newline="\n"
)
print(f"  {len(chars)} caracteres")
PY
else
  echo "  já ok   PP-OCRv6_rec_dict.txt"
fi

echo
echo "Confira com: scripts/fetch-ocr-models.sh --check"
