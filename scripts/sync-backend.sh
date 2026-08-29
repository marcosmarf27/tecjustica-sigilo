#!/usr/bin/env bash
#
# Copia o backend Python para resources/, que é o que o electron-builder
# empacota no instalador.
#
# Por que isto existe: resources/python-backend/ é gitignored (carrega o Python
# embarcado de ~1,4 GB) e vinha sendo atualizado à mão. O resultado previsível
# é drift silencioso — o instalador saindo com uma versão do motor diferente da
# que foi testada. Este script torna a cópia reproduzível e verificável.
#
# O que NÃO é tocado: python-embed/ (o interpretador e as bibliotecas) e o
# cache do modelo. Para atualizar as bibliotecas, use o pip do próprio
# python-embed com requirements.txt.
#
# Os modelos do OCR (PP-OCRv6 em ONNX) são copiados junto: sem eles o motor
# buscaria os arquivos na rede na primeira execução, quebrando a promessa de
# operação offline.
#
# Uso:
#   scripts/sync-backend.sh            # copia
#   scripts/sync-backend.sh --check    # só verifica se está em dia (CI)

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGEM="$RAIZ/python-backend"
DESTINO="$RAIZ/resources/python-backend"

# Tudo que o backend precisa em tempo de execução. `tests/` e `eval/` ficam de
# fora de propósito: são ferramentas de desenvolvimento e só engordariam o
# instalador.
ARQUIVOS=(
  engine.py
  recognizers.py
  validators.py
  mask_config.py
  config_loader.py
  documentos.py
  ocr_engine.py
  jobs.py
  server.py
  cli.py
  requirements.txt
  # Atalho de linha de comando do Windows. Vivia só em resources/, fora do
  # git — o nome do arquivo é o próprio nome do comando, então ele precisa
  # acompanhar o versionamento como qualquer outro fonte.
  tecjustica-sigilo.cmd
)
CONFIGS=(
  config/deny_list.json
  config/context_words.json
)

# Copiados de resources/ocr-models/ (fora do backend), então tratados à parte.
# O MANIFESTO.json vai junto: é ele que o backend confere no startup.
MODELOS_ORIGEM="$RAIZ/resources/ocr-models"
MODELOS_DESTINO="$DESTINO/ocr-models"

modo_verificacao=0
[[ "${1:-}" == "--check" ]] && modo_verificacao=1

if [[ ! -d "$DESTINO" ]]; then
  if (( modo_verificacao )); then
    # Isto costumava sair com 0 ("nada a verificar"). Mas num checkout limpo de
    # CI é exatamente o caso em que NADA seria empacotado — a verificação
    # declarava sucesso justamente no pior cenário. Falha fechado.
    echo "resources/python-backend/ não existe: o instalador sairia sem backend." >&2
    echo "Rode: scripts/sync-backend.sh" >&2
    exit 1
  fi
  mkdir -p "$DESTINO/config"
fi

divergentes=()

verificar_ou_copiar() {
  local relativo="$1"
  local origem="$ORIGEM/$relativo"
  local destino="$DESTINO/$relativo"

  [[ -f "$origem" ]] || { echo "ausente na origem: $relativo" >&2; return 1; }

  if (( modo_verificacao )); then
    if [[ ! -f "$destino" ]] || ! cmp -s "$origem" "$destino"; then
      divergentes+=("$relativo")
    fi
  else
    mkdir -p "$(dirname "$destino")"
    cp "$origem" "$destino"
    echo "  $relativo"
  fi
}

(( modo_verificacao )) || echo "Copiando backend para resources/:"

for arquivo in "${ARQUIVOS[@]}" "${CONFIGS[@]}"; do
  verificar_ou_copiar "$arquivo"
done

# Modelos do OCR. O conjunto tem de estar completo: copiar "o que houver"
# produziria um instalador que só descobre a falta na primeira página
# escaneada, na máquina do usuário.
MODELOS_EXIGIDOS=(
  MANIFESTO.json
  PP-OCRv6_det_small.onnx
  PP-OCRv6_rec_small.onnx
  PP-OCRv6_rec_dict.txt
  ch_ppocr_mobile_v2.0_cls_mobile.onnx
)
faltando=()
for nome in "${MODELOS_EXIGIDOS[@]}"; do
  [[ -f "$MODELOS_ORIGEM/$nome" ]] || faltando+=("$nome")
done
if (( ${#faltando[@]} )); then
  echo "Faltam modelos em resources/ocr-models/:" >&2
  printf '  %s\n' "${faltando[@]}" >&2
  echo "Rode: scripts/fetch-ocr-models.sh" >&2
  exit 1
fi

if [[ -d "$MODELOS_ORIGEM" ]]; then
  for origem in "$MODELOS_ORIGEM"/*; do
    [[ -f "$origem" ]] || continue
    nome="$(basename "$origem")"
    destino="$MODELOS_DESTINO/$nome"
    if (( modo_verificacao )); then
      if [[ ! -f "$destino" ]] || ! cmp -s "$origem" "$destino"; then
        divergentes+=("ocr-models/$nome")
      fi
    else
      mkdir -p "$MODELOS_DESTINO"
      cp "$origem" "$destino"
      echo "  ocr-models/$nome"
    fi
  done
elif (( ! modo_verificacao )); then
  echo "  AVISO: resources/ocr-models/ não encontrado —" >&2
  echo "  o OCR vai baixar os modelos na primeira execução, o que exige internet." >&2
fi

if (( modo_verificacao )); then
  if (( ${#divergentes[@]} )); then
    echo "O backend do instalador está desatualizado:" >&2
    printf '  %s\n' "${divergentes[@]}" >&2
    echo "Rode: scripts/sync-backend.sh" >&2
    exit 1
  fi
  echo "Backend do instalador em dia."
else
  echo
  echo "Pronto."
  echo
  echo "Se requirements.txt mudou, as bibliotecas do Python embarcado precisam"
  echo "ser atualizadas À PARTE. O python-embed do Windows NÃO tem pip — o"
  echo "comando abaixo falha com 'No module named pip'. O jeito é resolver os"
  echo "wheels de Windows a partir daqui e copiar:"
  echo
  echo "  pip install --target /tmp/winlibs \\"
  echo "      --platform win_amd64 --python-version 3.12 --only-binary=:all: \\"
  echo "      --no-deps <pacote>==<versao> ..."
  echo "  cp -rn /tmp/winlibs/* resources/python-backend/python-embed/Lib/site-packages/"
  echo
  echo "Use --no-deps e pins explícitos: o resolvedor livre puxa versões que"
  echo "brigam com o que já está lá (ele tenta numpy 2.5, e o Presidio exige"
  echo "<2.5). Confira depois com:"
  echo "  resources/python-backend/python-embed/python.exe -c \"import rapidocr\""
fi
