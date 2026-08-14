"""
A API local não pode virar uma porta de leitura do disco.

O servidor escuta em 127.0.0.1, mas isso sozinho não protege nada: qualquer
página aberta no navegador da máquina consegue falar com uma porta local. E
`/processar` abre um arquivo pelo caminho e devolve o conteúdo — sem
credencial, um site qualquer poderia mandar o backend ler documentos e
exfiltrar o texto.

Estes testes travam as duas defesas: o token de sessão e a restrição de
formato.
"""

import os

import pytest

TOKEN = "token-de-teste"


@pytest.fixture(scope="module")
def cliente():
    # Definido antes do import: o servidor lê o token na carga do módulo.
    os.environ["PRESIDIO_TOKEN"] = TOKEN
    os.environ.setdefault("PRESIDIO_NLP_MODE", "spacy")

    from fastapi.testclient import TestClient

    import server
    from engine import get_engine

    get_engine().initialize()
    return TestClient(server.app)


@pytest.fixture
def cabecalho():
    return {"X-Presidio-Token": TOKEN}


def test_health_dispensa_credencial(cliente):
    """É por /health que a interface descobre que o backend subiu."""
    assert cliente.get("/health").status_code == 200


def test_processar_sem_token_e_recusado(cliente):
    resposta = cliente.post("/processar", json={"caminho": "/etc/passwd"})
    assert resposta.status_code == 403


def test_token_errado_e_recusado(cliente):
    resposta = cliente.post(
        "/processar",
        json={"caminho": "/etc/passwd"},
        headers={"X-Presidio-Token": "chute"},
    )
    assert resposta.status_code == 403


def test_anonymize_sem_token_e_recusado(cliente):
    resposta = cliente.post(
        "/anonymize", json={"text": "CPF 123.456.789-09", "entities": []}
    )
    assert resposta.status_code == 403


def test_deny_list_sem_token_e_recusada(cliente):
    """Escrever na lista de exceções muda o que o motor mascara."""
    assert cliente.get("/config/deny-list").status_code == 403
    assert cliente.post("/config/deny-list", json={"deny_list": {}}).status_code == 403


def test_arquivo_fora_dos_formatos_suportados(cliente, cabecalho):
    """
    Mesmo com credencial válida, só os formatos que o app declara ler são
    aceitos — a credencial protege de sites, não de um caminho digitado errado.
    """
    resposta = cliente.post(
        "/processar", json={"caminho": "/etc/passwd"}, headers=cabecalho
    )
    assert resposta.status_code == 415


def test_arquivo_inexistente(cliente, cabecalho):
    resposta = cliente.post(
        "/processar", json={"caminho": "/tmp/nao-existe-mesmo.pdf"}, headers=cabecalho
    )
    assert resposta.status_code == 404


def test_texto_com_credencial_e_aceito(cliente, cabecalho):
    resposta = cliente.post(
        "/processar",
        json={"texto": "CPF 123.456.789-09", "entities": []},
        headers=cabecalho,
    )
    assert resposta.status_code == 200
    assert "job_id" in resposta.json()
