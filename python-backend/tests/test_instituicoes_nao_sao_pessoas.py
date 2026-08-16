"""
Órgão público não é dado pessoal — e mascará-lo inutiliza o documento.

O modelo de linguagem devolve "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ" e
"DELEGACIA MUNICIPAL DE OCARA" como PERSON: são maiúsculas com estrutura de
nome próprio. Num processo real isso não é um erro pequeno — o cabeçalho
institucional se repete em toda página, e como esses trechos alimentam o
gazetteer que espalha nomes pelo documento, cada acerto falso vira centenas de
tarjas. Foi o que aconteceu com o primeiro documento processado em produção:
até "Data Movimentação" e "Não Informado" saíram mascarados.

O contrapeso é a regra que não pode ser quebrada: **nome de pessoa continua
mascarado**. Metade destes testes existe para garantir que a limpeza não apaga
gente — inclusive quem tem sobrenome que também nomeia órgão ("Vara", "Câmara",
"Campos", "Guarda").
"""

import pytest

from engine import _recortar_nome, get_engine


def recorte(trecho: str) -> str | None:
    """O que sobra do trecho depois de tirar órgão e rótulo."""
    faixa = _recortar_nome(trecho)
    return None if faixa is None else trecho[faixa[0] : faixa[1]]


# --- Órgãos, rótulos e fragmentos: não são pessoas -------------------------

@pytest.mark.parametrize(
    "trecho",
    [
        # órgãos, como aparecem no cabeçalho de cada página
        "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ",
        "MINISTERIO PUBLICO DO ESTADO DO CEARA",  # sem acento, como sai do OCR
        "TRIBUNAL DE JUSTICA DO ESTADO DO CEARA",
        "PODER JUDICIÁRIO DO ESTADO DO CEARÁ",
        "DELEGACIA MUNICIPAL DE OCARA",
        "PROMOTORIA DE JUSTIÇA DE OCARA",
        "SECRETARIA DA SEGURANÇA PÚBLICA E DEFESA SOCIAL",
        "GOVERNO DO ESTADO DO CEARÁ",
        "POLÍCIA CIVIL",
        "3º NÚCLEO REGIONAL DE CUSTÓDIA",
        "VARA ÚNICA DA COMARCA DE OCARA",
        "DEFENSORIA PÚBLICA",
        # rótulos de formulário e cabeçalhos de tabela
        "DATA MOVIMENTAÇÃO",
        "NÃO INFORMADO",
        "CERTIDÕES DA SECRETARIA",
        "AUTORIDADE POLICIAL",
        "CLASSE",
        "ASSINADO",
        # matéria processual que o modelo lê como nome próprio
        "TRÁFICO DE DROGAS E CONDUTAS",
        # fragmentos de frase mal segmentada
        "BEM COMO",
        "EM QUE",
        # unidade da federação isolada
        "CEARÁ",
        "BRASIL",
    ],
)
def test_nao_sobra_nome_de_pessoa(trecho):
    assert recorte(trecho) is None


# --- Pessoas: continuam sendo pessoas --------------------------------------

@pytest.mark.parametrize(
    "trecho",
    [
        "Ana Paula dos Santos Ribeiro",
        "ELIONEUDO EVARISTO DE ABREU",
        "Maria Francielly Ferreira da Silva",
        # o rótulo que introduz o nome não pode derrubar o nome junto
        "ADVOGADO JOÃO SILVA",
        "Juiz Marcelo Tavares",
        "Dr. Rafael Militão",
        # sobrenomes que também nomeiam órgão ou repartição
        "Pedro Vara Lima",
        "João Câmara Neto",
        "Maria do Socorro Campos",
        "Antônio Guarda",
        "Luciana Estado Silva",
    ],
)
def test_continua_sendo_nome_de_pessoa(trecho):
    sobra = recorte(trecho)
    assert sobra is not None, 'o nome não pode desaparecer do conjunto'
    # O rótulo pode sair, o nome não: a última palavra é sempre do nome.
    assert trecho.split()[-1] in sobra


# --- Órgão e pessoa no mesmo trecho ----------------------------------------
#
# O erro que a primeira versão desta limpeza cometeu, e que o harness pegou: o
# modelo marca órgão e pessoa num span só, e recusar o span inteiro limpava o
# cabeçalho enquanto **expunha o nome**. Oito nomes reais ficaram desprotegidos
# num único documento. Trocar excesso de máscara por vazamento é o único
# resultado inaceitável aqui.

@pytest.mark.parametrize(
    "trecho, nome",
    [
        (
            "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ JOEL DA SILVA MORAIS",
            "JOEL DA SILVA MORAIS",
        ),
        (
            "PROMOTORIA DE JUSTIÇA Maria Francielly Ferreira da Silva",
            "Maria Francielly Ferreira da Silva",
        ),
        ("ASSINADO POR FULANO DE TAL", "FULANO DE TAL"),
        ("TRIBUNAL DE JUSTIÇA Dr. Rafael Militão", "Rafael Militão"),
    ],
)
def test_orgao_sai_e_a_pessoa_fica(trecho, nome):
    sobra = recorte(trecho)
    assert sobra is not None, "o nome não pode ser descartado junto com o órgão"
    assert nome in sobra


# --- Efeito no documento ---------------------------------------------------

@pytest.fixture(scope="module")
def engine():
    eng = get_engine()
    eng.initialize()
    return eng


def anonimizar(engine, texto: str) -> str:
    return engine.anonymize(
        text=texto, entities=["PERSON"], language="pt", politica_mascara="placeholder"
    )["anonymized_text"]


def test_cabecalho_institucional_sai_intacto(engine):
    """O cabeçalho que se repete em toda página precisa continuar legível."""
    texto = (
        "PODER JUDICIÁRIO DO ESTADO DO CEARÁ\n"
        "Comarca de Ocara — Vara Única\n"
        "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ\n"
    )
    saida = anonimizar(engine, texto)
    assert "PODER JUDICIÁRIO" in saida
    assert "MINISTÉRIO PÚBLICO" in saida
    assert "Vara Única" in saida


def test_nome_ao_lado_da_instituicao_continua_mascarado(engine):
    """
    O caso que decide se a limpeza foi longe demais: instituição e pessoa na
    mesma linha. A instituição sai inteira, o nome não sobra.
    """
    texto = (
        "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ, por seu promotor "
        "ANTONIO CARLOS PEREIRA MENDES, denuncia o acusado."
    )
    saida = anonimizar(engine, texto)
    assert "MINISTÉRIO PÚBLICO" in saida, "o órgão não é dado pessoal"
    assert "ANTONIO CARLOS PEREIRA MENDES" not in saida, "o promotor é pessoa física"


def test_instituicao_nao_alimenta_a_propagacao(engine):
    """
    O multiplicador do problema: um PERSON falso vira semente do gazetteer e é
    reencontrado no documento inteiro. Filtrar só no fim deixaria de pé as
    centenas de ocorrências que a semente gerou.
    """
    texto = (
        "DELEGACIA MUNICIPAL DE OCARA\n"
        + "Ofício da DELEGACIA MUNICIPAL DE OCARA ao juízo.\n" * 5
    )
    saida = anonimizar(engine, texto)
    assert saida.count("DELEGACIA MUNICIPAL DE OCARA") == 6
