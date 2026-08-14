"""
O app precisa saber quando o texto veio de OCR.

A qualidade do OCR é o piso do recall: um dado que o Tesseract não transcreveu
não pode ser detectado por recognizer nenhum, e quem revisa o documento merece
o aviso. A versão anterior tentava inferir isso comparando os campos `markdown`
e `text` do liteparse, e errava sempre — em PDF 100% escaneado o liteparse
preenche os dois, então `houve_ocr` nunca ficava True e o aviso jamais aparecia.

A regra agora é explícita: imagem é sempre OCR, documento de escritório nunca é,
e PDF é sondado sem OCR para ver se já traz camada de texto.
"""

from pathlib import Path

import pytest

import documentos

# PDFs escaneados de verdade vivem fora deste repositório (documentos reais).
# Quando não estiverem à mão, os testes que dependem deles são pulados em vez
# de sumirem em silêncio.
CORPUS_ESCANEADO = Path(
    "/home/marcos/projetos/liteparser/test-area/ocr-ruins/06-matricula-pg4-ruim.pdf"
)


def test_imagem_e_sempre_ocr(tmp_path, monkeypatch):
    """Não há como extrair texto de um PNG sem reconhecê-lo."""
    imagem = tmp_path / "pagina.png"
    imagem.write_bytes(b"\x89PNG\r\n")

    monkeypatch.setattr(documentos, "_extrair_paginas", lambda *a, **k: ([], 1))

    assert documentos.extrair(imagem).houve_ocr is True


def test_docx_nunca_e_ocr(tmp_path, monkeypatch):
    """Texto de .docx é estruturado: passar por OCR seria um contrassenso."""
    doc = tmp_path / "peca.docx"
    doc.write_bytes(b"PK\x03\x04")

    monkeypatch.setattr(documentos, "_extrair_paginas", lambda *a, **k: ([], 1))

    assert documentos.extrair(doc).houve_ocr is False


def test_pdf_com_texto_nativo_nao_e_ocr(tmp_path, monkeypatch):
    """PDF que já traz camada de texto é lido pelo PDFium, sem Tesseract."""
    pdf = tmp_path / "peticao.pdf"
    pdf.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(documentos, "_extrair_paginas", lambda *a, **k: ([], 1))
    monkeypatch.setattr(documentos, "_tem_camada_de_texto", lambda *a, **k: True)

    assert documentos.extrair(pdf).houve_ocr is False


def test_pdf_sem_texto_nativo_e_ocr(tmp_path, monkeypatch):
    """Sem camada de texto, o conteúdo só pode ter vindo do reconhecimento."""
    pdf = tmp_path / "digitalizado.pdf"
    pdf.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(documentos, "_extrair_paginas", lambda *a, **k: ([], 1))
    monkeypatch.setattr(documentos, "_tem_camada_de_texto", lambda *a, **k: False)

    assert documentos.extrair(pdf).houve_ocr is True


@pytest.mark.skipif(
    not CORPUS_ESCANEADO.exists(), reason="PDF escaneado de referência indisponível"
)
def test_pdf_escaneado_real_e_reconhecido_como_ocr():
    """O caso que a heurística antiga errava, medido sobre documento real."""
    assert documentos._tem_camada_de_texto(str(CORPUS_ESCANEADO)) is False
    assert documentos.extrair(CORPUS_ESCANEADO).houve_ocr is True
