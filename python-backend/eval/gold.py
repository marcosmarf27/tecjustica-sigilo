"""
Construção do gabarito (ground truth) de PII sobre o corpus real.

O gabarito não é escrito à mão nem gerado pelo detector que estamos avaliando —
isso mediria o motor contra ele mesmo. Ele vem de duas fontes independentes:

1. **Rótulo processual.** `Acusado:`, `Vítima(s):`, `Requerente:`, `Denunciado(a):`
   e afins introduzem um nome de parte com altíssima confiabilidade. O nome
   colhido ali vira verdade conhecida, e então TODAS as suas ocorrências no
   documento entram no gabarito — inclusive as que aparecem soltas no meio de
   uma frase, que são justamente o caso difícil.

2. **Formato + verificação.** CPF, CNPJ e número CNJ têm dígito verificador;
   telefone, CEP, e-mail e OAB têm formato característico. Os candidatos de
   `candidates.py` passam por conferência antes de virar gabarito.

O resultado é gravado com offsets e hash do valor, não com o valor em claro
(ver `salvar`), para que o gabarito possa conviver com o repositório sem
carregar dado pessoal.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, asdict
from pathlib import Path

from eval.candidates import extrair, normalizar
from eval.corpus import Documento

# Rótulos que introduzem nome de parte. Tolerantes a "(a)", "(s)", espaços do OCR.
_ROTULOS_PESSOA = (
    r"Acusad[oa]|Denunciad[oa]|Indiciad[oa]|Investigad[oa]|R[ée]u|R[ée]"
    r"|V[íi]tima|V[ÍI]TIMA|Ofendid[oa]"
    r"|Testemunha|Declarante|Depoente"
    r"|Requerente|Requerid[oa]|Autor[a]?|Exequente|Executad[oa]"
    r"|Advogad[oa]|Defensor[a]?|Querelante|Querelad[oa]"
)

_RE_NOME_ROTULADO = re.compile(
    rf"\b(?:{_ROTULOS_PESSOA})\s*(?:\([as]\))?\s*:\s*"
    r"([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁ-Úá-úÀ-ÿÇç]+"
    r"(?:\s+(?:d[aeo]s?|D[AEO]S?|e|E)?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÁ-Úá-úÀ-ÿÇç]+){1,5})"
)

# Sufixos que o OCR arrasta junto e não fazem parte do nome.
_RE_SUFIXO_LIXO = re.compile(
    r"\s+(?:e\s+outr[oa]s?|e\s+outr[oa]|P$|Não\s+[Ii]nformado.*"
    r"|e\s+(?:tjce|tribunal|minist[ée]rio|justi[çc]a|[a-z0-9.-]+\.(?:br|com)).*)$",
    re.IGNORECASE,
)

# Um nome plausível tem ao menos duas partes alfabéticas de 2+ letras e não é
# uma expressão institucional. Assinatura manuscrita ilegível não passa aqui.
_RE_PARTE_NOME = re.compile(r"^[A-Za-zÁ-Úá-úÀ-ÿÇç]{2,}$")

_NAO_E_NOME = {
    "nao informado", "nao identificado", "a apurar", "ignorado",
    "menor", "sem dados", "identidade preservada", "sigiloso",
}

# Partículas que não valem como "parte significativa" de um nome.
_PARTICULAS = {"de", "da", "do", "das", "dos", "e", "di", "del", "von", "san"}

# O OCR cola o texto seguinte no nome ("...DOS SANTOS CERTIFICO que..."), porque
# tudo continua capitalizado. O nome termina no primeiro termo processual.
_STOPWORDS_NOME = {
    # atos e peças
    "certifico", "certidao", "certidoes", "vistos", "designo", "conforme",
    "denuncia", "mandado", "oficio", "cota", "ministerial", "pedido",
    "diligencias", "trata", "considerando", "inquerito", "termo", "audiencia",
    "ata", "decisao", "sentenca", "despacho", "peticao", "laudo", "exame",
    "auto", "autos", "prisao", "flagrante", "boletim", "ocorrencia", "envio",
    "publicacao", "intimacao", "citacao", "acordo", "alegacoes", "memoriais",
    "recibo", "guia", "carta", "precatoria", "aditamento", "cumprimento",
    # papéis e órgãos
    "requerido", "requerida", "requerente", "acusado", "acusada", "vitima",
    "testemunha", "declarante", "denunciado", "denunciada", "indiciado",
    "indiciada", "advogado", "advogada", "reu", "re", "autor", "autora",
    "oficial", "justica", "juiz", "juiza", "promotor", "promotora",
    "delegado", "delegada", "escrivao", "escriva", "secretaria", "diretora",
    "vara", "comarca", "estado", "poder", "judiciario", "tribunal",
    "ministerio", "publico", "defensoria", "defensor", "policia", "policial",
    "militar", "civil", "delegacia", "forum", "cartorio", "central",
    # campos de formulário
    "nome", "endereco", "enderecos", "data", "hora", "local", "processo",
    "numero", "classe", "assunto", "cpf", "rg", "filiacao", "naturalidade",
    "profissao", "estado civil", "observacoes", "sem", "nao", "informado",
    "mm", "exmo", "exma", "meritissimo", "meritissima",
    # ligações que o bloco de assinatura encosta no nome
    "em", "as", "às", "no", "na", "pelo", "pela", "por", "servidor",
    "servidora", "magistrado", "magistrada", "analista", "tecnico", "técnico",
    "assessor", "assessora", "chefe", "coordenador", "coordenadora",
}


def _truncar_em_stopword(nome: str) -> str:
    """Corta o nome no primeiro token que seja vocabulário processual."""
    tokens = nome.split()
    corte = len(tokens)
    for i, token in enumerate(tokens):
        if normalizar(token) in _STOPWORDS_NOME:
            corte = i
            break
    return " ".join(tokens[:corte])


@dataclass(frozen=True)
class ItemGabarito:
    """Uma ocorrência de PII que o motor DEVE mascarar."""

    tipo: str
    start: int
    end: int
    valor_hash: str
    chave: str  # identifica o valor sem revelá-lo: tipo + hash curto
    fonte: str  # como este item entrou no gabarito

    @staticmethod
    def de(tipo: str, start: int, end: int, valor: str, fonte: str) -> "ItemGabarito":
        h = hashlib.sha256(normalizar(valor).encode("utf-8")).hexdigest()
        return ItemGabarito(
            tipo=tipo,
            start=start,
            end=end,
            valor_hash=h,
            chave=f"{tipo}:{h[:12]}",
            fonte=fonte,
        )


def _limpar_nome(bruto: str) -> str:
    nome = _RE_SUFIXO_LIXO.sub("", bruto.strip())
    nome = _truncar_em_stopword(" ".join(nome.split()))
    tokens = nome.split()
    while tokens and normalizar(tokens[-1]) in _PARTICULAS:
        tokens.pop()
    return " ".join(tokens)


def _partes_significativas(nome: str) -> list[str]:
    return [
        p
        for p in nome.split()
        if normalizar(p) not in _PARTICULAS and _RE_PARTE_NOME.match(p)
    ]


def nome_plausivel(nome: str) -> bool:
    """
    Filtra o que veio do rótulo mas não é nome de pessoa: 'Não Informado',
    assinatura manuscrita virada lixo pelo OCR, fragmento de uma palavra só.
    """
    if normalizar(nome) in _NAO_E_NOME:
        return False

    partes = _partes_significativas(nome)
    if len(partes) < 2:
        return False

    # Lixo de manuscrito costuma ter partes muito curtas e sem vogal.
    vogais = sum(1 for p in partes if re.search(r"[aeiouáéíóúâêôãõà]", p, re.I))
    return vogais >= 2


def nomes_rotulados(texto: str) -> set[str]:
    """Nomes de pessoa colhidos a partir de rótulo processual explícito."""
    achados: set[str] = set()
    for m in _RE_NOME_ROTULADO.finditer(texto):
        nome = _limpar_nome(m.group(1))
        if nome_plausivel(nome):
            achados.add(nome)
    return achados


# Segunda fonte independente: o rodapé de assinatura digital do e-SAJ, que traz
# servidores, magistrados, membros do MP e advogados que peticionaram.
_RE_ASSINATURA = re.compile(
    r"assinado\s+digitalmente\s+por\s+([^.,\n]{5,70})",
    re.IGNORECASE,
)

# Assinaturas que são de órgão, não de pessoa física.
_RE_INSTITUICAO = re.compile(
    r"tribunal|minist[ée]rio|justi[çc]a|defensoria|procuradoria|"
    r"\.jus\.br|\.gov\.br|\.mp\.br|prefeitura|secretaria|delegacia|"
    r"estado\s+do|munic[íi]pio|poder\s+judici[áa]rio|banco|caixa",
    re.IGNORECASE,
)


def nomes_assinaturas(texto: str) -> set[str]:
    """Nomes colhidos dos blocos de assinatura digital, exceto os de órgão."""
    achados: set[str] = set()
    for m in _RE_ASSINATURA.finditer(texto):
        bruto = m.group(1).strip()
        if _RE_INSTITUICAO.search(bruto):
            continue
        nome = _limpar_nome(bruto)
        if nome_plausivel(nome):
            achados.add(nome)
    return achados


def _variantes_busca(nome: str) -> list[str]:
    """
    Formas sob as quais um nome aparece ao longo do documento: o nome inteiro e
    os blocos contíguos de sobrenome que o OCR deixa órfãos ao quebrar colunas
    (ex.: 'AFONSO DOS SANTOS' de 'FRANCISCO AFONSO DOS SANTOS').
    """
    tokens = nome.split()
    variantes = {nome}

    def _valido(bloco: list[str]) -> bool:
        if not bloco:
            return False
        if normalizar(bloco[0]) in _PARTICULAS or normalizar(bloco[-1]) in _PARTICULAS:
            return False
        return len(_partes_significativas(" ".join(bloco))) >= 2

    # Sufixos — o caso do nome partido pela quebra de coluna.
    for i in range(1, len(tokens) - 1):
        if _valido(tokens[i:]):
            variantes.add(" ".join(tokens[i:]))

    # Prefixos ('MARIA LUCIA' de 'MARIA LUCIA FERNANDES UCHOA').
    for i in range(2, len(tokens)):
        if _valido(tokens[:i]):
            variantes.add(" ".join(tokens[:i]))

    return sorted(variantes, key=len, reverse=True)


def _regex_tolerante(nome: str) -> re.Pattern[str]:
    """
    Casa o nome ignorando acento, caixa e a quantidade de espaço entre as
    partes — o OCR desta base insere espaçamento arbitrário e perde acentos.
    """
    partes = []
    for token in nome.split():
        sem_acento = "".join(
            c for c in unicodedata.normalize("NFD", token)
            if unicodedata.category(c) != "Mn"
        )
        # cada letra aceita a versão acentuada correspondente
        letras = []
        for ch in sem_acento:
            equivalentes = _EQUIVALENTES.get(ch.lower(), ch.lower())
            letras.append(f"[{equivalentes}{equivalentes.upper()}]")
        partes.append("".join(letras))
    return re.compile(r"\s+".join(partes))


_EQUIVALENTES = {
    "a": "aáàâã", "e": "eéèê", "i": "iíì", "o": "oóòôõ",
    "u": "uúùû", "c": "cç", "n": "nñ",
}


def ocorrencias_de_nomes(texto: str, nomes: set[str]) -> list[ItemGabarito]:
    """
    Todas as posições onde cada nome conhecido (ou um bloco seu) aparece.
    Ocorrências sobrepostas são resolvidas mantendo a mais longa.
    """
    brutos: list[tuple[int, int, str]] = []
    for nome in nomes:
        for variante in _variantes_busca(nome):
            for m in _regex_tolerante(variante).finditer(texto):
                brutos.append((m.start(), m.end(), nome))

    brutos.sort(key=lambda t: (t[0], -(t[1] - t[0])))

    itens: list[ItemGabarito] = []
    ultimo_fim = -1
    for start, end, nome in brutos:
        if start < ultimo_fim:  # sobreposta com uma já aceita (mais longa)
            continue
        itens.append(ItemGabarito.de("PERSON", start, end, nome, "rotulo_processual"))
        ultimo_fim = end
    return itens


# Um run de 11 dígitos pode ser CPF ou pode ser protocolo ("Impresso nº
# 20251097685"). Sem evidência, fica fora do gabarito: cobrar do motor uma
# máscara sobre número de protocolo tornaria a métrica generosa com o alvo
# errado. As âncoras abaixo são procuradas na vizinhança do candidato.
_ANCORAS = {
    "CPF": r"\bCPF\b|\bC\.?P\.?F\b|cadastro de pessoa|inscrit[oa] no CPF|\bCIC\b",
    "RG": r"\bRG\b|\bR\.?G\.?\b|registro geral|identidade|\bSSP|\bDETRAN\b",
    "CEP": r"\bCEP\b",
    "CNPJ": r"\bCNPJ\b|inscrit[oa] no CNPJ",
}

_JANELA_ANCORA = 45


def _tem_ancora(texto: str, tipo: str, start: int, end: int) -> bool:
    padrao = _ANCORAS.get(tipo)
    if not padrao:
        return False
    esquerda = texto[max(0, start - _JANELA_ANCORA):start]
    direita = texto[end:end + 25]
    return bool(re.search(padrao, esquerda + " " + direita, re.IGNORECASE))


def _confirmado(texto: str, c) -> bool:
    """
    Decide se o candidato tem evidência suficiente para entrar no gabarito.

    Erra para o lado de EXCLUIR: um item de gabarito duvidoso vira um vazamento
    fantasma que esconde os reais.
    """
    from validators import cnpj_valid, cpf_valid, processo_cnj_valid

    digitos = re.sub(r"\D", "", c.texto)

    if c.tipo == "CPF":
        if c.padrao == "cpf_formatado":
            return True
        if cpf_valid(digitos):
            return True
        return _tem_ancora(texto, "CPF", c.start, c.end)

    if c.tipo == "RG":
        # Ambos os padrões de RG já exigem rótulo ou órgão emissor por perto.
        return 5 <= len(digitos) <= 14

    if c.tipo == "TELEFONE":
        # Sigla colada antes (IQ, IP, BO) indica número de procedimento, não
        # telefone. E um telefone não termina em algo que é claramente um ano.
        antes = texto[max(0, c.start - 3):c.start]
        if re.search(r"[A-Za-z]$", antes):
            return False
        return not re.search(r"\b(?:19|20)\d{2}$", c.texto)

    if c.tipo == "CNPJ":
        return cnpj_valid(digitos) or _tem_ancora(texto, "CNPJ", c.start, c.end)

    if c.tipo == "CNJ":
        return c.padrao == "cnj_formatado" or processo_cnj_valid(digitos)

    if c.tipo == "CEP":
        if c.padrao == "cep_rotulado":
            return True
        # Um "CEP" solto pode ser celular truncado; exige contexto de endereço.
        vizinhanca = texto[max(0, c.start - 60):c.end + 40]
        if re.search(r"fone|tel|cel|whats|contato", vizinhanca, re.IGNORECASE):
            return False
        return bool(
            re.search(
                r"\bCEP\b|rua|avenida|\bav\.|bairro|centro|s[íi]tio|distrito|"
                r"residente|domiciliad",
                vizinhanca,
                re.IGNORECASE,
            )
        )

    return True


def construir(doc: Documento, tipos_estruturados: list[str] | None = None) -> list[ItemGabarito]:
    """Gabarito completo do documento: nomes rotulados + candidatos estruturados."""
    itens: list[ItemGabarito] = []

    nomes = nomes_rotulados(doc.texto) | nomes_assinaturas(doc.texto)
    itens.extend(ocorrencias_de_nomes(doc.texto, nomes))

    tipos = tipos_estruturados or ["CPF", "RG", "TELEFONE", "CEP", "EMAIL", "CNJ", "OAB", "CNPJ"]

    # Candidatos do mesmo tipo que se sobrepõem (o mesmo CPF casado por dois
    # padrões) entram uma vez só, pelo span mais longo.
    vistos: set[tuple[str, int, int]] = set()
    aceitos: list = []
    for c in extrair(doc.texto, tipos):
        if not _confirmado(doc.texto, c):
            continue
        if any(
            t == c.tipo and not (c.end <= s or c.start >= e)
            for t, s, e in vistos
        ):
            continue
        vistos.add((c.tipo, c.start, c.end))
        aceitos.append(c)

    for c in aceitos:
        itens.append(ItemGabarito.de(c.tipo, c.start, c.end, c.texto, f"regex:{c.padrao}"))

    itens.sort(key=lambda i: (i.start, -i.end))
    return itens


def salvar(itens: list[ItemGabarito], doc: Documento, destino: Path) -> None:
    """Grava o gabarito sem valores em claro — só offsets e hash."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "documento": doc.nome,
        "sha256": doc.sha256,
        "total": len(itens),
        "itens": [asdict(i) for i in itens],
    }
    destino.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
