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


# Formatos cujo texto é estruturado: nunca passam por OCR.
_FORMATOS_COM_TEXTO = {".docx", ".xlsx", ".pptx"}


def _tem_camada_de_texto(caminho: str, amostra: int = 3) -> bool:
    """
    True se o PDF já traz texto nativo, sondado sem OCR.

    O liteparse não informa se uma página passou por OCR — com `ocr_enabled=True`
    o texto reconhecido chega pelos mesmos campos do texto nativo. A sondagem
    resolve isso e é barata dos dois lados: numa página escaneada não há nada
    para extrair, e num PDF nativo a extração de texto é a parte rápida.

    Saber a resposta importa porque a qualidade do OCR é o piso do recall: um
    dado que o Tesseract não transcreveu não pode ser detectado por nenhum
    recognizer, e quem revisa o documento precisa ser avisado disso.
    """
    import liteparse

    try:
        resultado = liteparse.LiteParse(
            ocr_enabled=False, quiet=True, max_pages=amostra
        ).parse(caminho)
    except Exception:
        # Na dúvida, não afirma que houve OCR — melhor calar que mentir.
        return True

    return any(len((pagina.text or "").strip()) > 40 for pagina in resultado.pages)


def _extrair_paginas(
    caminho: str, max_paginas: int | None = None
) -> tuple[list[PaginaExtraida], int]:
    """Lê o documento pelo liteparse e devolve as páginas e o total."""
    import liteparse

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

    resultado = parser.parse(caminho)

    paginas: list[PaginaExtraida] = []
    for pagina in resultado.pages:
        # `markdown` traz a estrutura (títulos, tabelas); `text` é o cru.
        conteudo = (pagina.markdown or "").strip() or (pagina.text or "").strip()
        paginas.append(
            PaginaExtraida(numero=pagina.page_num, texto=_limpar(conteudo))
        )

    return paginas, resultado.total_pages


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
    caminho = str(caminho)
    if not Path(caminho).exists():
        raise FileNotFoundError(caminho)

    if progresso:
        progresso(0, 0)

    paginas, total_paginas = _extrair_paginas(caminho, max_paginas)

    extensao = Path(caminho).suffix.lower()
    if extensao == ".pdf":
        houve_ocr = not _tem_camada_de_texto(caminho)
    else:
        # Imagem só tem como virar texto por OCR; documento de escritório, nunca.
        houve_ocr = extensao not in _FORMATOS_COM_TEXTO

    if progresso:
        progresso(len(paginas), len(paginas))

    return DocumentoExtraido(
        caminho=caminho,
        paginas=paginas,
        total_paginas=total_paginas,
        houve_ocr=houve_ocr,
    )
