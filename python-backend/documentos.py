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
    # Quantas páginas dependeram de reconhecimento. Vale a distinção: num auto
    # misto, saber que 12 de 225 páginas vieram de OCR diz onde revisar.
    paginas_ocr: int = 0

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


# Uma página de texto de verdade tem centenas de caracteres. Abaixo disso o que
# há é carimbo: a tarja "Assinado eletronicamente por…" que o PJe estampa por
# cima de anexo digitalizado é texto nativo, e passaria por camada de texto num
# limiar baixo — fazendo a página escaneada se declarar nativa.
_MINIMO_CAMADA_DE_TEXTO = 200


def _paginas_sem_texto_nativo(caminho: str) -> set[int] | None:
    """
    Quais páginas do PDF não trazem texto próprio — as candidatas a OCR.

    O liteparse não informa se uma página passou por reconhecimento: com
    `ocr_enabled=True` o texto reconhecido chega pelos mesmos campos do texto
    nativo. A sondagem com o OCR desligado resolve isso, e é barata dos dois
    lados — numa página escaneada não há nada para extrair, e num PDF nativo a
    extração de texto é a parte rápida (~3 s em 225 páginas).

    A varredura é do documento inteiro, não de uma amostra: o auto típico mistura
    petição nativa com anexo digitalizado, e é justamente no anexo que o aviso
    importa. Saber a resposta importa porque a qualidade do OCR é o piso do
    recall — um dado que o Tesseract não transcreveu não pode ser detectado por
    nenhum recognizer, e quem revisa o documento precisa ser avisado disso.

    Devolve None quando a sondagem falha: na dúvida, não se afirma nada.
    """
    import liteparse

    try:
        resultado = liteparse.LiteParse(ocr_enabled=False, quiet=True).parse(caminho)
    except Exception:
        return None

    return {
        pagina.page_num
        for pagina in resultado.pages
        if len((pagina.text or "").strip()) < _MINIMO_CAMADA_DE_TEXTO
    }


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

    paginas_ocr = _contar_paginas_ocr(caminho, paginas)

    if progresso:
        progresso(len(paginas), len(paginas))

    return DocumentoExtraido(
        caminho=caminho,
        paginas=paginas,
        total_paginas=total_paginas,
        houve_ocr=paginas_ocr != 0,
        paginas_ocr=max(0, paginas_ocr),
    )


def _contar_paginas_ocr(caminho: str, paginas: list[PaginaExtraida]) -> int:
    """
    Quantas páginas do resultado vieram de reconhecimento. -1 se não deu para saber.

    Uma página só conta se não tinha texto nativo **e** produziu texto depois do
    OCR: a folha separadora em branco de um PDF nativo satisfaz a primeira
    condição e não satisfaz a segunda, e seria contada à toa.
    """
    extensao = Path(caminho).suffix.lower()

    if extensao != ".pdf":
        # Imagem só tem como virar texto por OCR; documento de escritório, nunca.
        if extensao in _FORMATOS_COM_TEXTO:
            return 0
        return sum(1 for pagina in paginas if pagina.texto.strip())

    sem_texto_nativo = _paginas_sem_texto_nativo(caminho)
    if sem_texto_nativo is None:
        return -1

    return sum(
        1
        for pagina in paginas
        if pagina.numero in sem_texto_nativo and pagina.texto.strip()
    )
