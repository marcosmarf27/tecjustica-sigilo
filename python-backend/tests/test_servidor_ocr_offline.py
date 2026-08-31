"""
O servidor de OCR do modo offline atende de verdade?

Este arquivo existe por um defeito que ficou invisível: **toda** chamada a
`POST /ocr` respondia 500, e nada acusou. O modo offline inteiro — a CLI e o
servidor MCP com o aplicativo fechado, mais o `eval/bench_ocr.py` — estava sem
OCR nenhum.

O que torna esse defeito perigoso é o que acontece a jusante: o liteparse **não
falha** quando o motor de OCR morre. Ele segue com o texto nativo que houver e
devolve a página. Um documento digitalizado saía com 3.800 caracteres no lugar
de 55.453 — mutilado, com cara de completo. Texto não transcrito não vaza: sai
um documento que ninguém sabe que está incompleto, e nenhum recognizer detecta
o que o OCR não leu.

A causa foi uma interação obscura entre `from __future__ import annotations` (as
anotações viram strings) e a rota estar definida **dentro** de uma função (o
Pydantic resolve essas strings nos globais do módulo, não nos locais da função).
Importar o módulo não pega: as rotas registram normalmente. Só chamar pega.
"""

import io

import pytest
from fastapi.testclient import TestClient

import ocr_engine


@pytest.fixture(scope="module")
def cliente():
    return TestClient(ocr_engine.montar_app_ocr())


def test_requisicao_sem_arquivo_e_reprovada(cliente):
    """
    Contrato: requisição sem arquivo é erro de quem chamou, não do servidor.

    Este teste **não** pega o defeito do ForwardRef — conferido por mutação:
    com a resolução quebrada ele continua passando, porque sem arquivo o
    FastAPI reprova antes de precisar do tipo. Quem pega o defeito é o teste de
    ida e volta com imagem de verdade, que custa carregar os modelos.

    A distinção está escrita aqui de propósito. Um teste barato ao lado de um
    caro convida a rodar só o barato, e este barato não protege nada além do
    código de status.
    """
    resposta = cliente.post("/ocr", data={"language": "pt"})
    assert resposta.status_code == 422


def test_health_responde(cliente):
    resposta = cliente.get("/health")
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "ok"


def test_reconhece_uma_imagem_de_verdade(cliente):
    """
    O contrato inteiro, ponta a ponta: imagem entra, `results` sai.

    Carrega os modelos ONNX, então é o teste lento deste arquivo — e é **este**
    que pega o defeito do ForwardRef, confirmado por mutação: neutralizar a
    publicação dos nomes nos globais faz ele e o do contador falharem, e só
    eles. Também é o único que prova que a rota entrega o formato que o
    liteparse espera consumir.
    """
    from PIL import Image, ImageDraw

    imagem = Image.new("RGB", (420, 90), "white")
    ImageDraw.Draw(imagem).text((12, 32), "CPF 529.982.247-25", fill="black")
    buf = io.BytesIO()
    imagem.save(buf, format="PNG")

    resposta = cliente.post(
        "/ocr",
        files={"file": ("pagina.png", buf.getvalue(), "image/png")},
        data={"language": "pt"},
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert "results" in corpo
    for trecho in corpo["results"]:
        assert {"text", "bbox", "confidence"} <= set(trecho)


def test_conta_a_pagina_na_extracao_informada(cliente):
    """
    O cabeçalho de extração alimenta o contador — e sem isso o progresso mente.

    O `documentos.extrair` lê esse contador durante a leitura, para dizer
    "página 3 de 12", e no fim para saber quais páginas não chegaram ao OCR.
    Este servidor não registrava nada: o modo offline terminava anunciando que
    TODAS as páginas digitalizadas tinham falhado, sobre um documento que ele
    acabara de ler inteiro.
    """
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 30), "white").save(buf, format="PNG")
    extracao = "extracao-de-teste"

    antes = ocr_engine.paginas_atendidas(extracao)
    cliente.post(
        "/ocr",
        files={"file": ("pagina.png", buf.getvalue(), "image/png")},
        data={"language": "pt"},
        headers={"X-Presidio-OCR-Extracao": extracao},
    )
    assert ocr_engine.paginas_atendidas(extracao) == antes + 1

    # A mesma página de novo não conta duas vezes: a chave é o hash da imagem.
    # O liteparse repete página, e uma repetida compensaria outra perdida.
    cliente.post(
        "/ocr",
        files={"file": ("pagina.png", buf.getvalue(), "image/png")},
        data={"language": "pt"},
        headers={"X-Presidio-OCR-Extracao": extracao},
    )
    assert ocr_engine.paginas_atendidas(extracao) == antes + 1

    assert ocr_engine.encerrar_contagem(extracao) == 1
    assert ocr_engine.paginas_atendidas(extracao) == 0, "encerrar esvazia a conta"


