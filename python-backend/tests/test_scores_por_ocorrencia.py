"""
O score que chega à revisão é por ocorrência, não por tipo.

A tela de Revisão exibe a confiança de cada tarja para o revisor decidir o que
conferir primeiro. Até 02/09/2026, `_fundir_spans` guardava o **maior score do
tipo no documento inteiro** e o atribuía a toda ocorrência daquele tipo: uma
única detecção de PERSON a 0,99 fazia todas as outras — inclusive frase
jurídica tarjada por engano — exibirem 100% de confiança. Piora concreta: a
nota perde a função de priorizar revisão justamente no caso em que há pouco
que seja nome de verdade.

Estes testes montam os brutos à mão, no formato que o `anonymize` produz
(tuplas start/end/tipo/score), e medem só a fusão. Não passam pelo detector,
não carregam modelo, rodam em milissegundos.
"""

from engine import PresidioEngine


def fundir(texto: str, brutos):
    return PresidioEngine._fundir_spans(texto, brutos)


def test_cada_ocorrencia_guarda_o_proprio_score():
    """
    Uma detecção fraca não herda a confiança de uma forte do mesmo tipo noutro
    canto do documento — e vice-versa.
    """
    texto = "Ana Lima ouviu Bruno Costa."
    brutos = [
        (0, 8, "PERSON", 0.55),
        (15, 27, "PERSON", 0.99),
    ]

    saida = fundir(texto, brutos)

    scores = {s[0]: s[3] for s in saida}
    assert scores[0] == 0.55
    assert scores[15] == 0.99


def test_spans_sobrepostos_do_mesmo_tipo_fundem_com_o_maior_score():
    """
    A fusão de duas janelas sobrepostas repete a entidade com scores
    diferentes; o run resultante carrega a confiança da melhor delas.
    """
    texto = "Ana Lima foi citada."
    brutos = [
        (0, 8, "PERSON", 0.60),
        (0, 4, "PERSON", 0.92),
    ]

    saida = fundir(texto, brutos)

    assert len(saida) == 1
    assert saida[0][0] == 0 and saida[0][1] == 8
    assert saida[0][3] == 0.92


def test_tipo_de_maior_prioridade_nao_empresta_score_ao_de_baixo():
    """
    Onde CPF pinta por cima de PERSON, o run de PERSON restante mantém o
    próprio score — o do CPF não entra na conta, nem o dele no CPF.
    """
    texto = "João 111.444.777-35 Silva"
    brutos = [
        (0, 5, "PERSON", 0.50),
        (6, 20, "CPF_BR", 0.95),
        (21, 26, "PERSON", 0.70),
    ]

    saida = fundir(texto, brutos)

    por_tipo = {s[2]: s[3] for s in saida}
    assert por_tipo["PERSON"] == 0.70
    assert por_tipo["CPF_BR"] == 0.95


def test_propagacao_nao_uniformiza_scores():
    """
    O caso real: o gazetteer devolve repetições a 0,6 e o NER original a ~1,0.
    Cada uma exibe a nota que de fato tem.
    """
    texto = "Renato Lima escreveu. Renato Lima escreveu de novo."
    brutos = [
        (0, 11, "PERSON", 0.98),
        (22, 33, "PERSON", 0.60),
    ]

    saida = fundir(texto, brutos)

    scores = [s[3] for s in saida]
    assert 0.98 in scores and 0.60 in scores


def test_fragmento_entre_quebras_de_linha_nao_vira_entidade():
    """
    Caso real (peça 002 do processo 0201848): o modelo tarja o nome inteiro,
    mas o texto original tem quebras de linha dentro dele — e `_fundir_spans`
    quebra o run em cada `\\n`. O pedaço de 1 caractere entre duas quebras é
    fragmento de OCR, não dado pessoal, e não pode chegar à revisão como
    ocorrência de uma letra só. O piso do `_aparar` vale para o run.
    """
    texto = "Maria\na\nSilva"
    brutos = [(0, len(texto), "PERSON", 0.97)]

    saida = fundir(texto, brutos)

    pedacos = [texto[s[0]:s[1]] for s in saida]
    assert "a" not in pedacos
    assert "Maria" in pedacos and "Silva" in pedacos
