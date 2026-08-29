#!/usr/bin/env bash
#
# Importa o backend EMPACOTADO com o Python que vai no instalador.
#
# Por que isto existe: a rota /ocr recebe a página como multipart/form-data, e o
# FastAPI exige `python-multipart` para montá-la. Ele não falha ao chamar a rota
# — falha ao IMPORTAR o módulo, quando o decorador registra a rota. O pacote
# estava no venv de desenvolvimento e não no Python embarcado, então 110 testes
# passaram, o instalador foi gerado, e o backend morria na máquina do usuário. A
# tela ficava em "Carregando motor de anonimização" para sempre, sem erro
# visível, porque quem morreu foi o processo filho.
#
# Nenhum teste unitário pega isso: o que falta não é lógica, é um arquivo dentro
# do interpretador que vai no instalador. Só executá-lo pega.
#
# Importar cobre as rotas, que é onde o decorador falha. Mas não cobria tudo: o
# tokenizador do spaCy só é tocado quando o motor é construído, e o embarcado
# saiu uma vez sem `pt_core_news_lg` e sem `thinc`, com todas as rotas
# registradas e o import limpo. Por isso o `pt_core_news_lg` é carregado aqui
# também — custa segundos e é pré-requisito dos DOIS modos, não só do leve
# (no modo BERT ele entra como tokenizador; ver `_transformer_config`).
#
# O que continua de fora, de propósito: subir o servidor e baixar o BERT. São
# 2,5 GB que chegam na primeira execução do app, não no build.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$RAIZ/resources/python-backend"
PYTHON="$BACKEND/python-embed/python.exe"

if [[ ! -f "$PYTHON" ]]; then
  echo "python-embed/python.exe não encontrado — nada a verificar."
  echo "(esperado fora do Windows/WSL; o build só roda com ele presente)"
  exit 0
fi

VERIFICACAO='
import sys
import server
rotas = {getattr(r, "path", "") for r in server.app.routes}
faltando = {"/health", "/ocr", "/processar", "/anonymize"} - rotas
if faltando:
    print("ROTAS AUSENTES: %s" % sorted(faltando), file=sys.stderr)
    raise SystemExit(1)
print("ok: %d rotas registradas, inclusive /ocr" % len(rotas))

import spacy
spacy.load("pt_core_news_lg")
print("ok: pt_core_news_lg carrega (tokenizador dos dois modos)")
'

echo "Importando o backend com o Python embarcado."
echo "(pela ponte do WSL leva minutos — o torch é lido arquivo a arquivo)"

if ! saida="$(cd "$BACKEND" && "$PYTHON" -c "$VERIFICACAO" 2>&1)"; then
  echo "O BACKEND EMPACOTADO NÃO IMPORTA:" >&2
  echo "$saida" | tail -25 | sed 's/^/  /' >&2
  echo >&2
  echo "Falta biblioteca no python-embed? Veja o fim de scripts/sync-backend.sh." >&2
  exit 1
fi

echo "$saida" | sed 's/^/  /'
