"""
O motor de OCR e a rota que o liteparse chama.

Três coisas precisam ficar travadas aqui:

1. **A rota /ocr exige o token.** Ela é o único jeito de o liteparse falar com o
   motor, e é fácil pensar que precisa ser pública para o parse funcionar. Não
   precisa: o `documentos.configurar_ocr()` entrega o token ao liteparse. Aberta,
   ela daria a qualquer página do navegador um serviço de OCR grátis rodando com
   a CPU do usuário — e um vetor de negação de serviço no aplicativo.

2. **O contrato de saída é o do liteparse**, não o do RapidOCR. bbox eixo-alinhado
   com origem no canto superior esquerdo, confiança entre 0 e 1.

3. **Os modelos são os oficiais e são os que estão no disco.** Um .onnx trocado
   decide o que o OCR lê e, por tabela, o que a anonimização deixa passar.
"""

import os

import pytest

TOKEN = "token-de-teste"


@pytest.fixture(scope="module")
def cliente():
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


def _png_minimo() -> bytes:
    """Imagem branca 64x32 — o motor tem de aceitar e devolver lista vazia."""
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 32), "white").save(buffer, format="PNG")
    return buffer.getvalue()


# --- idioma -----------------------------------------------------------------


@pytest.mark.parametrize(
    "entrada",
    ["por", "pt", "pt-BR", "pt_br", "PT", " por ", "", None, "klingon"],
)
def test_idioma_sempre_vira_pt(entrada):
    """O liteparse manda `por`; o PP-OCRv6 só conhece `pt`.

    Idioma desconhecido também cai em `pt` em vez do `en` que o contrato sugere
    como padrão: este aplicativo só processa autos em português, e trocar de
    idioma por causa de um campo mal preenchido seria mudar o comportamento em
    silêncio.
    """
    import ocr_engine

    assert ocr_engine.normalizar_idioma(entrada) == "pt"


# --- contrato de saída ------------------------------------------------------


def test_caixa_vira_retangulo_alinhado():
    """Polígono de 4 pontos vira [x1, y1, x2, y2], com x2 > x1 e y2 > y1."""
    import ocr_engine

    inclinado = [[12, 40], [98, 35], [100, 60], [14, 66]]
    assert ocr_engine._caixa(inclinado) == [12, 35, 100, 66]


def test_pagina_em_branco_nao_inventa_texto(cliente, cabecalho):
    resposta = cliente.post(
        "/ocr",
        headers=cabecalho,
        files={"file": ("branco.png", _png_minimo(), "image/png")},
        data={"language": "por"},
    )
    assert resposta.status_code == 200
    assert resposta.json()["results"] == []


def test_resultado_respeita_o_contrato(cliente, cabecalho):
    """Cada item tem text, bbox de 4 inteiros e confiança em [0, 1]."""
    import io

    from PIL import Image, ImageDraw

    imagem = Image.new("RGB", (420, 90), "white")
    ImageDraw.Draw(imagem).text((16, 30), "PROCESSO 0001988", fill="black")
    buffer = io.BytesIO()
    imagem.save(buffer, format="PNG")

    resposta = cliente.post(
        "/ocr",
        headers=cabecalho,
        files={"file": ("linha.png", buffer.getvalue(), "image/png")},
    )
    assert resposta.status_code == 200
    resultados = resposta.json()["results"]
    assert resultados, "o motor não reconheceu nada numa linha limpa"
    for item in resultados:
        assert set(item) == {"text", "bbox", "confidence"}
        x1, y1, x2, y2 = item["bbox"]
        assert x2 > x1 and y2 > y1
        assert all(isinstance(v, int) for v in item["bbox"])
        assert 0.0 <= item["confidence"] <= 1.0

    # Ordem de leitura: de cima para baixo, da esquerda para a direita.
    chaves = [(r["bbox"][1], r["bbox"][0]) for r in resultados]
    assert chaves == sorted(chaves)


