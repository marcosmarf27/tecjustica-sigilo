"""
Quem o CORS deixa ler a resposta do backend.

O `action-required.md` listava "preflight CORS a partir de uma extensão de
verdade" como item que só um humano fecha. Isso vale para **metade** da
verificação: forjar uma origem `chrome-extension://` legítima exige uma extensão
instalada, e o navegador é quem impõe a regra — os testes falam HTTP direto.

Mas a metade que protege o usuário é a **negativa**: uma página web comum não
pode ler a resposta. `127.0.0.1` não protege nada — qualquer página aberta no
navegador alcança portas locais —, e é o CORS que decide quem enxerga o que
voltou. Essa metade é testável aqui, e é a que faltava.

O que continua exigindo humano, e fica dito: confirmar que uma extensão real
**consegue** passar. Um regex que recusa todo mundo passaria nestes testes.
"""

import os

import pytest
from fastapi.testclient import TestClient

TOKEN = os.environ["PRESIDIO_TOKEN"]

# 32 letras no intervalo a–p, como o Chrome gera.
EXTENSAO_VALIDA = "chrome-extension://" + "abcdefghijklmnop" * 2


@pytest.fixture(scope="module")
def cliente(tmp_path_factory):
    os.environ["PRESIDIO_DADOS"] = str(tmp_path_factory.mktemp("dados"))
    import server

    return TestClient(server.app)


@pytest.mark.parametrize(
    "origem",
    [
        "http://localhost:3000",
        "https://exemplo.com.br",
        "http://127.0.0.1:5173",
        "null",
        "file://",
        # Parecida, mas não é: origem de extensão tem 32 letras de a–p.
        "chrome-extension://naoehumidentificadorvalido",
        "chrome-extension://" + "z" * 32,
        "chrome-extension://" + "abcdefghijklmnop" * 3,
    ],
)
def test_pagina_comum_nao_pode_ler_a_resposta(cliente, origem):
    """
    Sem `Access-Control-Allow-Origin`, o navegador esconde a resposta de quem
    pediu — mesmo que a requisição tenha chegado. É a diferença entre uma página
    maliciosa **alcançar** a porta local e conseguir **ler** o que voltou.
    """
    resposta = cliente.options(
        "/v1/info",
        headers={
            "Origin": origem,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-presidio-token",
        },
    )
    assert "access-control-allow-origin" not in {
        k.lower() for k in resposta.headers
    }, f"a origem {origem!r} não pode receber permissão de leitura"


def test_extensao_com_origem_valida_passa_no_preflight(cliente):
    """
    A metade positiva, até onde dá sem navegador.

    Não substitui testar com uma extensão instalada — só o renderer dentro do
    Chromium impõe a regra de verdade —, mas garante que o regex não recusa
    todo mundo. Sem isto, os testes negativos acima passariam com um CORS que
    bloqueia até a extensão legítima, e ninguém notaria até alguém tentar usar.
    """
    resposta = cliente.options(
        "/v1/info",
        headers={
            "Origin": EXTENSAO_VALIDA,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-presidio-token",
        },
    )
    assert resposta.headers.get("access-control-allow-origin") == EXTENSAO_VALIDA


def test_o_cabecalho_do_token_e_liberado_no_preflight(cliente):
    """
    `X-Presidio-Token` é cabeçalho customizado, e é ele que torna a requisição
    não-simples: o navegador manda um OPTIONS antes. Este é exatamente o buraco
    que já travou a tela em "Carregando motor de anonimização" com o backend no
    ar — o preflight era reprovado e o `catch` do hook engolia o erro.
    """
    resposta = cliente.options(
        "/v1/info",
        headers={
            "Origin": EXTENSAO_VALIDA,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-presidio-token,content-type",
        },
    )
    permitidos = resposta.headers.get("access-control-allow-headers", "").lower()
    assert "x-presidio-token" in permitidos or permitidos == "*"
