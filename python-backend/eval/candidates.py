"""
Extração de candidatos a PII para montar o gabarito de avaliação.

Estas regex são deliberadamente GENEROSAS: erram para o lado de capturar demais.
Elas não são as do motor de produção — servem para levantar tudo que *poderia*
ser PII no corpus, de modo que a revisão humana trabalhe sobre um conjunto amplo
em vez de confiar no próprio detector que estamos avaliando (o que mediria o
detector contra ele mesmo).

Um candidato só vira gabarito depois de conferido; ver `gold.py`.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Candidato:
    tipo: str
    start: int
    end: int
    texto: str
    padrao: str

    @property
    def chave(self) -> str:
        """Forma normalizada, para agrupar ocorrências do mesmo valor."""
        return normalizar(self.texto)


def normalizar(texto: str) -> str:
    """Minúscula, sem acento, espaços colapsados."""
    sem_acento = "".join(
        c
        for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )
    return " ".join(sem_acento.lower().split())


def apenas_digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto)


# Logradouros observados no corpus, mais os comuns em endereço brasileiro.
_LOGRADOUROS = (
    r"Rua|R\.|Avenida|Av\.|Av|Travessa|Trav\.|Praça|Praca|Rodovia|Rod\.|"
    r"Estrada|Sítio|Sitio|Distrito|Localidade|Conjunto|Cj\.|Alameda|Al\.|"
    r"Largo|Beco|Vila|Loteamento|Fazenda|Assentamento|Quadra"
)

# Âncoras que indicam endereço mesmo sem a palavra do logradouro.
_ANCORA_ENDERECO = (
    r"residente|domiciliad[oa]|resid[ei]|endereç[oa]|endereco|"
    r"moradora?\s+(?:na|no|em)|com\s+endereço"
)

# O span do candidato é o grupo `valor` quando ele existe, senão o casamento
# inteiro. Isso mantém rótulo e órgão emissor FORA do span: "CPF:" e "SSP/CE"
# não são dado pessoal, e incluí-los faria o gabarito cobrar do motor uma
# máscara que ele não deve aplicar.
PADROES: dict[str, list[tuple[str, str]]] = {
    # (nome do padrão, regex)
    "CPF": [
        ("cpf_formatado", r"(?P<valor>\d{3}\.\d{3}\.\d{3}-\d{2})"),
        ("cpf_nu", r"(?<!\d)(?P<valor>\d{11})(?!\d)"),
        # rótulo seguido do número, tolerando espaço/quebra do OCR entre os dois
        ("cpf_rotulado", r"CPF[\s.:nºo°/-]*(?P<valor>\d[\d.\s-]{9,17}\d)"),
    ],
    "RG": [
        (
            "rg_rotulado",
            r"(?:RG|R\.G\.|Registro\s+Geral|[Ii]dentidade)[\s.:nºo°/-]*"
            r"(?P<valor>\d[\d.\sXx-]{4,16}[\dXx])",
        ),
        (
            "rg_com_orgao",
            r"(?P<valor>\d[\d.\sXx-]{5,16})\s*-?\s*(?:SSP|SSPDS|DETRAN|PC|IFP|SDS)[A-Z/\s-]{0,6}",
        ),
    ],
    "TELEFONE": [
        ("tel_parenteses", r"\(\d{2}\)\s*\d{4,5}[\s-]?\d{4}"),
        ("tel_solto", r"(?<!\d)\d{2}\s?9?\d{4}[\s-]\d{4}(?!\d)"),
        ("tel_internacional", r"\+55\s?\(?\d{2}\)?\s?9?\d{4}[\s-]?\d{4}"),
    ],
    "CEP": [
        ("cep", r"(?<!\d)(?P<valor>\d{2}\.?\d{3}-\d{3})(?!\d)"),
        ("cep_rotulado", r"CEP[\s.:nºo°-]*(?P<valor>\d{2}\.?\d{3}[\s-]*\d{3})"),
    ],
    "EMAIL": [
        ("email", r"(?P<valor>[A-Za-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,})(?![a-z])"),
    ],
    "CNPJ": [
        ("cnpj_formatado", r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}"),
        ("cnpj_nu", r"(?<!\d)\d{14}(?!\d)"),
    ],
    "CNJ": [
        ("cnj_formatado", r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}"),
        ("cnj_nu", r"(?<!\d)\d{20}(?!\d)"),
    ],
    "OAB": [
        # \bOAB\b evita casar dentro de "razoabilidade" e "oabreu71@..."
        ("oab", r"\bOAB\b[\s.:/nºo°-]*(?:[A-Z]{2})?[\s.:/nºo°-]*(?P<valor>\d[\d.]{2,7})"),
        ("oab_invertido", r"\d[\d.]{2,7}\s*/\s*[A-Z]{2}\b(?=[^\w]*OAB|\s*OAB)"),
    ],
    "TITULO_ELEITOR": [
        ("titulo", r"[Tt][íi]tulo\s+(?:de\s+)?[Ee]leitor[\s.:nºo°-]*\d[\d.\s-]{9,14}"),
    ],
    "CNH": [
        ("cnh", r"\bCNH\b[\s.:nºo°-]*\d[\d.\s-]{8,14}"),
    ],
    "PIS": [
        # \bPIS\b evita o falso positivo dentro de "episódios"
        ("pis", r"\b(?:PIS|PASEP|NIT)\b[\s.:nºo°/-]*\d[\d.\s-]{9,14}"),
    ],
    "ENDERECO": [
        (
            "logradouro",
            rf"\b(?:{_LOGRADOUROS})\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^\n,;]{{2,60}}"
            rf"(?:,\s*(?:n[ºo°.]?\s*)?\d{{1,5}}|,\s*s/?n)?",
        ),
        (
            "ancora",
            rf"\b(?:{_ANCORA_ENDERECO})\b[^\n]{{0,120}}",
        ),
    ],
    "DATA": [
        ("data_numerica", r"(?<!\d)\d{2}/\d{2}/\d{4}(?!\d)"),
    ],
}

# Compila uma vez.
_COMPILADOS: dict[str, list[tuple[str, re.Pattern[str]]]] = {
    tipo: [(nome, re.compile(rx)) for nome, rx in padroes]
    for tipo, padroes in PADROES.items()
}


def extrair(texto: str, tipos: list[str] | None = None) -> list[Candidato]:
    """Extrai todos os candidatos do texto, ordenados por posição."""
    alvo = tipos if tipos else list(_COMPILADOS)
    encontrados: list[Candidato] = []

    for tipo in alvo:
        for nome, rx in _COMPILADOS[tipo]:
            for m in rx.finditer(texto):
                # O span é o grupo `valor` quando o padrão o define — assim o
                # rótulo ("CPF:") e o órgão emissor ("SSP/CE") ficam de fora.
                if "valor" in rx.groupindex and m.group("valor") is not None:
                    start, end = m.span("valor")
                else:
                    start, end = m.span()

                # O OCR deixa espaço/pontuação nas bordas do grupo.
                bruto = texto[start:end]
                recorte = bruto.rstrip(" .,;:-\n\t")
                end -= len(bruto) - len(recorte)
                bruto = recorte.lstrip(" .,;:-\n\t")
                start += len(recorte) - len(bruto)

                if end <= start:
                    continue

                encontrados.append(
                    Candidato(
                        tipo=tipo,
                        start=start,
                        end=end,
                        texto=texto[start:end],
                        padrao=nome,
                    )
                )

    encontrados.sort(key=lambda c: (c.start, -c.end))
    return encontrados


def agrupar_por_valor(candidatos: list[Candidato]) -> dict[str, list[Candidato]]:
    """Agrupa ocorrências pelo valor normalizado — separa PII distinta de repetição."""
    grupos: dict[str, list[Candidato]] = {}
    for c in candidatos:
        grupos.setdefault(f"{c.tipo}:{c.chave}", []).append(c)
    return grupos
