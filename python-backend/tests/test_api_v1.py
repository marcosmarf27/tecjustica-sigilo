"""
A API local não pode virar uma porta de leitura do disco — nem para um cliente
pareado.

O pareamento resolve a descoberta e a autorização, mas cria uma superfície que
não existia: até aqui, quem falava com o backend era só a janela do aplicativo,
com escopo total. Agora há credenciais de terceiros circulando, e estes testes
travam as três garantias que as tornam aceitáveis:

1. `arquivo-local` **nunca** é concedido em pareamento, mesmo quando pedido;
2. token revogado para de funcionar na hora;
3. cliente externo não alcança rota fora dos seus escopos.
"""

import os

import pytest

# O conftest define `PRESIDIO_TOKEN` antes de qualquer import de `server`, que
# lê o token na carga do módulo. Ler daqui, em vez de repetir o literal, evita
# que dois arquivos discordem — foi o que fez o primeiro a importar ganhar e os
# outros levarem 403.
TOKEN = os.environ["PRESIDIO_TOKEN"]


@pytest.fixture(scope="module")
def cliente(tmp_path_factory):
    # Registro de clientes num diretório descartável, para o teste não sujar o
    # perfil de quem roda a suíte. O token vem do conftest.
    os.environ["PRESIDIO_DADOS"] = str(tmp_path_factory.mktemp("dados"))

    from fastapi.testclient import TestClient

    import server
    from engine import get_engine

    # As rotas que anonimizam de verdade precisam do motor de pé; sem isto, o
    # teste de "as rotas antigas continuam funcionando" mediria o motor
    # desligado em vez do roteamento.
    get_engine().initialize()
    return TestClient(server.app)


@pytest.fixture
def cabecalho():
    return {"X-Presidio-Token": TOKEN}


def parear(cliente, nome, escopos):
    """Faz o ciclo completo de pareamento e devolve o token do cliente."""
    aberto = cliente.post("/v1/parear", json={"nome": nome, "escopos": escopos})
    assert aberto.status_code == 202
    pedido = aberto.json()

    aprovado = cliente.post(
        f"/v1/pedidos/{pedido['pedido']}/decidir",
        params={"aprovado": True},
        headers={"X-Presidio-Token": TOKEN},
    )
    assert aprovado.status_code == 200

    entrega = cliente.get(f"/v1/parear/{pedido['pedido']}")
    assert entrega.status_code == 200
    return entrega.json()["token"], pedido


def test_info_e_publica_e_descreve_a_instalacao(cliente):
    """Um cliente precisa saber com o que fala antes de pedir pareamento."""
    resposta = cliente.get("/v1/info")
    assert resposta.status_code == 200

    corpo = resposta.json()
    assert corpo["api"] == 1
    assert "modo_nlp" in corpo["motor"]
    assert corpo["politicas"]
    assert corpo["formatos"]
    assert "PP-OCRv6" in corpo["ocr"]["motor"]

    # E não pode entregar nada que dependa de credencial.
    assert "clientes" not in corpo


def test_rotas_v1_exigem_credencial(cliente):
    assert cliente.post("/v1/anonimizar", json={"texto": "x"}).status_code == 403
    assert cliente.get("/v1/clientes").status_code == 403


def test_pareamento_mostra_o_mesmo_codigo_nos_dois_lados(cliente, cabecalho):
    aberto = cliente.post(
        "/v1/parear", json={"nome": "Extensão PJe", "escopos": ["anonimizar"]}
    )
    assert aberto.status_code == 202
    codigo_do_cliente = aberto.json()["codigo"]
    assert len(codigo_do_cliente) == 6

    # A janela do aplicativo vê o mesmo código na lista de pendentes — é o que
    # impede uma aprovação às cegas.
    pendentes = cliente.get("/v1/pedidos", headers=cabecalho).json()["pedidos"]
    meu = next(p for p in pendentes if p["id"] == aberto.json()["pedido"])
    assert meu["codigo"] == codigo_do_cliente
    assert meu["nome"] == "Extensão PJe"