# --- credencial -------------------------------------------------------------


def test_ocr_sem_token_e_recusado(cliente):
    resposta = cliente.post(
        "/ocr", files={"file": ("branco.png", _png_minimo(), "image/png")}
    )
    assert resposta.status_code == 403


def test_arquivo_vazio_da_400(cliente, cabecalho):
    resposta = cliente.post(
        "/ocr", headers=cabecalho, files={"file": ("vazio.png", b"", "image/png")}
    )
    assert resposta.status_code == 400
    assert "error" in resposta.json()


def test_arquivo_ilegivel_da_500_com_corpo(cliente, cabecalho):
    """O contrato pede 500 com `{"error": ...}` — não um stack trace."""
    resposta = cliente.post(
        "/ocr",
        headers=cabecalho,
        files={"file": ("nao-e-imagem.png", b"isto nao e uma imagem", "image/png")},
    )
    assert resposta.status_code == 500
    assert "error" in resposta.json()


# --- modelos ----------------------------------------------------------------


def test_modelos_estao_no_disco():
    """Falso aqui significa que a primeira página escaneada baixaria da rede."""
    import ocr_engine

    assert ocr_engine.modelos_disponiveis("small")


def test_modelos_conferem_com_o_manifesto():
    import ocr_engine

    assert ocr_engine.conferir_integridade("small") == []


def test_health_publica_o_estado_do_ocr(cliente):
    corpo = cliente.get("/health").json()
    assert corpo["ocr_offline"] is True
    assert corpo["ocr_motor"].startswith("PP-OCRv6")


# --- fiação com o liteparse -------------------------------------------------


def test_liteparse_recebe_url_e_token(monkeypatch):
    """O parse tem de mandar o OCR para a nossa rota, com credencial.

    Se `ocr_server_url` chegar vazio, o liteparse cai no Tesseract embutido no
    wheel — em silêncio, sem erro nenhum. Este teste é o que impede a regressão
    passar despercebida.
    """
    import documentos

    capturado = {}

    class ParserFalso:
        def __init__(self, **kwargs):
            capturado.update(kwargs)

        def parse(self, caminho):
            class Resultado:
                pages = []
                total_pages = 0

            return Resultado()

    import liteparse

    monkeypatch.setattr(liteparse, "LiteParse", ParserFalso)
    documentos.configurar_ocr("http://127.0.0.1:9999/ocr", {"X-Presidio-Token": "abc"})
    try:
        documentos._extrair_paginas("qualquer.pdf")
    finally:
        documentos.configurar_ocr("", None)

    assert capturado["ocr_server_url"] == "http://127.0.0.1:9999/ocr"
    assert capturado["ocr_server_headers"] == {"X-Presidio-Token": "abc"}
    assert capturado["ocr_language"] == "pt"
    assert capturado["ocr_enabled"] is True
    # Falha de OCR não pode derrubar o documento inteiro: o texto nativo já
    # lido continua valendo, e o aviso de páginas não reconhecidas cobre o resto.
    assert capturado["ocr_failure_fatal"] is False
    assert "tessdata_path" not in capturado


# --- concorrência ---------------------------------------------------------


