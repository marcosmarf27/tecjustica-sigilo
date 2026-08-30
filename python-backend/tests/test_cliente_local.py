"""
Descoberta do aplicativo pela CLI, pelo MCP e por qualquer cliente local.

O que se testa aqui não é conveniência: é para onde o conteúdo dos autos vai.
`app_no_ar()` decide se a porta anunciada no `sessao.json` é mesmo deste
aplicativo. Se ela aprovar um impostor, o passo seguinte do chamador é um POST
com o texto do processo para um programa desconhecido rodando na máquina.

O cenário é real e não exige má-fé de ninguém: o `sessao.json` é apagado no
`before-quit`, que não roda numa queda de energia nem quando o processo é morto
pelo gerenciador de tarefas. O arquivo sobra, a porta 8123 volta ao pool do
sistema e o próximo programa que subir pode ficar com ela.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import cliente_local


class _Resposta:
    """O que o servidor falso devolve em `/v1/info`. Trocado por teste."""

    status = 200
    corpo: object = {"produto": "TecJustiça Sigilo", "api": 1}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — assinatura da biblioteca padrão
        corpo = _Resposta.corpo
        dados = (
            corpo.encode("utf-8")
            if isinstance(corpo, str)
            else json.dumps(corpo).encode("utf-8")
        )
        self.send_response(_Resposta.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def log_message(self, *_):  # silencia o log no stderr do pytest
        pass


@pytest.fixture
def servidor():
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def sessao_apontando(tmp_path, servidor, monkeypatch):
    """Um `sessao.json` apontando para o servidor falso."""
    porta = servidor.server_address[1]
    (tmp_path / "sessao.json").write_text(
        json.dumps({"porta": porta, "pid": 4242, "api": "habilitada"}),
        encoding="utf-8",
        newline="\n",
    )
    monkeypatch.setattr(cliente_local, "_raizes_de_dados", lambda: [tmp_path])
    # Cada teste começa com o servidor se identificando corretamente.
    _Resposta.status = 200
    _Resposta.corpo = {"produto": "TecJustiça Sigilo", "api": 1}
    return porta


def test_aceita_quando_o_app_se_identifica(sessao_apontando):
    sessao = cliente_local.app_no_ar()
    assert sessao is not None
    assert sessao.porta == sessao_apontando


def test_recusa_impostor_que_responde_200(sessao_apontando):
    """
    O achado que motivou este arquivo.

    A checagem antiga era `status != 200`. Qualquer servidor JSON que tivesse
    ficado com a porta passava, e o cliente seguia para o POST com os autos.
    """
    _Resposta.corpo = {"ok": True, "servico": "outra-coisa"}
    assert cliente_local.app_no_ar() is None


def test_recusa_produto_parecido(sessao_apontando):
    _Resposta.corpo = {"produto": "Outro Anonimizador", "api": 1}
    assert cliente_local.app_no_ar() is None


def test_recusa_versao_de_api_diferente(sessao_apontando):
    """Contrato incompatível é tão inútil quanto porta errada — e mais enganoso."""
    _Resposta.corpo = {"produto": "TecJustiça Sigilo", "api": 2}
    assert cliente_local.app_no_ar() is None


def test_recusa_resposta_que_nao_e_json(sessao_apontando):
    """Um servidor de páginas na porta: responde 200 com HTML."""
    _Resposta.corpo = "<!doctype html><title>outro app</title>"
    assert cliente_local.app_no_ar() is None


def test_recusa_json_que_nao_e_objeto(sessao_apontando):
    """`corpo.get` num `list` estouraria; a checagem de tipo vem antes."""
    _Resposta.corpo = ["TecJustiça Sigilo"]
    assert cliente_local.app_no_ar() is None


def test_recusa_erro_http(sessao_apontando):
    _Resposta.status = 503
    assert cliente_local.app_no_ar() is None


def test_sem_sessao_json_nao_ha_app(tmp_path, monkeypatch):
    monkeypatch.setattr(cliente_local, "_raizes_de_dados", lambda: [tmp_path])
    assert cliente_local.app_no_ar() is None


def test_porta_fechada_nao_ha_app(tmp_path, monkeypatch):
    """Porta sem ninguém ouvindo: conexão recusada, e não uma espera longa."""
    (tmp_path / "sessao.json").write_text(
        json.dumps({"porta": 1, "pid": 4242, "api": "habilitada"}),
        encoding="utf-8",
        newline="\n",
    )
    monkeypatch.setattr(cliente_local, "_raizes_de_dados", lambda: [tmp_path])
    assert cliente_local.app_no_ar() is None
