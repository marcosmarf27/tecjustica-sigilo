"""
Leitura de documentos: PDF, DOCX, planilhas, apresentações e imagens.

Usa o liteparse (Apache 2.0), que combina PDFium para o texto nativo do PDF e
Tesseract para OCR quando a página é imagem escaneada — que é a regra em autos
digitalizados. Tudo roda na máquina: nenhuma página sai daqui.

**Sobre o tessdata.** O liteparse não embarca os dados de idioma do Tesseract;
na falta deles, ele os busca na rede e grava em `~/.tesseract-rs/tessdata`.
Isso quebraria a promessa de operação offline logo na primeira execução, em uma
máquina de vara que pode nem ter internet. Por isso o arquivo de português é
empacotado junto e o caminho é passado explicitamente (ver `_tessdata_dir`).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

# Formatos que o liteparse lê. `.txt`, `.md` e `.rtf` continuam sendo tratados
# como texto puro pelo caminho antigo, sem passar por aqui.
EXTENSOES_DOCUMENTO = {
    ".pdf",
    ".docx",
    ".xlsx",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
    ".webp",
    ".gif",
}

IDIOMA_OCR = "por"

# Quantas páginas processar em paralelo. Deixa um núcleo livre para a interface
# e para o modelo de linguagem, que roda em seguida.
def _workers_padrao() -> int:
    return max(1, (os.cpu_count() or 2) - 1)


@dataclass(frozen=True)
class PaginaExtraida:
    numero: int
    texto: str


@dataclass(frozen=True)
class DocumentoExtraido:
    caminho: str
    paginas: list[PaginaExtraida]
    total_paginas: int
    houve_ocr: bool

    def como_markdown(self) -> str:
        """
        Junta as páginas com o mesmo marcador usado pelo OCR de referência
        (`## Página N`), que o motor de anonimização já usa como unidade.
        """
        partes: list[str] = []
        for pagina in self.paginas:
            partes.append(f"## Página {pagina.numero}")
            partes.append(pagina.texto.rstrip())
            partes.append("")
        return "\n".join(partes)


def suportado(caminho: str | Path) -> bool:
    return Path(caminho).suffix.lower() in EXTENSOES_DOCUMENTO


# O liteparse emite referências a imagens extraídas (`![](img_p1_1.png)`) mesmo
# quando não se pede a extração — os arquivos não existem, e o detector acaba
# lendo o nome como URL. Nada disso é conteúdo do processo.
_RE_IMAGEM_MD = re.compile(r"!\[[^\]]*\]\([^)]*\)\s*")


def _limpar(texto: str) -> str:
    return _RE_IMAGEM_MD.sub("", texto)


def _tessdata_dir() -> str | None:
    """
    Onde estão os dados de idioma do Tesseract, em ordem de preferência.

    Devolver None deixa o liteparse resolver sozinho — o que funciona, mas
    envolve download. Só acontece se o arquivo não tiver sido empacotado.
    """
    candidatos: Iterable[Path] = (
        # 1. Configuração explícita do operador.
        *([Path(os.environ["PRESIDIO_TESSDATA"])] if os.environ.get("PRESIDIO_TESSDATA") else []),
        # 2. Empacotado junto do backend (é assim no aplicativo instalado).
        Path(__file__).parent / "tessdata",
        # 3. Ao lado do backend, em resources/ (layout de desenvolvimento).
        Path(__file__).parent.parent / "resources" / "tessdata",
        # 4. Cache do próprio liteparse, se ele já baixou alguma vez.
        Path.home() / ".tesseract-rs" / "tessdata",
    )

    for pasta in candidatos:
        if (pasta / f"{IDIOMA_OCR}.traineddata").exists():
            return str(pasta)
    return None


def tessdata_disponivel() -> bool:
    """True se o OCR roda sem precisar buscar nada na rede."""
    return _tessdata_dir() is not None


def extrair(
    caminho: str | Path,
    progresso: Callable[[int, int], None] | None = None,
    max_paginas: int | None = None,
) -> DocumentoExtraido:
    """
    Extrai o texto de um documento, página a página.

    `progresso` recebe (páginas prontas, total) — o liteparse processa o
    documento inteiro numa chamada, então o retorno é em dois passos: o total
    assim que ele é conhecido e a conclusão ao final. Para acompanhar página a
    página de verdade seria preciso fatiar o documento, o que custa mais do que
    informa.
    """
    import liteparse

    caminho = str(caminho)
    if not Path(caminho).exists():
        raise FileNotFoundError(caminho)

    parser = liteparse.LiteParse(
        ocr_enabled=True,
        ocr_language=IDIOMA_OCR,
        tessdata_path=_tessdata_dir(),
        output_format="markdown",
        num_workers=_workers_padrao(),
        continue_on_page_error=True,
        keep_headers_footers=True,
        quiet=True,
        **({"max_pages": max_paginas} if max_paginas else {}),
    )

    if progresso:
        progresso(0, 0)

    resultado = parser.parse(caminho)

    paginas: list[PaginaExtraida] = []
    houve_ocr = False
    for pagina in resultado.pages:
        # `markdown` traz a estrutura (títulos, tabelas); `text` é o cru.
        # Páginas só com imagem vêm sem markdown, e aí o texto vem do OCR.
        conteudo = (pagina.markdown or "").strip() or (pagina.text or "").strip()
        if not (pagina.markdown or "").strip() and (pagina.text or "").strip():
            houve_ocr = True
        paginas.append(
            PaginaExtraida(numero=pagina.page_num, texto=_limpar(conteudo))
        )

    if progresso:
        progresso(len(paginas), len(paginas))

    return DocumentoExtraido(
        caminho=caminho,
        paginas=paginas,
        total_paginas=resultado.total_pages,
        houve_ocr=houve_ocr,
    )
