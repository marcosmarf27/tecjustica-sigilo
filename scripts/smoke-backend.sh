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
# Importar basta — é onde as rotas são registradas. Não se sobe o servidor nem
# se carrega o modelo de linguagem: seriam mais minutos para testar o que já foi
# testado em outro lugar.
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
