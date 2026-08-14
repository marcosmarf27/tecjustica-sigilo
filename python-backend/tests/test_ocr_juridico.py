"""
Regressão dos casos que vazavam em OCR real de processo judicial.

Cada teste aqui nasceu de uma ocorrência medida no corpus, não de um exemplo
inventado: o OCR de digitalização parte entidades entre linhas, gruda o texto
seguinte no dado e troca dígitos por letras parecidas. São esses os casos que
fazem a diferença entre 85% e 99% de recall, e é por isso que eles ficam
travados por teste.

Roda no modo leve (spaCy) por padrão; a detecção testada aqui vem de regex e
não depende do modelo pesado.
"""

import pytest

from engine import get_engine


@pytest.fixture(scope="module")
def engine():
    eng = get_engine()
    eng.initialize()
    return eng


def anonimizar(
    engine,
    texto: str,
    entidades: list[str] | None = None,
    politica: str = "placeholder",
) -> str:
    return engine.anonymize(
        text=texto,
        entities=entidades or [],
        politica_mascara=politica,
    )["anonymized_text"]


# --- Entidade partida pela quebra de linha ---------------------------------
# O PDF quebra em coluna e o dado fica em duas linhas. Analisando linha a
# linha, cada metade é irreconhecível.

def test_telefone_partido_entre_linhas(engine):
    texto = "Brasil, telefone (85)\n    99233-2854."
    assert "99233-2854" not in anonimizar(engine, texto)


def test_cep_partido_entre_linhas(engine):
    texto = "sem número, CEP - 60.755-\n000, e a parte compareceu"
    saida = anonimizar(engine, texto)
    assert "60.755-" not in saida or "000" not in saida.split("60.755-")[-1][:5]


def test_rg_com_rotulo_em_outra_linha(engine):
    texto = "natural de Ocara/CE, RG:\n    93002347504 SSP/CE, residente"
    assert "93002347504" not in anonimizar(engine, texto)


def test_nome_partido_entre_linhas(engine):
    # O nome aparece inteiro num ponto e partido noutro; o segundo só é
    # recuperável propagando o que já foi reconhecido no documento.
    texto = (
        "Acusado: ELIONEUDO EVARISTO DE ABREU, brasileiro.\n"
        "Consta que o imputável ELIONEUDO EVARISTO\n"
        "    DE ABREU praticou o fato."
    )
    saida = anonimizar(engine, texto)
    assert "EVARISTO" not in saida


# --- OCR grudando caracteres ----------------------------------------------

def test_cnj_com_prefixo_grudado(engine):
    # "nº0200449..." — o "º" conta como caractere de palavra, então a fronteira
    # \b não existe entre ele e o dígito.
    texto = "proferida nos autos do processo nº0200449-65.2024.8.06.0203 do Juízo"
    assert "0200449-65.2024.8.06.0203" not in anonimizar(engine, texto)


def test_oab_com_palavra_grudada(engine):
    texto = "Advogado: Claudoberto Oliveira da Silva, OAB/CE 40407Acusado:"
    assert "40407" not in anonimizar(engine, texto)


def test_cpf_com_data_grudada(engine):
    texto = "CPF 030.736.473-9201/11/1986 consta dos autos"
    assert "030.736.473-92" not in anonimizar(engine, texto)


def test_email_com_texto_grudado(engine):
    # "ocara@tjce.jus.brOcara" — o recognizer padrão não casa porque
    # "brOcara" não é TLD. O span precisa terminar no ".br".
    saida = anonimizar(engine, "Contato: ocara@tjce.jus.brOcara e outros")
    assert "ocara@tjce.jus.br" not in saida


# --- OCR trocando dígito por letra ----------------------------------------

def test_cpf_com_letra_no_lugar_de_digito(engine):
    # "973-g1": o dígito verificador não fecha, mas o formato pontuado e o
    # rótulo são evidência suficiente — descartar aqui seria vazar um CPF real.
    texto = "CPF: 916.811.973-g1 do titular"
    assert "916.811.973" not in anonimizar(engine, texto)


# --- Endereço --------------------------------------------------------------