def test_escopo_arquivo_local_nunca_e_concedido(cliente):
    """
    Pedir `arquivo-local` não é erro — é um pedido que não se atende.

    O cliente recebe o pareamento sem esse escopo, e leva 403 ao tentar usá-lo.
    É a diferença entre um cliente externo mandar um documento que ele já tem e
    um cliente externo poder mandar o backend abrir qualquer arquivo do disco.
    """
    token, pedido = parear(
        cliente, "cliente ambicioso", ["anonimizar", "arquivo-local", "ocr"]
    )

    assert "arquivo-local" not in pedido["escopos_concedidos"]
    assert sorted(pedido["escopos_concedidos"]) == ["anonimizar", "ocr"]

    # E na prática: `/processar` com caminho continua fora de alcance.
    resposta = cliente.post(
        "/processar",
        json={"caminho": "C:\\Windows\\win.ini"},
        headers={"X-Presidio-Token": token},
    )
    assert resposta.status_code == 403


def test_cliente_pareado_alcanca_so_os_proprios_escopos(cliente):
    token, _ = parear(cliente, "só anonimiza", ["anonimizar"])
    cabecalho_cliente = {"X-Presidio-Token": token}

    # Dentro do escopo: passa pelo middleware (o 200/503 depende do motor).
    dentro = cliente.post(
        "/v1/anonimizar", json={"texto": "CPF 529.982.247-25"}, headers=cabecalho_cliente
    )
    assert dentro.status_code != 403

    # Fora do escopo: 403, mesmo com credencial válida.
    fora = cliente.post(
        "/v1/ocr",
        files={"file": ("p.png", b"nao-e-imagem", "image/png")},
        headers=cabecalho_cliente,
    )
    assert fora.status_code == 403

    # Rotas administrativas não são alcançáveis por cliente nenhum.
    assert cliente.get("/v1/clientes", headers=cabecalho_cliente).status_code == 403
    assert (
        cliente.get("/config/deny-list", headers=cabecalho_cliente).status_code == 403
    )


def test_token_revogado_volta_a_dar_403(cliente, cabecalho):
    token, _ = parear(cliente, "a revogar", ["anonimizar"])
    cabecalho_cliente = {"X-Presidio-Token": token}

    antes = cliente.post(
        "/v1/anonimizar", json={"texto": "olá"}, headers=cabecalho_cliente
    )
    assert antes.status_code != 403

    registrados = cliente.get("/v1/clientes", headers=cabecalho).json()["clientes"]
    alvo = next(c for c in registrados if c["nome"] == "a revogar")
    # O hash do token não pode vazar na listagem.
    assert "hash_token" not in alvo

    apagado = cliente.delete(f"/v1/clientes/{alvo['id']}", headers=cabecalho)
    assert apagado.status_code == 200

    depois = cliente.post(
        "/v1/anonimizar", json={"texto": "olá"}, headers=cabecalho_cliente
    )
    assert depois.status_code == 403, "token revogado tem de parar de funcionar"


def test_token_do_pareamento_sai_uma_vez_so(cliente, cabecalho):
    aberto = cliente.post(
        "/v1/parear", json={"nome": "uma vez", "escopos": ["anonimizar"]}
    ).json()
    cliente.post(
        f"/v1/pedidos/{aberto['pedido']}/decidir",
        params={"aprovado": True},
        headers=cabecalho,
    )

    primeira = cliente.get(f"/v1/parear/{aberto['pedido']}")
    assert primeira.status_code == 200 and primeira.json()["token"]

    # O id do pedido viaja na URL; deixá-lo reler a credencial o transformaria
    # numa segunda credencial.
    segunda = cliente.get(f"/v1/parear/{aberto['pedido']}")
    assert segunda.status_code == 404


def test_pedido_negado_nao_entrega_token(cliente, cabecalho):
    aberto = cliente.post(
        "/v1/parear", json={"nome": "recusado", "escopos": ["anonimizar"]}
    ).json()

    cliente.post(
        f"/v1/pedidos/{aberto['pedido']}/decidir",
        params={"aprovado": False},
        headers=cabecalho,
    )

    resposta = cliente.get(f"/v1/parear/{aberto['pedido']}")
    assert resposta.status_code == 403
    assert "token" not in resposta.json()


