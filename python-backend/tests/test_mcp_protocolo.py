"""
O servidor MCP responde a um cliente de verdade?

O `action-required.md` listava "registrar o MCP num cliente real" como item
humano, e o `smoke-backend.sh` só confere que o módulo **importa** e declara
quatro ferramentas. Nada exercitava o protocolo — a afirmação "foi testado por
stdio" não tinha teste nenhum por trás.

Isto sobe o comando de verdade (`cli.py mcp`), como um cliente MCP faria, e fala
JSON-RPC 2.0 pelo stdin/stdout dele: `initialize`, `tools/list`, `tools/call`.

O que continua humano, e fica dito: registrar no Claude Code ou Desktop e ver o
agente escolher a ferramenta certa. Isso é comportamento de cliente, não
contrato de protocolo. O contrato é o que se testa aqui.
"""

import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]


INICIALIZAR = [
    {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "teste", "version": "1"},
        },
    },
    # **Obrigatória.** O protocolo MCP exige que o cliente confirme a
    # inicialização antes de qualquer outra chamada, e o SDK oficial recusa
    # com `-32602 Invalid request parameters` quem pular esta linha — e depois
    # PARA de responder. Foi o que me fez suspeitar do servidor quando o
    # errado era o meu cliente de teste.
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
]


def _falar_mcp(pedidos: list[dict], timeout: int = 180) -> list[dict]:
    """
    Conversa com o servidor mantendo o canal **aberto**, como um cliente real.

    Despejar tudo e fechar o stdin não serve: o SDK encerra a sessão ao ver EOF
    e cancela as chamadas em voo. Um `tools/call` que roda numa thread — e todos
    rodam, porque alguns levam minutos — simplesmente nunca responde. Foi o que
    me fez achar que `tools/call` estava quebrado quando quebrado estava o
    cliente de teste.
    """
    proc = subprocess.Popen(
        [sys.executable, "-u", str(RAIZ / "cli.py"), "mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(RAIZ),
        bufsize=1,
    )

    esperadas = sum(1 for p in INICIALIZAR + pedidos if "id" in p)
    respostas: list[dict] = []
    erro_de_leitura: list[BaseException] = []

    def ler() -> None:
        try:
            for linha in proc.stdout:  # type: ignore[union-attr]
                linha = linha.strip()
                if not linha.startswith("{"):
                    continue
                try:
                    respostas.append(json.loads(linha))
                except json.JSONDecodeError:
                    continue
                if len(respostas) >= esperadas:
                    return
        except BaseException as erro:  # noqa: BLE001
            erro_de_leitura.append(erro)

    leitor = threading.Thread(target=ler, daemon=True)
    leitor.start()

    try:
        for pedido in INICIALIZAR + pedidos:
            proc.stdin.write(json.dumps(pedido, ensure_ascii=False) + "\n")  # type: ignore[union-attr]
            proc.stdin.flush()  # type: ignore[union-attr]
        leitor.join(timeout)
    finally:
        proc.stdin.close()  # type: ignore[union-attr]
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()

    if erro_de_leitura:
        pytest.fail(f"falha lendo a saída do servidor: {erro_de_leitura[0]!r}")
    if not respostas:
        stderr = (proc.stderr.read() if proc.stderr else "")[:600]
        pytest.fail(f"o servidor MCP não respondeu nada em JSON.\nstderr: {stderr}")
    return respostas



def _por_id(respostas: list[dict], id_: int) -> dict:
    for r in respostas:
        if r.get("id") == id_:
            return r
    pytest.fail(f"sem resposta para o id {id_}; recebi {[r.get('id') for r in respostas]}")


def test_o_ciclo_que_todo_cliente_mcp_faz():
    """
    `initialize` → `tools/list` → `tools/call`, na ordem, num processo só.

    É exatamente o que o Claude Code faz ao registrar um servidor. Se qualquer
    um dos três falhar, o servidor não serve para nada — e nada acusava isso.
    """
    respostas = _falar_mcp(
        [
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
                "name": "status", "arguments": {},
            }},
        ]
    )

    inicio = _por_id(respostas, 0)
    assert "error" not in inicio, inicio
    assert inicio["result"]["serverInfo"]["name"] == "tecjustica-sigilo"

    lista = _por_id(respostas, 2)
    assert "error" not in lista, lista
    nomes = {f["name"] for f in lista["result"]["tools"]}
    assert nomes == {"anonimizar_texto", "ler_documento", "ocr_imagem", "status"}, nomes

    chamada = _por_id(respostas, 3)
    assert "error" not in chamada, chamada
    texto = chamada["result"]["content"][0]["text"]
    # `status` responde sem carregar motor: diz se o aplicativo está aberto.
    assert json.loads(texto)["aplicativo"] in ("aberto", "fechado")


def test_toda_ferramenta_se_descreve_com_esquema():
    """
    Sem `inputSchema`, o agente não sabe o que passar e a ferramenta é inútil
    mesmo estando listada.
    """
    respostas = _falar_mcp(
        [{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}]
    )
    for f in _por_id(respostas, 1)["result"]["tools"]:
        assert f.get("description"), f"{f['name']} sem descrição"
        esquema = f.get("inputSchema") or f.get("input_schema")
        assert esquema, f"{f['name']} sem inputSchema"
        assert esquema.get("type") == "object", f["name"]


def test_ferramenta_desconhecida_vira_erro_e_nao_derruba_o_servidor():
    """
    Um agente chama o que quiser. O servidor tem de recusar e **continuar** —
    morrer aqui derrubaria a sessão MCP inteira do cliente.
    """
    respostas = _falar_mcp(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "ferramenta_que_nao_existe", "arguments": {},
            }},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        ]
    )
    erro = _por_id(respostas, 1)
    assert "error" in erro or erro.get("result", {}).get("isError"), erro
    # E o servidor continua atendendo depois da recusa.
    assert len(_por_id(respostas, 2)["result"]["tools"]) == 4