def test_paginas_simultaneas_nao_se_contaminam(cliente, cabecalho):
    """Duas páginas de tamanhos diferentes ao mesmo tempo não trocam de escala.

    O `TextDetector.__call__` do RapidOCR grava `self.preprocess_op` na
    instância compartilhada e a usa na linha seguinte
    (rapidocr/ch_ppocr_det/main.py:56). Sem serializar, duas páginas
    simultâneas se sobrescrevem: uma pré-processa com o redimensionamento da
    outra, e as caixas voltam remapeadas por um fator que não bate. O texto
    ainda sai — as caixas é que apontam para o lugar errado, sem erro nenhum.

    E o liteparse manda páginas em paralelo por padrão, então isso valeria para
    qualquer documento escaneado de mais de uma página.

    O teste manda tamanhos bem diferentes de propósito: se a escala vazar de um
    para o outro, a caixa estoura os limites da própria imagem.
    """
    import io
    from concurrent.futures import ThreadPoolExecutor

    from PIL import Image, ImageDraw

    def pagina(largura: int, altura: int) -> bytes:
        imagem = Image.new("RGB", (largura, altura), "white")
        desenho = ImageDraw.Draw(imagem)
        for y in range(20, altura - 20, 60):
            desenho.text((20, y), "PROCESSO 0001988-13.2013.8.16.0153", fill="black")
        buffer = io.BytesIO()
        imagem.save(buffer, format="PNG")
        return buffer.getvalue()

    tamanhos = [(600, 200), (1800, 900), (600, 200), (1800, 900)]
    imagens = [pagina(*t) for t in tamanhos]

    def enviar(indice: int):
        resposta = cliente.post(
            "/ocr",
            headers=cabecalho,
            files={"file": (f"p{indice}.png", imagens[indice], "image/png")},
        )
        assert resposta.status_code == 200
        return resposta.json()["results"]

    with ThreadPoolExecutor(max_workers=len(imagens)) as executor:
        saidas = list(executor.map(enviar, range(len(imagens))))

    for (largura, altura), resultados in zip(tamanhos, saidas):
        assert resultados, "nenhuma caixa numa página com texto"
        for item in resultados:
            x1, y1, x2, y2 = item["bbox"]
            assert 0 <= x1 < x2 <= largura, f"caixa fora da página {largura}x{altura}: {item}"
            assert 0 <= y1 < y2 <= altura, f"caixa fora da página {largura}x{altura}: {item}"

    # Mesma imagem, mesmo resultado — reconhecimento é determinístico.
    assert [r["text"] for r in saidas[0]] == [r["text"] for r in saidas[2]]
    assert [r["text"] for r in saidas[1]] == [r["text"] for r in saidas[3]]


def test_arquivo_grande_demais_e_recusado(cliente, cabecalho):
    """Uma página A4 a 300 dpi não passa de poucos MB; acima disso é abuso."""
    import ocr_engine

    excesso = b"\x89PNG\r\n\x1a\n" + b"0" * (ocr_engine.TAMANHO_MAXIMO + 1)
    resposta = cliente.post(
        "/ocr", headers=cabecalho, files={"file": ("enorme.png", excesso, "image/png")}
    )
    assert resposta.status_code == 413
    assert "error" in resposta.json()


def test_identificador_da_extracao_chega_ao_motor(tmp_path, monkeypatch):
    """O header que conta as páginas reconhecidas precisa sair junto.

    É por ele que o backend sabe quantas páginas realmente passaram pelo OCR —
    a única defesa contra o motor cair e o documento sair mutilado alegando que
    foi lido. Sem o header, a contagem é sempre zero e o aviso dispara em todo
    documento, o que faria alguém desligá-lo.
    """
    import documentos

    capturado = {}

    class ParserFalso:
        def __init__(self, **kwargs):
            capturado.update(kwargs)

        def parse(self, caminho):
            class Resultado:
                pages = []
                total_pages = 0
                page_errors = []

            return Resultado()

    import liteparse

    pdf = tmp_path / "auto.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    monkeypatch.setattr(liteparse, "LiteParse", ParserFalso)
    documentos.configurar_ocr("http://127.0.0.1:9999/ocr", {"X-Presidio-Token": "abc"})
    try:
        documentos.extrair(pdf)
    finally:
        documentos.configurar_ocr("", None)

    headers = capturado["ocr_server_headers"]
    assert headers["X-Presidio-Token"] == "abc"
    assert headers["X-Presidio-OCR-Extracao"], "sem identificador não há contagem"


# --- integração de verdade: servidor real na porta -------------------------