def test_endereco_completo(engine):
    texto = "residente na Rua Cassiano Correia, 4, Boa Esperança; CEP 62755-000"
    saida = anonimizar(engine, texto)
    assert "Cassiano Correia" not in saida
    assert "62755-000" not in saida


def test_cep_isolado_em_endereco(engine):
    texto = "Boa Esperança, 62755-000, Ocara/CE"
    assert "62755-000" not in anonimizar(engine, texto)


def test_rua_com_nome_de_pessoa_sai_como_endereco(engine):
    # Logradouro com nome de pessoa é a regra, não a exceção. O resultado
    # precisa ser uma máscara coerente de endereço, não pedaços de nome
    # costurados — daí verificar que sai UM marcador de endereço, e não uma
    # sequência de marcadores de pessoa.
    texto = "Rua Antônio José Correia, n° 134, Centro; CEP 62755-000"
    saida = anonimizar(engine, texto)
    assert "Antônio José Correia" not in saida
    assert saida.count("[ENDEREÇO_") == 1
    assert "[PESSOA_" not in saida

    # Na política de máscara parcial, o tipo do logradouro fica legível.
    parcial = anonimizar(engine, texto, politica="parcial")
    assert parcial.startswith("Rua ")


# --- Rótulos que o OCR não deve arrastar para dentro da máscara ------------

def test_orgao_emissor_do_rg_nao_e_mascarado(engine):
    # Nem o órgão nem a sigla da UF são dado pessoal: "CE" sozinho não
    # identifica ninguém, e mascará-lo só deixa o documento ilegível.
    saida = anonimizar(engine, "RG: 93002347504 SSP/CE, residente")
    assert "SSP/CE" in saida, "o órgão emissor não é dado pessoal"


def test_rotulo_cpf_permanece_legivel(engine):
    saida = anonimizar(engine, "CPF: 004.811.253-45, nascido em")
    assert "CPF:" in saida


# --- Precisão: o que não pode ser mascarado --------------------------------

def test_pis_nao_casa_dentro_de_episodios(engine):
    texto = "os episódios narrados pela vítima revelam"
    assert "episódios" in anonimizar(engine, texto, ["NIT_PIS_PASEP"])


def test_oab_nao_casa_dentro_de_razoabilidade(engine):
    texto = "o princípio da razoabilidade impõe"
    assert "razoabilidade" in anonimizar(engine, texto, ["OAB_BR"])


def test_data_comum_nao_vira_data_de_nascimento(engine):
    # Sem âncora, uma data é só uma data: audiência, prazo, data do fato.
    # Mascarar todas inutiliza o documento para leitura processual.
    texto = "Designo audiência para 15/03/2026 às 09:00."
    assert "15/03/2026" in anonimizar(engine, texto, ["DATE_OF_BIRTH"])


def test_data_de_nascimento_com_ancora_e_mascarada(engine):
    texto = "nascido em 03/05/1975, natural de Ocara"
    assert "03/05/1975" not in anonimizar(engine, texto, ["DATE_OF_BIRTH"])


# --- Integridade estrutural ------------------------------------------------

def test_mascara_preserva_quebras_de_linha(engine):
    texto = "Acusado: JOAO DA SILVA\nEndereço: Rua X, 10\nCPF: 123.456.789-09"
    saida = anonimizar(engine, texto)
    assert saida.count("\n") == texto.count("\n"), (
        "a máscara não pode consumir a quebra de linha, senão destrói a "
        "estrutura do documento"
    )


def test_spans_nao_se_sobrepoem_no_resultado(engine):
    """Detecções concorrentes precisam sair fundidas, não sobrepostas."""
    texto = "Rua Antônio José Correia, n° 134, Centro, Ocara-CE - CEP 62755-000"
    resultado = get_engine().anonymize(text=texto, entities=[])
    spans = sorted(
        (e["start"], e["end"]) for e in resultado["entities_found"]
    )
    for (_, fim_anterior), (inicio, _) in zip(spans, spans[1:]):
        assert inicio >= fim_anterior, "spans sobrepostos corrompem a saída"