def test_a_contagem_e_publicada_para_quem_extrai(cliente):
    """
    O contador vive no processo que atende `/ocr` — e nem sempre é o mesmo que
    extrai.

    No modo offline o `MotorLocal` sobe este servidor num `subprocess`, então
    `registrar_atendimento` roda aqui e `documentos._reconhecidas` rodava do
    outro lado, lendo sempre zero. O resultado era alarme falso em TODO
    documento digitalizado: "as páginas não chegaram ao motor de OCR, o texto
    delas não está neste resultado" sobre um documento lido inteiro.

    Aviso que mente treina a pessoa a ignorá-lo — e este é justamente o aviso
    que diz ao revisor que falta texto no resultado.
    """
    import io

    from PIL import Image

    extracao = "extracao-contagem"
    buf = io.BytesIO()
    Image.new("RGB", (50, 25), "white").save(buf, format="PNG")

    assert cliente.get(f"/contagem/{extracao}").json()["atendidas"] == 0

    cliente.post(
        "/ocr",
        files={"file": ("p1.png", buf.getvalue(), "image/png")},
        data={"language": "pt"},
        headers={"X-Presidio-OCR-Extracao": extracao},
    )
    assert cliente.get(f"/contagem/{extracao}").json()["atendidas"] == 1

    # Outra página, outro hash: a conta sobe.
    outro = io.BytesIO()
    Image.new("RGB", (60, 25), "white").save(outro, format="PNG")
    cliente.post(
        "/ocr",
        files={"file": ("p2.png", outro.getvalue(), "image/png")},
        data={"language": "pt"},
        headers={"X-Presidio-OCR-Extracao": extracao},
    )
    assert cliente.get(f"/contagem/{extracao}").json()["atendidas"] == 2


def test_servidor_de_ocr_fora_do_ar_continua_acusando():
    """
    Servidor que não responde reconheceu ZERO páginas — e o alarme tem de subir.

    A primeira versão do conserto da contagem entre processos devolvia "não sei"
    quando a consulta falhava, e mandava não acusar na dúvida. Isso suprimia o
    aviso exatamente na situação que ele existe para denunciar: motor de OCR
    morto, liteparse terminando sem erro, documento saindo mutilado com cara de
    completo.

    "Na dúvida não afirme" é boa regra para afirmar fato e péssima para calar
    alarme. Quem pegou foi `test_motor_fora_do_ar_e_denunciado_no_caminho_real`,
    que já existia.
    """
    import documentos

    documentos.configurar_ocr("http://127.0.0.1:9/ocr", {})
    try:
        faltaram, aviso = documentos._paginas_que_nao_chegaram_ao_ocr(0, {1, 2, 3})
        assert faltaram == 3
        assert aviso and "não chegaram ao motor de OCR" in aviso[0]

        # E com contagem parcial conhecida, acusa só a diferença.
        faltaram, aviso = documentos._paginas_que_nao_chegaram_ao_ocr(1, {1, 2, 3})
        assert faltaram == 2
    finally:
        documentos.configurar_ocr("", {})
