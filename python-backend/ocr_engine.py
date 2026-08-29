"""
Motor de OCR: PP-OCRv6 sobre ONNX Runtime, em CPU.

Substitui o Tesseract que vinha embutido no wheel do liteparse. A troca tem
motivo medido (docs/relatorio-situacao-2026-08-14.md, seção 5.2): em matrícula
de cartório datilografada o Tesseract desaba a 17,7% das palavras, enquanto o
PP-OCRv6 small nunca cai abaixo de 42,6%. O que importa aqui não é a média — é
o pior caso, porque texto que o OCR não transcreveu não pode ser detectado por
recognizer nenhum, e o documento sai mutilado parecendo completo.

O liteparse não aceita motor injetado em processo: o único ponto de extensão é
`ocr_server_url` apontando para um `POST /ocr` que siga o contrato de
`OCR_API_SPEC.md`. Por isso este módulo tem duas caras — `reconhecer()`, que o
servidor FastAPI expõe naquele contrato, e um servidor autônomo (`__main__`)
usado pelo bench, onde subir o backend inteiro seria peso morto.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

# Perfis PP-OCRv6. O `small` é o padrão: 31 MB de modelos, equilíbrio entre
# precisão, RAM e tempo. O `medium` (133 MB) existe para o segundo passe nas
# páginas que o small não resolveu, e o `tiny` para máquinas fracas.
PERFIS = ("small", "medium", "tiny")
PERFIL_PADRAO = "small"

# Resolução com que a imagem chega ao detector.
#
# Parece desperdício: a página é rasterizada a 300 dpi (2480x3508 numa A4) e
# depois reduzida a 2000 no lado maior, perto de 170 dpi efetivos. A tentação é
# subir. **Medido ponta a ponta em 29/08/2026, subir é pior** para o que este
# aplicativo faz:
#
# | 2480x3508 no detector | 1414x2000 (este ajuste) |
# |---|---|
# | cédula: 6 ocorrências de CPF/CNPJ íntegras | **16** |
# | matrícula ruim: 3560 caracteres | 2353 |
# | 67,6 s | **39,6 s** |
#
# Os valores únicos encontrados são os mesmos nos dois. O que muda é a
# integridade: na resolução alta o detector parte a linha em mais caixas, e um
# CPF atravessa duas — 10 das 16 ocorrências saem quebradas. Ocorrência
# quebrada não casa com o recognizer, não é mascarada, e vira exatamente o
# vazamento residual que a auditoria de 14/08 registrou (`004.811.253-`, CPF
# truncado). Texto a mais em página ruim não compensa identificador partido.
#
# A resolução alta continua útil, mas como SEGUNDO PASSE em página que rendeu
# pouco — não como padrão. Ver LADO_MAXIMO_SEGUNDO_PASSE.
LADO_MAXIMO = 2000
LADO_DETECTOR = 736

# Escalada para a página que o primeiro passe não resolveu. Ali o problema é
# falta de texto, não integridade de identificador — e a ordem dos degraus não
# é a óbvia.
#
# Medido em 29/08/2026 na pior página do corpus (matrícula datilografada pg4,
# onde o Tesseract recuperava 17,7%), i5-12450HX, 5 threads, modelo já quente:
#
# | degrau                  | tempo/página | palavras |
# |-------------------------|--------------|----------|
# | small  2000/736 (padrão)|     4,3 s    |   316    |
# | small  4000/1536        |     8,4 s    |   511    |
# | medium 2000/736         |    16,8 s    |   485    |
# | medium 4000/1536        |    30,1 s    |   579    |
#
# A leitura que importa: **subir a resolução do small rende mais do que trocar
# para o medium, e custa metade.** 511 palavras em 8,4 s contra 485 em 16,8 s.
# Então a escalada é resolução primeiro, modelo depois — o medium fica como
# último degrau, a 7x o custo do padrão por mais 13% de texto sobre o small
# em alta.
#
# CUIDADO ao implementar a Fase 2: a resolução alta é justamente a que parte
# identificador em duas caixas (ver o bloco de LADO_MAXIMO). A página que subir
# de degrau precisa passar pelo mesmo crivo de integridade, e o contador de
# atendimento vai registrar duas chamadas para a mesma página — hoje isso
# mascararia a falha de outra página no `_erros_de_ocr_nao_reportados`.
LADO_MAXIMO_SEGUNDO_PASSE = 4000
LADO_DETECTOR_SEGUNDO_PASSE = 1536

# Confiança mínima para a caixa entrar no resultado. Abaixo disso o texto
# costuma ser ruído de fundo (carimbo, borda, sujeira de digitalização), e
# ruído no texto vira falso positivo no Presidio.
CONFIANCA_MINIMA = 0.5

# Idioma. O PP-OCRv6 tem um par de modelos só, `multi_PP-OCRv6_*`, multilíngue
# em 50 idiomas: a língua não troca de modelo nem de dicionário, só é validada
# (ver `resolve_model_key` em rapidocr/utils/model_resolver.py). Ou seja, não há
# qualidade a ganhar aqui — só a chance de errar o nome e tomar exceção.
#
# Por isso `lang_type` NÃO entra em `_parametros`: o `update_batch` do RapidOCR
# exige Enum nesse campo, e "pt" não é membro de `LangDet`/`LangRec`, embora
# seja aceito como string na validação do v6. Deixar o padrão do pacote resolve
# para exatamente os mesmos arquivos .onnx. O que este módulo faz com o idioma
# é normalizar o "por" que o liteparse manda, para o contrato ficar honesto.
IDIOMA_PADRAO = "pt"
_ALIASES_IDIOMA = {
    "por": "pt",
    "pt": "pt",
    "pt-br": "pt",
    "pt_br": "pt",
    "ptbr": "pt",
    "pt-pt": "pt",
}

# Teto do que se aceita reconhecer numa chamada.
#
# Quem chama é o liteparse, com uma página rasterizada: uma A4 a 300 dpi em PNG
# fica na casa de 2-6 MB. O teto existe porque a rota está exposta na porta
# local, e decodificar imagem é justamente onde mora a bomba de descompressão —
# um PNG de poucos KB pode virar gigabytes de bitmap.
TAMANHO_MAXIMO = 64 * 1024 * 1024

# Teto de pixels depois de decodificar, contra bomba de descompressão. Uma A2 a
# 600 dpi tem ~70 MP; acima disso não é página de processo.
PIXELS_MAXIMOS = 120_000_000


class ArquivoGrandeDemais(ValueError):
    """Entrada acima do teto — vira 413 na rota, não 500."""


class ModelosAusentes(RuntimeError):
    """Modelos fora do disco ou divergentes do manifesto.

    Erro próprio para o `server.py` distinguir de falha de reconhecimento: um é
    problema de instalação, o outro é uma página ruim.
    """


# Quantas páginas cada extração conseguiu de fato reconhecer.
#
# **É o único sinal confiável de que o OCR rodou.** Medido em 29/08/2026 com o
# motor fora do ar: o liteparse devolve `page_errors` VAZIO, e a página sai com
# os poucos caracteres de texto nativo que houvesse. Ou seja, um documento cujo
# OCR falhou inteiro se declararia "1 de 1 página lida por OCR" — o aviso ao
# revisor viraria mentira, e a anonimização rodaria sobre um texto com buracos.
#
# Contar aqui resolve porque este processo é quem realmente reconhece. A chave
# é um identificador que o `documentos.py` gera por extração e manda no header,
# para dois jobs simultâneos não somarem um no contador do outro.
# Guarda PÁGINAS distintas, não a quantidade de chamadas. A diferença importa:
# o liteparse pode repetir uma página (retry, ou request hedging, que ele
# oferece), e um contador simples somaria duas para a mesma página. Aí uma
# página atendida duas vezes compensaria outra que falhou, a conta fecharia e a
# falha voltaria a passar em silêncio — que é justamente o que este mecanismo
# existe para impedir. A identidade da página é o hash da imagem, porque o
# contrato do liteparse não manda número de página.
_atendidas: dict[str, set[str]] = {}
_lock_contador = threading.Lock()

_motores: dict[str, Any] = {}
_lock = threading.Lock()

# Uma inferência por vez, por perfil.
#
# **Não é otimização, é correção.** O `TextDetector.__call__` do RapidOCR grava
# `self.preprocess_op` na instância compartilhada e a usa na linha seguinte
# (rapidocr/ch_ppocr_det/main.py:56). Duas páginas simultâneas se sobrescrevem:
# a segunda troca o redimensionamento, a primeira pré-processa com a escala
# errada, e o `postprocess_op` remapeia as caixas com um fator que não bate.
# O texto continua saindo — só que as caixas apontam para o lugar errado, sem
# erro nenhum. Numa tarja de redação isso é o dado sensível ficando visível
# debaixo de uma tarja deslocada.
#
# O liteparse manda páginas em paralelo (`num_workers = cpu_count()-1`), então
# isto aconteceria em qualquer documento escaneado de mais de uma página. Com o
# lock, o paralelismo mora dentro do ONNX Runtime (ver `_threads`), que é onde
# ele rende — e o pico de memória fica no de uma página, como pede o §9 do guia.
_locks_inferencia: dict[str, threading.Lock] = {}


def normalizar_idioma(idioma: str | None) -> str:
    """`por`, `pt-BR`, `pt_br` -> `pt`. Desconhecido também vira `pt`.

    O contrato do OCR_API_SPEC diz ISO 639-1 com default `en`, mas este app só
    processa autos em português: cair para `en` num campo mal preenchido seria
    trocar silenciosamente o comportamento por causa de um typo.
    """
    if not idioma:
        return IDIOMA_PADRAO
    return _ALIASES_IDIOMA.get(idioma.strip().lower().replace(" ", ""), IDIOMA_PADRAO)


def _threads() -> int:
    """Threads por sessão ONNX.

    A inferência é serializada por `_lock_inferencia` (ver `reconhecer`), então
    há sempre uma página por vez no motor e não existe oversubscription entre
    requisições — dá para entregar a máquina quase inteira a ela. Deixa-se um
    núcleo livre para a interface e para o parse do liteparse, que continua
    rodando em paralelo nas páginas de texto nativo.

    Não pode ser `-1` (o padrão do RapidOCR): num servidor esse valor vira
    "todos os núcleos" para cada sessão, e as sessões de detecção,
    classificação e reconhecimento coexistem.
    """
    bruto = os.environ.get("PRESIDIO_OCR_THREADS")
    if bruto and bruto.isdigit() and int(bruto) > 0:
        return int(bruto)
    return max(1, (os.cpu_count() or 2) - 1)


# Arquivos que compõem um perfil. O `cls` é o classificador de orientação de
# linha: não faz parte do PP-OCRv6 (é o PP-OCR v2.0, inalterado há anos), mas o
# pipeline do RapidOCR o exige, e é ele que endireita a linha de cabeça para
# baixo em página digitalizada torta.
ARQUIVO_CLS = "ch_ppocr_mobile_v2.0_cls_mobile.onnx"
ARQUIVO_DICIONARIO = "PP-OCRv6_rec_dict.txt"


def _arquivos_do_perfil(perfil: str) -> tuple[str, ...]:
    return (
        f"PP-OCRv6_det_{perfil}.onnx",
        f"PP-OCRv6_rec_{perfil}.onnx",
        ARQUIVO_DICIONARIO,
        ARQUIVO_CLS,
    )


def _diretorio_modelos(perfil: str = PERFIL_PADRAO) -> Path | None:
    """Onde estão os .onnx oficiais, ou `None` se não achou.

    A cadeia tem duas posições pelo mesmo motivo de sempre: no app instalado a
    pasta fica ao lado do backend, em desenvolvimento fica em `resources/`. Se nada for encontrado, o RapidOCR
    resolve sozinho — e resolver sozinho significa **baixar do modelscope.cn na
    primeira execução**, que quebra a operação offline numa máquina de vara que
    pode nem ter internet. Por isso `modelos_disponiveis()` existe e o /health
    publica o resultado.
    """
    aqui = Path(__file__).resolve().parent
    # `PRESIDIO_OCR_MODELOS` é ordem, não preferência: quem aponta um caminho
    # explícito quer aquele caminho. Cair em outro lugar em silêncio faria o
    # operador achar que está usando modelos que não são os que estão rodando.
    escolhido = os.environ.get("PRESIDIO_OCR_MODELOS")
    if escolhido:
        candidatos: tuple[Path, ...] = (Path(escolhido),)
    else:
        candidatos = (
            aqui / "ocr-models",                       # app instalado
            aqui.parent / "resources" / "ocr-models",  # desenvolvimento
        )
    for pasta in candidatos:
        if all((pasta / nome).exists() for nome in _arquivos_do_perfil(perfil)):
            return pasta
    return None


def _parametros(perfil: str) -> dict[str, Any]:
    """Config do RapidOCR, montada aqui em vez de vir de um YAML nosso.

    Um YAML próprio teria de acompanhar o esquema inteiro do pacote (que muda
    entre versões); estas constantes ficam versionadas em git do mesmo jeito e
    só descrevem o que decidimos mudar em relação ao padrão.

    `ocr_version`, `model_type` e `engine_type` precisam ser Enum — o
    `ParseParams.update_batch` recusa string nesses campos.
    """
    from rapidocr.utils.typings import EngineType, ModelType, OCRVersion

    threads = _threads()
    params: dict[str, Any] = {
        "Global.text_score": CONFIANCA_MINIMA,
        "Global.max_side_len": LADO_MAXIMO,
        # Caixa por palavra, não por linha. O RapidOCR agrupa por linha
        # inteira, e a tarja de redação herda essa granularidade: um CPF no
        # meio da linha mascararia a linha toda. Seguro, e destrói o documento.
        "Global.return_word_box": True,
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.ocr_version": OCRVersion.PPOCRV6,
        "Det.model_type": ModelType(perfil),
        "Det.limit_side_len": LADO_DETECTOR,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.ocr_version": OCRVersion.PPOCRV6,
        "Rec.model_type": ModelType(perfil),
        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    }
    modelos = _diretorio_modelos(perfil)
    if modelos:
        # Caminho explícito por modelo curto-circuita a resolução do RapidOCR:
        # com `model_path` preenchido ele nem consulta o catálogo remoto, então
        # não há download nem na primeira execução. Os pesos são os oficiais da
        # PaddlePaddle (Apache-2.0, hashes em resources/ocr-models/MANIFESTO.json),
        # e não a conversão de terceiros que o RapidOCR traria por padrão.
        #
        # O ONNX oficial não embute a lista de caracteres na metadata (o
        # convertido pela RapidAI embute), então o dicionário vai à parte. Os
        # dois são idênticos, 18.708 entradas — conferido.
        params["Det.model_path"] = str(modelos / f"PP-OCRv6_det_{perfil}.onnx")
        params["Rec.model_path"] = str(modelos / f"PP-OCRv6_rec_{perfil}.onnx")
        params["Rec.rec_keys_path"] = str(modelos / ARQUIVO_DICIONARIO)
        params["Cls.model_path"] = str(modelos / ARQUIVO_CLS)
    return params


def perfil_ativo() -> str:
    """Perfil que o próximo reconhecimento usaria."""
    perfil = os.environ.get("PRESIDIO_OCR_PERFIL") or PERFIL_PADRAO
    return perfil if perfil in PERFIS else PERFIL_PADRAO


def motor(perfil: str = PERFIL_PADRAO):
    """Sessão RapidOCR do perfil, criada uma vez e mantida quente.

    Carregar o modelo por página multiplicaria os 5-7 s que já custa cada
    página escaneada. O `medium` só é instanciado quando alguém pede — manter
    133 MB residentes penaliza toda máquina que nunca precisa do segundo passe.
    """
    if perfil not in PERFIS:
        raise ValueError(f"perfil de OCR desconhecido: {perfil!r}")
    pronto = _motores.get(perfil)
    if pronto is not None:
        return pronto
    with _lock:
        if perfil not in _motores:
            # Falha fechado se os modelos não estiverem no disco.
            #
            # Sem isto o RapidOCR resolve sozinho — e resolver sozinho é baixar
            # do modelscope.cn. Numa máquina de vara sem internet, a primeira
            # página escaneada trava; numa máquina com internet, sai um
            # download que ninguém pediu, de um arquivo cujo hash não foi
            # conferido, num aplicativo que promete que nada sai da máquina.
            # Erro alto e claro é melhor que qualquer um dos dois.
            if _diretorio_modelos(perfil) is None:
                raise ModelosAusentes(
                    f"modelos do perfil '{perfil}' não encontrados. "
                    f"Rode: scripts/fetch-ocr-models.sh {perfil}"
                )
            problemas = conferir_integridade(perfil)
            if problemas:
                raise ModelosAusentes(
                    "modelos de OCR não conferem com o MANIFESTO.json: "
                    + "; ".join(problemas)
                )

            from rapidocr import RapidOCR

            _locks_inferencia.setdefault(perfil, threading.Lock())
            _motores[perfil] = RapidOCR(params=_parametros(perfil))
        return _motores[perfil]


def _recusar_bomba(conteudo: bytes) -> None:
    """Recusa imagem cujo bitmap decodificado estouraria a memória.

    O teto de bytes não basta: um PNG de poucos KB pode declarar 50.000 x 50.000
    e virar gigabytes ao decodificar. A dimensão está no cabeçalho, então dá
    para recusar **antes** de alocar — o `Image.open` do Pillow lê só o
    cabeçalho, o bitmap só é montado no `load()`.
    """
    import io

    from PIL import Image

    try:
        with Image.open(io.BytesIO(conteudo)) as imagem:
            largura, altura = imagem.size
    except Image.DecompressionBombError as erro:
        # O próprio Pillow já recusa acima de 2x MAX_IMAGE_PIXELS, e recusa
        # levantando exceção. Cair no `except Exception` abaixo transformaria a
        # defesa dele em silêncio — que foi exatamente o que aconteceu na
        # primeira versão desta função.
        raise ArquivoGrandeDemais(str(erro)) from erro
    except Exception:
        # Não abriu por outro motivo: deixa o motor falhar com a mensagem dele,
        # que é mais informativa do que um erro de tamanho inventado aqui.
        return

    if largura * altura > PIXELS_MAXIMOS:
        raise ArquivoGrandeDemais(
            f"imagem de {largura}x{altura} px acima do teto de {PIXELS_MAXIMOS} px"
        )


def _caixa(pontos) -> list[int]:
    """Polígono de 4 pontos -> bbox eixo-alinhado [x1, y1, x2, y2].

    O contrato do liteparse quer retângulo, não polígono, com origem no canto
    superior esquerdo e `x2 > x1`. Texto rotacionado perde a inclinação aqui —
    é o mesmo que o servidor de referência do liteparse faz.
    """
    xs = [int(p[0]) for p in pontos]
    ys = [int(p[1]) for p in pontos]
    return [min(xs), min(ys), max(xs), max(ys)]


def _reagrupar_palavras(
    texto_linha: str,
    fragmentos: list[tuple[str, float, Any]],
) -> list[tuple[str, float, list[int]]] | None:
    """Junta os fragmentos do RapidOCR de volta nas palavras reais da linha.

    **Por que isto existe.** O RapidOCR não corta a linha em palavras pelo
    espaço: ele corta pelo espaçamento visual entre caracteres reconhecidos
    (`col_width[c_i] > 5` em ch_ppocr_rec/utils.py). O efeito é que
    `0001988-13.2013.8.16.0153` vira três ou quatro "palavras" sempre que a
    pontuação abre um vão — e o corte **muda com a resolução**, porque a
    contagem de colunas escala com a largura do recorte.

    Isso não é cosmético. O texto que o liteparse remonta a partir daqui é o que
    o Presidio analisa: número de processo picado em pedaços deixa de casar com
    o recognizer de CNJ, e o dado passa direto. Foi medido: na cédula de
    crédito, subir a resolução do detector derrubou os identificadores com
    dígito verificador válido de 16 para 6.

    Os fragmentos concatenados reproduzem a linha sem os espaços (o separador é
    descartado no laço do RapidOCR), então dá para reagrupá-los seguindo a
    tokenização de verdade: acumula fragmento até fechar o próximo token
    separado por espaço, e une as caixas. Sai texto íntegro e caixa por palavra
    de verdade.

    Devolve None quando as contas não fecham — aí a linha inteira vale mais que
    um agrupamento inventado.
    """
    tokens = texto_linha.split()
    if not tokens or not fragmentos:
        return None

    agrupadas: list[tuple[str, float, list[int]]] = []
    fila = list(fragmentos)
    for token in tokens:
        acumulado = ""
        pedacos: list[tuple[str, float, Any]] = []
        while fila and len(acumulado) < len(token):
            pedaco = fila.pop(0)
            acumulado += pedaco[0]
            pedacos.append(pedaco)
        if acumulado != token or not pedacos:
            return None
        xs1, ys1, xs2, ys2, scores = [], [], [], [], []
        for _, score, pontos in pedacos:
            caixa = _caixa(pontos)
            xs1.append(caixa[0])
            ys1.append(caixa[1])
            xs2.append(caixa[2])
            ys2.append(caixa[3])
            scores.append(float(score))
        agrupadas.append(
            (token, min(scores), [min(xs1), min(ys1), max(xs2), max(ys2)])
        )

    # Sobrou fragmento: o alinhamento não bate, não dá para confiar.
    return None if fila else agrupadas


def reconhecer(
    conteudo: bytes,
    idioma: str | None = None,
    perfil: str | None = None,
) -> list[dict[str, Any]]:
    """Reconhece uma imagem e devolve os resultados no contrato do liteparse.

    Formato: `[{"text", "bbox": [x1,y1,x2,y2], "confidence"}]`, em ordem de
    leitura (de cima para baixo, da esquerda para a direita).
    """
    perfil = perfil or perfil_ativo()
    normalizar_idioma(idioma)  # valida e normaliza; o modelo v6 é multilíngue

    if len(conteudo) > TAMANHO_MAXIMO:
        raise ArquivoGrandeDemais(
            f"imagem de {len(conteudo)} bytes acima do teto de {TAMANHO_MAXIMO}"
        )
    _recusar_bomba(conteudo)

    instancia = motor(perfil)
    with _locks_inferencia.setdefault(perfil, threading.Lock()):
        saida = instancia(conteudo)
    if saida is None or saida.boxes is None or saida.txts is None:
        return []

    resultados: list[dict[str, Any]] = []
    palavras_por_linha = saida.word_results or ()

    for indice, (caixa_linha, texto_linha, score_linha) in enumerate(
        zip(saida.boxes, saida.txts, saida.scores)
    ):
        palavras = palavras_por_linha[indice] if indice < len(palavras_por_linha) else None
        # `word_results` traz (palavra, score, caixa). A caixa pode vir vazia
        # quando o modelo não conseguiu fatiar a linha; nesse caso a linha
        # inteira é o melhor que temos, e é melhor tarjar demais do que de menos.
        detalhadas = [
            (palavra, score, pontos)
            for palavra, score, pontos in (palavras or ())
            if palavra and pontos is not None
        ]
        agrupadas = _reagrupar_palavras(texto_linha or "", detalhadas) if detalhadas else None
        if agrupadas:
            for palavra, score, caixa in agrupadas:
                resultados.append(
                    {
                        "text": palavra,
                        "bbox": caixa,
                        "confidence": round(score, 3),
                    }
                )
        elif texto_linha and texto_linha.strip():
            resultados.append(
                {
                    "text": texto_linha,
                    "bbox": _caixa(caixa_linha),
                    "confidence": round(float(score_linha), 3),
                }
            )

    resultados.sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
    return resultados


def registrar_atendimento(extracao: str | None, conteudo: bytes) -> None:
    """Marca que esta página foi reconhecida, na conta desta extração."""
    if not extracao:
        return
    import hashlib

    chave = hashlib.blake2b(conteudo, digest_size=16).hexdigest()
    with _lock_contador:
        _atendidas.setdefault(extracao, set()).add(chave)


def encerrar_contagem(extracao: str) -> int:
    """Quantas páginas DISTINTAS esta extração reconheceu. Esquece a conta.

    Sempre chamado em `finally` pelo `documentos.py`: se o parse explodir no
    meio, a entrada precisa sair do dicionário do mesmo jeito, senão o processo
    acumula um conjunto de hashes por documento que falhou.
    """
    with _lock_contador:
        return len(_atendidas.pop(extracao, ()))


def modelos_disponiveis(perfil: str = PERFIL_PADRAO) -> bool:
    """Os modelos do perfil estão no disco **e** conferem com o manifesto?

    Falso significa que o OCR não vai rodar como está — ou porque os arquivos
    não estão lá (e a primeira página escaneada tentaria baixá-los da rede), ou
    porque não são os arquivos que deveriam ser. A interface precisa saber dos
    dois casos antes de prometer que nada sai da máquina: dizer "pronto" com
    modelo divergente é pior do que dizer "faltando".
    """
    return _diretorio_modelos(perfil) is not None and not conferir_integridade(perfil)


_integridade: dict[str, list[str]] = {}


def conferir_integridade(perfil: str = PERFIL_PADRAO) -> list[str]:
    """Confere os arquivos contra o MANIFESTO.json. Devolve as divergências.

    Modelo é código que roda: um .onnx trocado decide o que o OCR lê e, por
    tabela, o que a anonimização deixa passar. O §13 do guia pede versão,
    tamanho e SHA-256 pinados, com o artefato divergente recusado antes de ser
    aberto.

    **O resultado é memorizado por processo.** Conferir custa ler e resumir 31
    MB (perfil small) ou 170 MB (com o medium), e o `/health` é chamado de
    segundo em segundo pela interface enquanto o modelo de linguagem carrega —
    refazer a conta a cada chamada roubava CPU e disco exatamente da parte mais
    lenta da inicialização. Os arquivos não mudam com o processo em pé; se
    mudarem, o app precisa ser reiniciado de qualquer jeito.
    """
    memorizado = _integridade.get(perfil)
    if memorizado is not None:
        return memorizado
    _integridade[perfil] = _conferir_integridade(perfil)
    return _integridade[perfil]


def _conferir_integridade(perfil: str) -> list[str]:
    import hashlib
    import json

    pasta = _diretorio_modelos(perfil)
    if pasta is None:
        return [f"modelos do perfil {perfil} não encontrados"]

    manifesto_path = pasta / "MANIFESTO.json"
    if not manifesto_path.exists():
        return [f"MANIFESTO.json ausente em {pasta}"]

    manifesto = json.loads(manifesto_path.read_text(encoding="utf-8"))
    problemas: list[str] = []
    for nome in _arquivos_do_perfil(perfil):
        esperado = manifesto.get(nome)
        if esperado is None:
            problemas.append(f"{nome}: fora do manifesto")
            continue
        dados = (pasta / nome).read_bytes()
        if len(dados) != esperado["bytes"]:
            problemas.append(f"{nome}: {len(dados)} bytes, esperado {esperado['bytes']}")
        elif hashlib.sha256(dados).hexdigest() != esperado["sha256"]:
            problemas.append(f"{nome}: SHA-256 não confere")
    return problemas


def _servidor_autonomo() -> None:
    """Servidor mínimo do contrato `POST /ocr`, para o bench.

    Em produção quem expõe a rota é o `server.py`, atrás do token de sessão.
    Aqui não há token porque o bench sobe, mede e derruba — mas o bind é
    explicitamente em 127.0.0.1.
    """
    import argparse

    import uvicorn
    from fastapi import FastAPI, File, Form, UploadFile
    from fastapi.responses import JSONResponse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8829)
    parser.add_argument("--perfil", default=PERFIL_PADRAO, choices=PERFIS)
    args = parser.parse_args()

    os.environ.setdefault("PRESIDIO_OCR_PERFIL", args.perfil)
    app = FastAPI()

    @app.post("/ocr")
    async def ocr(file: UploadFile = File(...), language: str = Form(IDIOMA_PADRAO)):
        try:
            conteudo = await file.read()
            return {"results": reconhecer(conteudo, language, args.perfil)}
        except Exception as erro:  # noqa: BLE001 - o contrato pede 500 com corpo
            return JSONResponse(status_code=500, content={"error": str(erro)})

    @app.get("/health")
    async def health():
        return {"status": "ok", "perfil": args.perfil}

    motor(args.perfil)  # aquece antes de aceitar tráfego
    print(f"OCR_PRONTO port={args.port} perfil={args.perfil}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    _servidor_autonomo()