@pytest.fixture(scope="module")
def servidor_real():
    """Sobe um uvicorn de verdade e devolve a URL do /ocr.

    Os outros testes deste arquivo usam `TestClient` ou parser falso, o que é
    barato mas não prova a topologia: o liteparse fala HTTP com o backend por
    uma porta, e é ali que a fiação pode quebrar sem nenhum teste reclamar.
    """
    import threading
    import time

    import uvicorn

    import server

    os.environ["PRESIDIO_TOKEN"] = TOKEN
    config = uvicorn.Config(server.app, host="127.0.0.1", port=8797, log_level="error")
    servidor = uvicorn.Server(config)
    threading.Thread(target=servidor.run, daemon=True).start()
    limite = time.time() + 30
    while not servidor.started and time.time() < limite:
        time.sleep(0.05)
    assert servidor.started, "o servidor de teste não subiu"
    yield "http://127.0.0.1:8797/ocr"
    servidor.should_exit = True


def _imagem_com_texto(caminho) -> None:
    from PIL import Image, ImageDraw

    imagem = Image.new("RGB", (900, 260), "white")
    desenho = ImageDraw.Draw(imagem)
    desenho.text((30, 60), "JUIZO DE DIREITO DA VARA UNICA", fill="black")
    desenho.text((30, 140), "PROCESSO 0001988-13.2013.8.16.0153", fill="black")
    imagem.save(caminho)


def test_ocr_pela_porta_conta_a_pagina(tmp_path, servidor_real):
    """Caminho real: extração -> HTTP -> motor -> contador.

    Uma imagem é o caso mais puro: não tem texto nativo nenhum, então tudo que
    sair veio do reconhecimento.
    """
    import documentos

    alvo = tmp_path / "pagina.png"
    _imagem_com_texto(alvo)

    documentos.configurar_ocr(servidor_real, {"X-Presidio-Token": TOKEN})
    try:
        resultado = documentos.extrair(alvo)
    finally:
        documentos.configurar_ocr("", None)

    assert "PROCESSO" in resultado.como_markdown().upper()
    assert resultado.paginas_com_erro == 0, resultado.erros
    assert resultado.houve_ocr is True


def test_motor_fora_do_ar_e_denunciado_no_caminho_real(tmp_path):
    """A porta está fechada de verdade — nada é simulado aqui.

    Medido antes de existir esta defesa: o liteparse termina o parse, devolve
    `page_errors` vazio, e a imagem sai sem texto. `houve_ocr` ia para False, o
    documento se declarava "não precisou de OCR", e a anonimização rodava sobre
    o vazio sem ninguém saber.
    """
    import documentos

    alvo = tmp_path / "pagina.png"
    _imagem_com_texto(alvo)

    # Porta 9 (discard): fechada em qualquer máquina.
    documentos.configurar_ocr("http://127.0.0.1:9/ocr", {"X-Presidio-Token": TOKEN})
    try:
        resultado = documentos.extrair(alvo)
    finally:
        documentos.configurar_ocr("", None)

    assert resultado.paginas_com_erro >= 1, "falha de OCR passou em silêncio"
    assert "não chegaram ao motor de OCR" in resultado.erros[0]


def test_pagina_repetida_nao_compensa_pagina_perdida(servidor_real):
    """Duas chamadas para a MESMA página contam como uma.

    O liteparse pode repetir uma página (retry, ou o request hedging que ele
    oferece). Com um contador de chamadas, a página repetida compensaria outra
    que falhou: a conta fecharia e a falha voltaria a passar em silêncio.
    """
    import ocr_engine

    extracao = "extracao-de-teste"
    ocr_engine.encerrar_contagem(extracao)  # limpa resíduo
    ocr_engine.registrar_atendimento(extracao, b"pagina-A")
    ocr_engine.registrar_atendimento(extracao, b"pagina-A")
    ocr_engine.registrar_atendimento(extracao, b"pagina-B")

    assert ocr_engine.encerrar_contagem(extracao) == 2
    # E a conta é esquecida: nada fica preso na memória do processo.
    assert ocr_engine.encerrar_contagem(extracao) == 0
