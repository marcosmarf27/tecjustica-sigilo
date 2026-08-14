"""
Regras de mask customizadas por entidade.
Cada função recebe o texto original da entidade e retorna o texto mascarado.
"""

import re
from typing import Callable

MaskFn = Callable[[str], str]


def mask_person(text: str) -> str:
    """Mostra 1ª letra de cada nome: 'João da Silva' → 'J**** d* S****'"""
    parts = text.split()
    masked = []
    for part in parts:
        if len(part) <= 1:
            masked.append(part)
        else:
            masked.append(part[0] + "*" * (len(part) - 1))
    return " ".join(masked)


def mask_cpf(text: str) -> str:
    """Mostra 3 primeiros + 2 últimos: '123.456.789-09' → '123.***.***-09'"""
    digits = re.sub(r"\D", "", text)
    if len(digits) == 11:
        return f"{digits[:3]}.***.***-{digits[-2:]}"
    return "*" * len(text)


def mask_cnpj(text: str) -> str:
    """Mostra 2 primeiros + 2 últimos: '12.345.678/0001-90' → '12.***.***/****-90'"""
    digits = re.sub(r"\D", "", text)
    if len(digits) == 14:
        return f"{digits[:2]}.***/****-{digits[-2:]}"
    return "*" * len(text)


def mask_rg(text: str) -> str:
    """Tudo mascarado exceto último dígito: '12.345.678-9' → '**.***.***-9'"""
    if "-" in text:
        parts = text.rsplit("-", 1)
        base = re.sub(r"\d", "*", parts[0])
        return f"{base}-{parts[1]}"
    return "*" * (len(text) - 1) + text[-1]


def mask_email(text: str) -> str:
    """Mostra 2 primeiras letras + domínio: 'joao@gmail.com' → 'jo****@gmail.com'"""
    if "@" not in text:
        return "*" * len(text)
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        masked_local = local
    else:
        masked_local = local[:2] + "*" * (len(local) - 2)
    return f"{masked_local}@{domain}"


def mask_phone(text: str) -> str:
    """
    Mostra DDD e dois últimos dígitos, preservando a pontuação do original:
    '(85) 99999-1234' → '(85) *****-**34'

    Mascarar dígito a dígito, em vez de reconstruir o formato, evita dois
    problemas: o span pode não incluir o parêntese de abertura (e reconstruí-lo
    produziria '((85)'), e o comprimento do resultado se mantém igual ao da
    entrada, o que é o que permite aplicar as máscaras em lote sem desalinhar
    o texto.
    """
    digitos = re.sub(r"\D", "", text)
    if len(digitos) < 10:
        return re.sub(r"\d", "*", text)

    total = len(digitos)
    visiveis = {0, 1, total - 2, total - 1}  # DDD e dois últimos

    saida = []
    indice = 0
    for ch in text:
        if ch.isdigit():
            saida.append(ch if indice in visiveis else "*")
            indice += 1
        else:
            saida.append(ch)
    return "".join(saida)


def mask_location(text: str) -> str:
    """Mostra 2 primeiras letras: 'Fortaleza' → 'Fo*******'"""
    if len(text) <= 2:
        return text
    return text[:2] + "*" * (len(text) - 2)


def mask_cep(text: str) -> str:
    """
    Preserva a região, esconde o endereço: '62755-000' → '62***-***'.

    Os dois primeiros dígitos identificam o estado/região, o que costuma ser
    necessário para a leitura processual; o resto localiza o domicílio.
    """
    digits = re.sub(r"\D", "", text)
    if len(digits) == 8:
        return f"{digits[:2]}***-***"
    return "*" * len(text)


def mask_endereco(text: str) -> str:
    """
    Mantém o tipo do logradouro e mascara o resto:
    'Rua Cassiano Correia, 4, Boa Esperança' → 'Rua *********************************'

    O tipo sozinho não identifica ninguém e preserva a legibilidade da frase.
    """
    match = re.match(
        r"\s*(Rua|RUA|R\.|Avenida|AVENIDA|Av\.|AV\.|Travessa|TRAVESSA|Trav\.|"
        r"Alameda|Al\.|Estrada|ESTRADA|Rodovia|Rod\.|Sítio|SÍTIO|Sitio|SITIO|"
        r"Distrito|DISTRITO|Localidade|LOCALIDADE|Conjunto|Conj\.|Praça|PRAÇA|"
        r"Praca|Vila|VILA|Loteamento|Assentamento|Povoado|Fazenda|Quadra)\s+",
        text,
    )
    if match:
        prefixo = match.group(0)
        return prefixo + "*" * (len(text) - len(prefixo))
    return "*" * len(text)


def mask_oab(text: str) -> str:
    """Estado visível, número mascarado: 'OAB/CE 12345' → 'OAB/CE *****'"""
    match = re.match(r"(OAB[/\s]?\w{2}[/\s]?)(.*)", text, re.IGNORECASE)
    if match:
        prefix = match.group(1)
        number = match.group(2)
        return prefix + "*" * len(number)
    return "*" * len(text)


def mask_date_of_birth(text: str) -> str:
    """Mostra só o ano: '15/03/1985' → '**/**/1985'"""
    match = re.match(r"(\d{2})/(\d{2})/(\d{4})", text)
    if match:
        return f"**/**/{match.group(3)}"
    return "*" * len(text)


def mask_nit(text: str) -> str:
    """3 primeiros + último: '123.45678.90-1' → '123.*****.**-*'"""
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 4:
        return f"{digits[:3]}.*****.{digits[-3:-1]}-*"
    return "*" * len(text)


def mask_processo_cnj(text: str) -> str:
    """Ano + ramo visíveis: '0001234-56.2023.8.06.0001' → '*******-**.2023.8.06.****'"""
    match = re.match(
        r"(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})", text
    )
    if match:
        ano = match.group(3)
        justica = match.group(4)
        tribunal = match.group(5)
        return f"*******-**.{ano}.{justica}.{tribunal}.****"
    return "*" * len(text)


def mask_conta_bancaria(text: str) -> str:
    """Tudo mascarado: 'Ag 1234 CC 56789-0' → 'Ag **** CC *****-*'"""
    return re.sub(r"\d", "*", text)


# Mapeamento entidade → função de mask
MASK_FUNCTIONS: dict[str, MaskFn] = {
    "PERSON": mask_person,
    "CPF_BR": mask_cpf,
    "CNPJ_BR": mask_cnpj,
    "RG_BR": mask_rg,
    "EMAIL_ADDRESS": mask_email,
    "PHONE_NUMBER_BR": mask_phone,
    "LOCATION": mask_location,
    "CEP_BR": mask_cep,
    "ENDERECO_BR": mask_endereco,
    "OAB_BR": mask_oab,
    "DATE_OF_BIRTH": mask_date_of_birth,
    "NIT_PIS_PASEP": mask_nit,
    "NUMERO_PROCESSO_CNJ": mask_processo_cnj,
    "CONTA_BANCARIA": mask_conta_bancaria,
}


def apply_mask(entity_type: str, text: str) -> str:
    """Aplica a função de mask correspondente ao tipo de entidade."""
    fn = MASK_FUNCTIONS.get(entity_type)
    if fn is not None:
        return fn(text)
    # Fallback: mascara tudo
    return "*" * len(text)
