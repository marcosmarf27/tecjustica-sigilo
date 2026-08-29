"""
O app precisa saber quando o texto veio de OCR.

A qualidade do OCR é o piso do recall: um dado que o Tesseract não transcreveu
não pode ser detectado por recognizer nenhum, e quem revisa o documento merece
o aviso. A versão anterior tentava inferir isso comparando os campos `markdown`
e `text` do liteparse, e errava sempre — em PDF 100% escaneado o liteparse
preenche os dois, então `houve_ocr` nunca ficava True e o aviso jamais aparecia.

A regra agora é explícita: imagem é sempre OCR, documento de escritório nunca é,
e cada página de PDF é sondada sem OCR para ver se traz camada de texto própria.
"""

from pathlib import Path

import os

import pytest

import documentos
from documentos import PaginaExtraida

# PDFs escaneados de verdade vivem fora deste repositório (documentos reais).
# Quando não estiverem à mão, os testes que dependem deles são pulados em vez
# de sumirem em silêncio.
#
# O caminho vem de `PRESIDIO_CORPUS_OCR`, apontando para a pasta com os PDFs.
# Antes era um caminho absoluto da máquina onde o teste foi escrito — que não
# existe em nenhuma outra, então o teste era pulado sempre, inclusive onde o
# corpus estava presente, só que noutro lugar.
_PASTA_CORPUS = os.environ.get("PRESIDIO_CORPUS_OCR")
CORPUS_ESCANEADO = (
    Path(_PASTA_CORPUS) / "06-matricula-pg4-ruim.pdf"
    if _PASTA_CORPUS
    else Path("corpus-nao-configurado")
)


def _com_paginas(monkeypatch, *textos: str, erros: tuple[str, ...] = ()) -> None:
    """Substitui a leitura pelo liteparse por páginas dadas.

    `erros` simula o que o parser reporta em `ParseResult.page_errors` — é por
    ali que falha de OCR chega, já que `ocr_failure_fatal=False` faz o parse
    seguir em frente em vez de levantar exceção.
    """
    paginas = [PaginaExtraida(numero=i, texto=t) for i, t in enumerate(textos, start=1)]
    monkeypatch.setattr(
        documentos,
        "_extrair_paginas",
        lambda *a, **k: (paginas, len(paginas), erros),
    )


def test_imagem_e_sempre_ocr(tmp_path, monkeypatch):
    """Não há como extrair texto de um PNG sem reconhecê-lo."""
    imagem = tmp_path / "pagina.png"
    imagem.write_bytes(b"\x89PNG\r\n")
    _com_paginas(monkeypatch, "SENTENÇA")

    resultado = documentos.extrair(imagem)
    assert resultado.houve_ocr is True
    assert resultado.paginas_ocr == 1


def test_docx_nunca_e_ocr(tmp_path, monkeypatch):
    """Texto de .docx é estruturado: passar por OCR seria um contrassenso."""
    doc = tmp_path / "peca.docx"
    doc.write_bytes(b"PK\x03\x04")
    _com_paginas(monkeypatch, "PETIÇÃO INICIAL")

    assert documentos.extrair(doc).houve_ocr is False


def test_pdf_com_texto_nativo_nao_e_ocr(tmp_path, monkeypatch):
    """PDF que já traz camada de texto é lido pelo PDFium, sem Tesseract."""
    pdf = tmp_path / "peticao.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "conteúdo", "mais conteúdo")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: set())

    resultado = documentos.extrair(pdf)
    assert resultado.houve_ocr is False
    assert resultado.paginas_ocr == 0


def test_auto_misto_conta_so_as_paginas_digitalizadas(tmp_path, monkeypatch):
    """
    O caso típico: petição nativa na frente, anexo digitalizado atrás.

    A sondagem antiga olhava só as primeiras páginas e declarava o auto inteiro
    nativo — perdendo justamente o anexo, que é onde a revisão importa.
    """
    pdf = tmp_path / "auto.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "petição", "petição", "anexo escaneado", "outro anexo")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {3, 4})

    resultado = documentos.extrair(pdf)
    assert resultado.houve_ocr is True
    assert resultado.paginas_ocr == 2


def test_folha_em_branco_nao_conta_como_ocr(tmp_path, monkeypatch):
    """
    Separador em branco não tem texto nativo nem texto após OCR.

    Sem esta regra, todo PDF com folha de rosto vazia alegaria ter passado por
    reconhecimento — e um aviso que dispara sempre deixa de ser lido.
    """
    pdf = tmp_path / "com-separador.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "conteúdo", "   ")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {2})

    resultado = documentos.extrair(pdf)
    assert resultado.houve_ocr is False
    assert resultado.paginas_ocr == 0


def test_sondagem_que_falha_nao_afirma_nada(tmp_path, monkeypatch):
    """Sem conseguir sondar, o app não inventa: não diz que houve OCR."""
    pdf = tmp_path / "quebrado.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "conteúdo")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: None)

    resultado = documentos.extrair(pdf)
    assert resultado.paginas_ocr == 0


