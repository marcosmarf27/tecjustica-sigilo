"""
Leitura de documentos: PDF, DOCX, planilhas, apresentações e imagens.

Usa o liteparse (Apache 2.0) com PDFium para o texto nativo do PDF, e o
PP-OCRv6 (`ocr_engine`) quando a página é imagem escaneada — que é a regra em
autos digitalizados. Tudo roda na máquina: nenhuma página sai daqui.

**Por que o OCR fala HTTP com o próprio backend.** O liteparse não aceita motor
injetado em processo: não há plugin, callable nem entry point. O único ponto de
extensão é `ocr_server_url`, apontando para um `POST /ocr`. Como o backend já é
um servidor, a rota mora nele mesmo — sem processo extra, sem porta extra, e
protegida pelo mesmo token de sessão, que o liteparse repassa em
`ocr_server_headers`. O `server.py` chama `configurar_ocr()` no startup.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

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

# O contrato do OCR usa ISO 639-1; o `ocr_engine` normaliza de qualquer jeito.
IDIOMA_OCR = "pt"

# Resolução de rasterização antes do OCR. O liteparse não define nenhuma por
# padrão, e a diferença é mensurável: em 300 dpi o motor recupera 12 pontos
# percentuais a mais de texto numa matrícula digitalizada e 6 em outra (medição
# em docs/relatorio-situacao-2026-08-14.md, seção 5.1). Acima disso o ganho some
# e o tempo cresce. Página escaneada de má qualidade continua sendo o caso onde
# nenhuma resolução salva — ver a mesma seção.
#
# Cuidado ao mexer: rasterizar em 300 e deixar o motor encolher a imagem depois
# é pagar o custo sem levar o ganho. Ver LADO_MAXIMO em `ocr_engine`.
DPI_OCR = 300

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
    # Páginas que o parser reportou como erro — inclusive falha de OCR, que
    # `ocr_failure_fatal=False` deixa de ser fatal.
    #
    # Este número não é detalhe: é a diferença entre "o documento não tinha o
    # que reconhecer" e "o reconhecimento falhou e o texto não está aqui". Sem
    # ele, um documento em que TODO o OCR falhou sairia com `houve_ocr=False`,
    # ou seja, "não precisou de OCR" — e a anonimização rodaria sobre um texto
    # com buracos, sem aviso nenhum. É exatamente o modo de falha que esta troca
    # de motor existe para evitar.
    paginas_com_erro: int = 0
    # Primeiras mensagens de erro, para o aviso dizer o que houve. Truncado
    # porque a mensagem do parser pode ser longa e repetitiva.
    erros: tuple[str, ...] = ()

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


# Endereço e credencial do `POST /ocr`, preenchidos pelo `server.py` no startup.
# Fica em variável de módulo e não em variável de ambiente de propósito: a CLI
# importa este módulo e não sobe servidor nenhum, e herdar um endereço pela
# environment faria ela tentar falar com uma porta que não existe.
_ocr_url: str | None = None
_ocr_headers: dict[str, str] = {}


def configurar_ocr(url: str, headers: dict[str, str] | None = None) -> None:
    """Aponta o OCR para a rota do backend. Chamado uma vez, no startup."""
    global _ocr_url, _ocr_headers
    _ocr_url = url
    _ocr_headers = dict(headers or {})


def ocr_offline() -> bool:
    """True se o OCR roda sem precisar buscar nada na rede.

    Falso significa que os modelos ONNX não foram encontrados no disco e a
    primeira página escaneada dispararia um download — o que a interface tem de
    avisar antes de prometer que nada sai da máquina.
    """
    import ocr_engine

    return ocr_engine.modelos_disponiveis()


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
    recall — um dado que o OCR não transcreveu não pode ser detectado por
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
    caminho: str, max_paginas: int | None = None, extracao: str | None = None
) -> tuple[list[PaginaExtraida], int, tuple[str, ...]]:
    """Lê o documento e devolve as páginas, o total e os erros por página.

    `extracao` é um identificador desta leitura, repassado ao motor de OCR pelo
    header para ele contar quantas páginas realmente reconheceu. Ver
    `_paginas_reconhecidas`.
    """
    import liteparse

    parser = liteparse.LiteParse(
        ocr_enabled=True,
        ocr_language=IDIOMA_OCR,
        ocr_server_url=_ocr_url,
        ocr_server_headers=(
            {**_ocr_headers, "X-Presidio-OCR-Extracao": extracao}
            if _ocr_url and extracao
            else (_ocr_headers or None)
        ),
        # O padrão é `True`: uma falha sistêmica de OCR aborta o parse inteiro e
        # o usuário fica sem nada. Preferimos o resultado parcial — o texto
        # nativo já lido continua valendo — com o aviso de páginas não
        # reconhecidas, que o `houve_ocr`/`paginas_ocr` carrega.
        ocr_failure_fatal=False,
        output_format="markdown",
        num_workers=_workers_padrao(),
        continue_on_page_error=True,
        keep_headers_footers=True,
        dpi=DPI_OCR,
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

    erros = tuple(
        f"página {erro.page_num}: {erro.message}"
        for erro in getattr(resultado, "page_errors", ())
    )
    return paginas, resultado.total_pages, erros


def _contar_paginas(caminho: str) -> int:
    """
    Quantas páginas o documento tem, o mais barato possível.

    Serve só para o denominador do progresso, então erra para zero em silêncio:
    um total desconhecido faz a tela mostrar "lendo…" sem número, que é o que ela
    já fazia. Derrubar a extração porque a contagem falhou seria trocar o
    documento pelo indicador.

    PDF é uma abertura do índice (~0,2 s em 12 páginas), sem rasterizar nada.
    Imagem é sempre uma. Documento de escritório não tem página conhecida antes
    do parse — ali o progresso fica sem denominador mesmo.
    """
    extensao = Path(caminho).suffix.lower()
    if extensao == ".pdf":
        try:
            import pypdfium2 as pdfium

            documento = pdfium.PdfDocument(caminho)
            try:
                return len(documento)
            finally:
                documento.close()
        except Exception:
            return 0
    if extensao in _FORMATOS_COM_TEXTO:
        return 0
    return 1


def _vigiar_progresso(
    progresso: Callable[[int, int], None] | None, extracao: str, total: int
) -> Callable[[], None]:
    """
    Reporta o avanço enquanto o liteparse trabalha. Devolve como parar.

    O contador de páginas atendidas é alimentado pela rota `/ocr` conforme cada
    página é reconhecida; aqui ele é apenas **lido**, a cada meio segundo, por
    uma thread que não segura nada. Meio segundo é curto para a tela parecer
    viva e longo para o custo ser irrelevante ao lado de uma página de OCR.

    A thread é `daemon` e o `parar` é sempre chamado num `finally`: uma falha no
    parse não pode deixar vigília rodando sobre uma extração que acabou.
    """
    if progresso is None:
        return lambda: None

    import threading

    fim = threading.Event()

    def vigiar() -> None:
        import ocr_engine

        while not fim.wait(0.5):
            try:
                progresso(ocr_engine.paginas_atendidas(extracao), total)
            except Exception:
                # Indicador não derruba extração. Se o relato falhar, a leitura
                # continua e o usuário perde o número, não o documento.
                return

    threading.Thread(target=vigiar, name="progresso-ocr", daemon=True).start()
    return fim.set


def extrair(
    caminho: str | Path,
    progresso: Callable[[int, int], None] | None = None,
    max_paginas: int | None = None,
) -> DocumentoExtraido:
    """
    Extrai o texto de um documento, página a página.

    `progresso` recebe (páginas prontas, total).

    ## Por que havia dois passos, e por que não bastam

    O liteparse processa o documento inteiro numa chamada só, então parecia que
    o máximo possível era avisar no começo e no fim — e era isso que acontecia:
    `progresso(0, 0)` na entrada e `progresso(n, n)` na saída. Entre os dois, a
    tela mostrava "Lendo o documento" e um giro, **sem número nenhum**, pelo
    tempo que a leitura levasse. Numa procuração digitalizada de 12 páginas isso
    são minutos parado numa tela que não muda: quem está olhando conclui, com
    razão, que travou.

    O sinal por página existia o tempo todo. Toda página digitalizada passa pela
    rota `/ocr` deste mesmo backend, que já registra o atendimento indexado por
    hash da imagem — é como o `_reconhecidas` sabe, no fim, quais páginas não
    chegaram ao OCR. Faltava **ler esse contador durante a corrida**, e não só
    no fim. Uma thread de vigília faz isso, sem fatiar documento nenhum.

    O total vem de uma contagem barata de páginas (~0,2 s num PDF de 12), feita
    antes de começar.
    """
    caminho = str(caminho)
    if not Path(caminho).exists():
        raise FileNotFoundError(caminho)

    import uuid

    extracao = uuid.uuid4().hex
    total_previsto = _contar_paginas(caminho) if progresso else 0
    if progresso:
        progresso(0, total_previsto)

    parar_vigia = _vigiar_progresso(progresso, extracao, total_previsto)
    try:
        paginas, total_paginas, erros = _extrair_paginas(caminho, max_paginas, extracao)
    finally:
        parar_vigia()
        # Sempre: se o parse explodir depois de reconhecer algumas páginas, a
        # entrada tem de sair do contador do mesmo jeito.
        atendidas = _reconhecidas(extracao)

    # A sondagem é UM parse completo do PDF (~3 s em 225 páginas). Ela é feita
    # aqui, uma vez, e o resultado desce para quem precisa. Chamar
    # `_paginas_sem_texto_nativo` dentro de cada função parecia inocente e
    # multiplicava o custo por três num pipeline que a troca de motor já deixou
    # 3,5x mais lento.
    sem_texto_nativo = (
        _paginas_sem_texto_nativo(caminho)
        if Path(caminho).suffix.lower() == ".pdf"
        else None
    )

    paginas_ocr = _contar_paginas_ocr(caminho, paginas, sem_texto_nativo)
    faltaram, aviso = _paginas_que_nao_chegaram_ao_ocr(
        atendidas, _paginas_que_precisavam_de_ocr(caminho, paginas, sem_texto_nativo)
    )
    erros = erros + aviso

    if progresso:
        progresso(len(paginas), len(paginas))

    return DocumentoExtraido(
        caminho=caminho,
        paginas=paginas,
        total_paginas=total_paginas,
        # Página que deu erro também levanta o aviso: houve tentativa de leitura,
        # e ela falhou. Dizer "não houve OCR" nesse caso esconderia a falha.
        houve_ocr=paginas_ocr != 0 or bool(erros),
        paginas_ocr=max(0, paginas_ocr),
        # Páginas, não mensagens: o aviso de "N páginas não chegaram ao OCR" é
        # UMA string que fala de N páginas. Contar strings faria 10 páginas
        # perdidas virarem "1 página com erro" — o número que o revisor lê
        # ficaria dez vezes menor que o estrago.
        paginas_com_erro=len(erros) - len(aviso) + faltaram,
        erros=erros[:5],
    )


def _reconhecidas(extracao: str) -> int:
    """Quantas páginas o motor de OCR desta extração de fato reconheceu."""
    import ocr_engine

    return ocr_engine.encerrar_contagem(extracao)


def _paginas_que_precisavam_de_ocr(
    caminho: str, paginas: list[PaginaExtraida], sem_texto_nativo: set[int] | None
) -> set[int] | None:
    """Páginas que dependiam do OCR, ou None quando não dá para saber.

    Em PDF é a sondagem que responde. Em **imagem** são todas: um `.png` não
    tem texto nativo nenhum, e por isso ele é o caso em que a falha de OCR
    esconde melhor — sem esta linha, uma imagem cujo reconhecimento falhou sai
    como documento vazio, `houve_ocr=False`, "não precisou de OCR".
    Documento de escritório (`.docx` e afins) nunca passa por OCR.
    """
    extensao = Path(caminho).suffix.lower()
    if extensao == ".pdf":
        return sem_texto_nativo
    if extensao in _FORMATOS_COM_TEXTO:
        return set()
    return {pagina.numero for pagina in paginas}


def _paginas_que_nao_chegaram_ao_ocr(
    atendidas: int, precisavam: set[int] | None
) -> tuple[int, tuple[str, ...]]:
    """Páginas que precisavam de OCR e não chegaram ao motor.

    **Por que não basta o `page_errors` do liteparse.** Medido em 29/08/2026,
    com o motor de OCR fora do ar: o parse termina, `page_errors` vem **vazio**,
    e cada página escaneada sai com os poucos caracteres de texto nativo que
    houvesse. O documento se declarava "1 de 1 página lida por OCR" — aviso
    correto na forma e falso no conteúdo, que é pior do que aviso nenhum.

    A conta aqui é direta: quantas páginas precisavam de reconhecimento contra
    quantas o motor confirmou ter reconhecido. A diferença não chegou lá.

    Vale só quando o OCR passa pelo nosso servidor (`_ocr_url` configurado); na
    CLI, que não sobe servidor, não há o que comparar.
    """
    if not _ocr_url or precisavam is None:
        return 0, ()

    faltaram = len(precisavam) - atendidas
    if faltaram <= 0:
        return 0, ()
    return faltaram, (
        f"{faltaram} de {len(precisavam)} páginas que precisavam de "
        "reconhecimento não chegaram ao motor de OCR — o texto delas não está "
        "neste resultado",
    )


def _contar_paginas_ocr(
    caminho: str,
    paginas: list[PaginaExtraida],
    sem_texto_nativo: set[int] | None,
) -> int:
    """
    Quantas páginas do resultado vieram de reconhecimento. -1 se não deu para saber.

    Uma página só conta se não tinha texto nativo **e** produziu texto depois do
    OCR: a folha separadora em branco de um PDF nativo satisfaz a primeira
    condição e não satisfaz a segunda, e seria contada à toa. Falha de OCR não
    se infere daqui — vem de `ParseResult.page_errors`, que é o parser dizendo
    o que deu errado em vez de nós adivinharmos por ausência de texto.
    """
    extensao = Path(caminho).suffix.lower()

    if extensao != ".pdf":
        # Imagem só tem como virar texto por OCR; documento de escritório, nunca.
        if extensao in _FORMATOS_COM_TEXTO:
            return 0
        return sum(1 for pagina in paginas if pagina.texto.strip())

    if sem_texto_nativo is None:
        return -1

    return sum(
        1
        for pagina in paginas
        if pagina.numero in sem_texto_nativo and pagina.texto.strip()
    )
