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

import pytest

import documentos
from documentos import PaginaExtraida

# PDFs escaneados de verdade vivem fora deste repositório (documentos reais).
# Quando não estiverem à mão, os testes que dependem deles são pulados em vez
# de sumirem em silêncio.
CORPUS_ESCANEADO = Path(
    "/home/marcos/projetos/liteparser/test-area/ocr-ruins/06-matricula-pg4-ruim.pdf"
)


def _com_paginas(monkeypatch, *textos: str) -> None:
    """Substitui a leitura pelo liteparse por páginas dadas."""
    paginas = [PaginaExtraida(numero=i, texto=t) for i, t in enumerate(textos, start=1)]
    monkeypatch.setattr(
        documentos, "_extrair_paginas", lambda *a, **k: (paginas, len(paginas))
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