def test_pareamento_pendente_responde_202(cliente):
    aberto = cliente.post(
        "/v1/parear", json={"nome": "esperando", "escopos": ["anonimizar"]}
    ).json()
    resposta = cliente.get(f"/v1/parear/{aberto['pedido']}")
    assert resposta.status_code == 202
    assert resposta.json()["estado"] == "pendente"


def test_documento_recusa_formato_fora_da_lista(cliente, cabecalho):
    """A v1 recebe o arquivo enviado, e ainda assim só nos formatos que lê."""
    resposta = cliente.post(
        "/v1/documento",
        files={"file": ("senhas.conf", b"nada", "text/plain")},
        headers=cabecalho,
    )
    assert resposta.status_code == 415


def test_rotas_antigas_continuam_funcionando(cliente, cabecalho):
    """A v1 é acréscimo. O renderer não pode quebrar."""
    assert cliente.get("/health").status_code == 200
    assert cliente.get("/config/deny-list", headers=cabecalho).status_code == 200
    assert (
        cliente.post(
            "/anonymize",
            json={"text": "teste", "entities": []},
            headers=cabecalho,
        ).status_code
        == 200
    )


def test_entidade_com_espaco_ainda_mascara(cliente, cabecalho):
    """
    `entidades=" CPF_BR"` tem de mascarar o CPF.

    A checagem era `if e.strip()` e o valor guardado era `e`, com o espaço. O
    nome ia para o motor como `" CPF_BR"`, não casava com recognizer nenhum, e o
    pedido de mascarar CPF era **silenciosamente ignorado** — o CPF saía em
    claro na resposta. Um cliente que monta a lista com `", ".join(tipos)`, que é
    o idioma natural em qualquer linguagem, caía nisso em toda chamada.
    """
    cpf = "529.982.247-25"
    resposta = cliente.post(
        "/v1/documento",
        files={"file": ("peticao.pdf", _pdf_com(f"CPF {cpf} do requerente."), "application/pdf")},
        data={"entidades": " CPF_BR , PERSON ", "anonimizar_texto": "true"},
        headers=cabecalho,
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert cpf not in corpo["texto_anonimizado"], "o CPF vazou apesar de pedido"


def test_documento_grande_e_recusado_sem_derrubar_o_backend(cliente, cabecalho, monkeypatch):
    """
    Corpo acima do teto responde 413 em vez de consumir memória sem limite.

    Antes o corpo inteiro era materializado com `await file.read()` para só
    então ser copiado para o temporário. Um processo de dois GB virava dois GB
    de RAM mais a cópia, o Python morria por falta de memória e levava junto o
    backend do aplicativo — a janela voltava a "Carregando motor de
    anonimização" sem explicação nenhuma.
    """
    import api_v1

    monkeypatch.setattr(api_v1, "LIMITE_UPLOAD_BYTES", 4096)
    resposta = cliente.post(
        "/v1/documento",
        files={"file": ("grande.pdf", b"x" * 20000, "application/pdf")},
        headers=cabecalho,
    )
    assert resposta.status_code == 413
    # E o backend continua de pé para a próxima requisição.
    assert cliente.get("/health").status_code == 200


def _pdf_com(texto: str) -> bytes:
    """PDF mínimo de uma página, com o texto em Helvetica."""
    fluxo = f"BT /F1 12 Tf 72 720 Td ({texto}) Tj ET".encode("latin-1")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(fluxo)).encode() + b" >>\nstream\n" + fluxo + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    saida = bytearray(b"%PDF-1.4\n")
    posicoes = []
    for i, objeto in enumerate(objetos, start=1):
        posicoes.append(len(saida))
        saida += f"{i} 0 obj\n".encode() + objeto + b"\nendobj\n"

    inicio_xref = len(saida)
    saida += f"xref\n0 {len(objetos) + 1}\n".encode()
    saida += b"0000000000 65535 f \n"
    for posicao in posicoes:
        saida += f"{posicao:010d} 00000 n \n".encode()
    saida += (
        f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
        f"startxref\n{inicio_xref}\n%%EOF\n"
    ).encode()
    return bytes(saida)