def test_carimbo_de_assinatura_nao_conta_como_camada_de_texto():
    """
    A tarja "Assinado eletronicamente por…" é texto nativo sobre página
    digitalizada. Num limiar baixo ela faria a página se declarar nativa,
    escondendo que todo o conteúdo veio de OCR.
    """
    carimbo = (
        "Assinado eletronicamente por: MARIA DA SILVA - 14/08/2026 09:12:33 "
        "https://pje.tjce.jus.br - Número do documento: 26081409123300000000"
    )
    assert len(carimbo) < documentos._MINIMO_CAMADA_DE_TEXTO


@pytest.mark.skipif(
    not CORPUS_ESCANEADO.exists(), reason="PDF escaneado de referência indisponível"
)
def test_pdf_escaneado_real_e_reconhecido_como_ocr():
    """O caso que a heurística antiga errava, medido sobre documento real."""
    resultado = documentos.extrair(CORPUS_ESCANEADO)
    assert resultado.houve_ocr is True
    assert resultado.paginas_ocr == resultado.total_paginas


def test_falha_de_ocr_nao_passa_em_silencio(tmp_path, monkeypatch):
    """Página que o parser reportou como erro levanta o aviso.

    `ocr_failure_fatal=False` é deliberado: perder o texto nativo já lido por
    causa de um erro numa página escaneada seria pior do que entregar o
    resultado parcial. Mas isso abre um jeito silencioso de errar — se toda
    página escaneada falhar, nenhuma produz texto, `paginas_ocr` fica em zero e
    o documento se declararia "não precisou de OCR". A anonimização rodaria
    sobre um texto com buracos, sem ninguém saber.

    Este é o modo de falha que a troca de motor existe para evitar: entregar um
    documento mutilado achando que está completo.
    """
    pdf = tmp_path / "ocr-quebrado.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(
        monkeypatch,
        "petição nativa",
        "",
        erros=("página 2: OCR server request failed",),
    )
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {2})

    resultado = documentos.extrair(pdf)
    assert resultado.houve_ocr is True, "falha de OCR não pode se declarar 'sem OCR'"
    assert resultado.paginas_ocr == 0
    assert resultado.paginas_com_erro == 1
    assert "OCR server request failed" in resultado.erros[0]


def test_ocr_que_nao_rodou_nao_passa_por_ocr_que_rodou(tmp_path, monkeypatch):
    """Motor de OCR fora do ar tem de virar aviso, não documento mutilado.

    Este é o caso que `page_errors` NÃO cobre, e foi medido: com o motor numa
    porta fechada, o liteparse termina o parse, devolve `page_errors` vazio, e
    cada página escaneada sai com os poucos caracteres de texto nativo que
    houvesse. `paginas_ocr` conta 1, e o documento se declara "1 de 1 página
    lida por OCR" — a forma do aviso está certa e o conteúdo é falso, o que é
    pior do que não avisar.

    A defesa é contar do lado que nós controlamos: quantas páginas precisavam
    de reconhecimento contra quantas o motor confirmou ter reconhecido.
    """
    pdf = tmp_path / "ocr-fora-do-ar.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    # A página escaneada devolve o resto de texto nativo que sobrou — é assim
    # que o caso engana: ela não vem vazia.
    _com_paginas(monkeypatch, "petição nativa", "fls. 2")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {2})
    monkeypatch.setattr(documentos, "_reconhecidas", lambda *a, **k: 0)
    documentos.configurar_ocr("http://127.0.0.1:9/ocr", {"X-Presidio-Token": "x"})
    try:
        resultado = documentos.extrair(pdf)
    finally:
        documentos.configurar_ocr("", None)

    assert resultado.paginas_com_erro == 1
    assert "não chegaram ao motor de OCR" in resultado.erros[0]
    assert resultado.houve_ocr is True


def test_ocr_que_rodou_nao_gera_alarme_falso(tmp_path, monkeypatch):
    """Aviso que dispara sempre deixa de ser lido."""
    pdf = tmp_path / "ok.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "petição nativa", "anexo reconhecido")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {2})
    monkeypatch.setattr(documentos, "_reconhecidas", lambda *a, **k: 1)
    documentos.configurar_ocr("http://127.0.0.1:9/ocr", {"X-Presidio-Token": "x"})
    try:
        resultado = documentos.extrair(pdf)
    finally:
        documentos.configurar_ocr("", None)

    assert resultado.paginas_com_erro == 0
    assert resultado.erros == ()


def test_cli_sem_servidor_nao_inventa_erro(tmp_path, monkeypatch):
    """Sem servidor de OCR configurado não há contagem para comparar.

    A CLI importa este módulo e não sobe servidor nenhum; afirmar falha ali
    seria inventar.
    """
    pdf = tmp_path / "cli.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    _com_paginas(monkeypatch, "petição nativa", "")
    monkeypatch.setattr(documentos, "_paginas_sem_texto_nativo", lambda *a, **k: {2})
    documentos.configurar_ocr("", None)

    assert documentos.extrair(pdf).paginas_com_erro == 0
