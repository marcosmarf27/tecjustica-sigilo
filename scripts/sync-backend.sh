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
  server.py
  cli.py
  requirements.txt
)
CONFIGS=(
  config/deny_list.json
  config/context_words.json
)

modo_verificacao=0
[[ "${1:-}" == "--check" ]] && modo_verificacao=1

if [[ ! -d "$DESTINO" ]]; then
  if (( modo_verificacao )); then
    echo "resources/python-backend/ não existe — nada a verificar."
    exit 0
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
  echo "Pronto. Lembre de atualizar as bibliotecas do Python embarcado se"
  echo "requirements.txt mudou:"
  echo "  resources/python-backend/python-embed/python.exe -m pip install -r requirements.txt"
fi
