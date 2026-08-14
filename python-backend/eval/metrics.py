"""
Métricas de acurácia sobre o corpus real.

Três números, sempre publicados juntos, porque cada um responde a uma pergunta
diferente e nenhum deles sozinho é honesto:

  A. **Recall por ocorrência (substantivo)** — das ocorrências de PII que não são
     repetição de rodapé, quantas foram mascaradas.
  B. **Proteção por valor único** — um valor só conta como protegido se TODAS as
     suas ocorrências foram mascaradas. É a métrica principal: se um CPF escapa
     numa única página, as outras 80 ocorrências mascaradas dele não protegem
     mais ninguém.
  C. **Recall no boilerplate** — o rodapé repetido, medido à parte, porque ele
     infla qualquer contagem bruta (um número de processo aparece 716 vezes).

Cobertura é medida por caractere: um item do gabarito só está protegido se todo
o seu span foi coberto por alguma detecção. Detectar "SANTOS" dentro de
"FRANCISCO AFONSO DOS SANTOS" deixa o resto do nome exposto e não conta.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from eval.gold import ItemGabarito

# Uma linha que se repete a partir daqui é tratada como boilerplate de página.
LIMIAR_BOILERPLATE = 20


@dataclass(frozen=True)
class Deteccao:
    """Uma entidade que o motor encontrou, em offsets do texto original."""

    tipo: str
    start: int
    end: int


@dataclass
class ResultadoTipo:
    tipo: str
    # A — por ocorrência, fora do boilerplate
    ocorrencias_substantivas: int = 0
    protegidas_substantivas: int = 0
    # B — por valor único
    valores_unicos: int = 0
    valores_protegidos: int = 0
    # C — boilerplate
    ocorrencias_boilerplate: int = 0
    protegidas_boilerplate: int = 0
    # diagnóstico
    vazamentos: list[ItemGabarito] = field(default_factory=list)

    @property
    def recall_ocorrencia(self) -> float:
        if not self.ocorrencias_substantivas:
            return float("nan")
        return self.protegidas_substantivas / self.ocorrencias_substantivas

    @property
    def protecao_valor(self) -> float:
        if not self.valores_unicos:
            return float("nan")
        return self.valores_protegidos / self.valores_unicos

    @property
    def recall_boilerplate(self) -> float:
        if not self.ocorrencias_boilerplate:
            return float("nan")
        return self.protegidas_boilerplate / self.ocorrencias_boilerplate


def linhas_boilerplate(texto: str, limiar: int = LIMIAR_BOILERPLATE) -> set[str]:
    """Conteúdo de linha que se repete o bastante para ser rodapé/cabeçalho."""
    contagem = Counter()
    for linha in texto.split("\n"):
        limpa = " ".join(linha.split())
        if len(limpa) >= 12:  # linhas curtas repetem por acaso
            contagem[limpa] += 1
    return {linha for linha, n in contagem.items() if n >= limiar}


def _indice_de_linhas(texto: str) -> list[tuple[int, int, str]]:
    """(start, end, conteúdo normalizado) de cada linha, em offsets do texto."""
    linhas = []
    pos = 0
    for linha in texto.split("\n"):
        linhas.append((pos, pos + len(linha), " ".join(linha.split())))
        pos += len(linha) + 1
    return linhas


def _mapa_cobertura(tamanho: int, deteccoes: list[Deteccao]) -> bytearray:
    """1 em cada caractere coberto por alguma detecção."""
    mapa = bytearray(tamanho)
    for d in deteccoes:
        inicio = max(0, d.start)
        fim = min(tamanho, d.end)
        if fim > inicio:
            mapa[inicio:fim] = b"\x01" * (fim - inicio)
    return mapa


def _totalmente_coberto(mapa: bytearray, texto: str, item: ItemGabarito) -> bool:
    """
    Protegido = todo caractere *significativo* do span foi coberto.

    Pontuação não é dado pessoal: se o motor mascara `85) 3322-1086` e deixa o
    parêntese de abertura de fora, o telefone está protegido — a máscara ficou
    torta, não vazada. Já um dígito ou letra descoberto é vazamento de verdade,
    porque é parte do identificador.
    """
    if item.end <= item.start:
        return False
    for pos in range(item.start, min(item.end, len(mapa))):
        if texto[pos].isalnum() and not mapa[pos]:
            return False
    return True


def avaliar(
    texto: str,
    gabarito: list[ItemGabarito],
    deteccoes: list[Deteccao],
) -> dict[str, ResultadoTipo]:
    """Compara gabarito e detecções, devolvendo um resultado por tipo de PII."""
    mapa = _mapa_cobertura(len(texto), deteccoes)
    boiler = linhas_boilerplate(texto)
    indice = _indice_de_linhas(texto)

    def em_boilerplate(item: ItemGabarito) -> bool:
        for start, end, conteudo in indice:
            if start <= item.start < end:
                return conteudo in boiler
            if start > item.start:
                break
        return False

    resultados: dict[str, ResultadoTipo] = {}
    por_valor: dict[str, list[tuple[ItemGabarito, bool]]] = defaultdict(list)

    for item in gabarito:
        r = resultados.setdefault(item.tipo, ResultadoTipo(tipo=item.tipo))
        coberto = _totalmente_coberto(mapa, texto, item)
        por_valor[item.chave].append((item, coberto))

        if em_boilerplate(item):
            r.ocorrencias_boilerplate += 1
            if coberto:
                r.protegidas_boilerplate += 1
        else:
            r.ocorrencias_substantivas += 1
            if coberto:
                r.protegidas_substantivas += 1
            else:
                r.vazamentos.append(item)

    for chave, ocorrencias in por_valor.items():
        tipo = chave.split(":", 1)[0]
        r = resultados.setdefault(tipo, ResultadoTipo(tipo=tipo))
        r.valores_unicos += 1
        if all(coberto for _, coberto in ocorrencias):
            r.valores_protegidos += 1

    return resultados


def limite_inferior_wilson(sucessos: int, total: int, z: float = 1.645) -> float:
    """
    Limite inferior unilateral de 95% para uma proporção (Wilson).

    Serve para responder "o recall medido sustenta a afirmação de 99%?" — com
    poucas observações, 100% medido não sustenta 99% real.
    """
    if total == 0:
        return float("nan")
    p = sucessos / total
    denominador = 1 + z * z / total
    centro = p + z * z / (2 * total)
    margem = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return max(0.0, (centro - margem) / denominador)


def n_minimo_para_99(misses: int) -> int:
    """
    Quantas observações são necessárias para que o limite inferior de 95%
    alcance 99%, dado um número de falhas. Com 0 falhas, a regra de três dá 300.
    """
    n = max(1, misses)
    while n < 100_000:
        if limite_inferior_wilson(n - misses, n) >= 0.99:
            return n
        n += 1
    return -1
