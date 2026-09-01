"""
A numeração dos pseudônimos é contrato, não detalhe de exibição.

`[PESSOA_1]` só serve para alguma coisa porque duas promessas se sustentam ao
mesmo tempo: **o mesmo valor recebe sempre o mesmo número** (mesmo escrito com
outra caixa ou acentuação, que é o que o OCR produz) e **os números seguem a
ordem de leitura** do documento. Juntas, elas são o que permite ao revisor
acompanhar que `[PESSOA_1]` e `[PESSOA_2]` são pessoas diferentes sem saber
quem são.

Nenhuma das duas estava travada por teste. A suíte inteira apenas *passava*
`politica_mascara="placeholder"` como parâmetro; ninguém conferia o resultado.
Isso era tolerável enquanto o texto mascarado só era exibido: um documento com
a numeração trocada continua ilegível para quem não deveria ler, que é o que o
produto promete.

Deixa de ser tolerável quando esse texto vira contexto de um modelo de
linguagem. Aí a numeração é a **única** coisa que distingue o autor do réu, e
uma mudança inocente — ordenar os spans por `end`, ou deixar de ordenar —
produziria respostas confiantes sobre quem fez o quê, trocando as pessoas. Não
quebraria nenhum teste e não pareceria um defeito.

Os testes abaixo montam os spans à mão, de propósito: não passam pelo detector,
não carregam modelo e não medem qualidade de detecção. Medem só o contrato, e
por isso rodam em milissegundos e não dependem de `PRESIDIO_NLP_MODE`.
"""

import pytest

from engine import PresidioEngine
from mask_config import Mascarador


def em(texto: str, trecho: str, tipo: str, ocorrencia: int = 0):
    """Span do `trecho` dentro do `texto`, no formato que o engine usa."""
    inicio = -1
    for _ in range(ocorrencia + 1):
        inicio = texto.index(trecho, inicio + 1)
    return (inicio, inicio + len(trecho), tipo, 0.99)


def mascarar(texto: str, spans: list, politica: str = "placeholder") -> str:
    return PresidioEngine._aplicar_mascaras(texto, spans, Mascarador(politica))


# --- O mesmo valor recebe o mesmo número -----------------------------------

def test_mesma_pessoa_com_acento_e_caixa_diferentes_recebe_um_so_numero():
    """
    As três grafias vêm do mesmo documento real: o cabeçalho em caixa alta, a
    assinatura com acento e a linha de OCR que perdeu o acento. São a mesma
    pessoa e precisam sair com o mesmo rótulo — senão o leitor conta três
    pessoas onde há uma.
    """
    texto = "JOÃO DA SILVA foi ouvido. João da Silva assinou. joao da silva compareceu."
    spans = [
        em(texto, "JOÃO DA SILVA", "PERSON"),
        em(texto, "João da Silva", "PERSON"),
        em(texto, "joao da silva", "PERSON"),
    ]

    saida = mascarar(texto, spans)

    assert saida == (
        "[PESSOA_1] foi ouvido. [PESSOA_1] assinou. [PESSOA_1] compareceu."
    )


def test_espaco_repetido_nao_cria_pessoa_nova():
    """O OCR duplica espaço entre nome e sobrenome com frequência."""
    texto = "Maria Souza e Maria  Souza são a mesma pessoa."
    spans = [
        em(texto, "Maria Souza", "PERSON"),
        em(texto, "Maria  Souza", "PERSON"),
    ]

    assert mascarar(texto, spans).count("[PESSOA_1]") == 2


def test_pessoas_diferentes_recebem_numeros_diferentes():
    texto = "Ana Lima ouviu Bruno Costa."
    spans = [
        em(texto, "Ana Lima", "PERSON"),
        em(texto, "Bruno Costa", "PERSON"),
    ]

    assert mascarar(texto, spans) == "[PESSOA_1] ouviu [PESSOA_2]."


# --- A ordem é a de leitura, não a da lista de entrada ----------------------

def test_numeracao_segue_a_ordem_do_texto_e_nao_a_da_lista():
    """
    O detector não devolve as ocorrências ordenadas por posição — elas saem por
    janela, e `_fundir_spans` resolve sobreposição, não ordem. Se a numeração
    seguisse a ordem da lista, o primeiro nome do documento poderia sair como
    `[PESSOA_2]`, e todo o resto ficaria deslocado.

    Aqui a lista chega de propósito na ordem inversa da leitura.
    """
    texto = "Ana Lima ouviu Bruno Costa."
    spans = [
        em(texto, "Bruno Costa", "PERSON"),  # aparece depois no texto
        em(texto, "Ana Lima", "PERSON"),     # aparece antes
    ]

    saida = mascarar(texto, spans)

    assert saida == "[PESSOA_1] ouviu [PESSOA_2]."
    assert saida.index("[PESSOA_1]") < saida.index("[PESSOA_2]")


def test_reencontro_nao_renumera():
    """Quem já apareceu mantém o número mesmo citado de novo lá na frente."""
    texto = "Ana Lima ouviu Bruno Costa. Depois, Ana Lima assinou."
    spans = [
        em(texto, "Ana Lima", "PERSON", ocorrencia=1),  # a segunda citação
        em(texto, "Bruno Costa", "PERSON"),
        em(texto, "Ana Lima", "PERSON", ocorrencia=0),
    ]

    assert mascarar(texto, spans) == (
        "[PESSOA_1] ouviu [PESSOA_2]. Depois, [PESSOA_1] assinou."
    )


# --- Cada tipo tem sua própria contagem ------------------------------------

def test_numeracao_e_independente_por_tipo():
    """
    `[PESSOA_1]` e `[CPF_1]` não têm relação entre si: cada tipo começa do 1.
    Se a contagem fosse global, o primeiro CPF do documento sairia como
    `[CPF_2]` só por vir depois de um nome.
    """
    texto = "Ana Lima, CPF 111.444.777-35, e Bruno Costa, CPF 529.982.247-25."
    spans = [
        em(texto, "Ana Lima", "PERSON"),
        em(texto, "111.444.777-35", "CPF_BR"),
        em(texto, "Bruno Costa", "PERSON"),
        em(texto, "529.982.247-25", "CPF_BR"),
    ]

    assert mascarar(texto, spans) == (
        "[PESSOA_1], CPF [CPF_1], e [PESSOA_2], CPF [CPF_2]."
    )


# --- A substituição não desloca o que ainda não foi aplicado ----------------

def test_mascara_mais_longa_que_o_original_nao_come_o_vizinho():
    """
    A máscara quase nunca tem o comprimento do original. Aplicar da esquerda
    para a direita deslocaria todos os offsets seguintes — daí a substituição
    ir de trás para frente. Aqui as duas ocorrências são coladas para que
    qualquer deslocamento apareça.
    """
    texto = "Ana:Bo fim"
    spans = [
        em(texto, "Ana", "PERSON"),
        em(texto, "Bo", "PERSON"),
    ]

    assert mascarar(texto, spans) == "[PESSOA_1]:[PESSOA_2] fim"


def test_texto_sem_ocorrencia_sai_intacto():
    texto = "Nada a mascarar aqui."
    assert mascarar(texto, []) == texto


# --- Por que o chat exige a política `placeholder` --------------------------

@pytest.mark.parametrize("politica", ["parcial", "total"])
def test_politicas_sem_numero_nao_distinguem_pessoas(politica):
    """
    `parcial` e `total` ocultam, mas não identificam: duas pessoas com as mesmas
    iniciais viram a mesma coisa, e `total` apaga até isso. Quem consumir o
    texto — inclusive um modelo de linguagem — não tem como saber que são duas.

    Este teste existe para que a recusa do chat a documentos mascarados com
    essas políticas tenha uma razão registrada, e não pareça arbitrária.
    """
    texto = "Ana Lima ouviu Ana Luz."
    spans = [
        em(texto, "Ana Lima", "PERSON"),
        em(texto, "Ana Luz", "PERSON"),
    ]

    saida = mascarar(texto, spans, politica)

    assert "_1]" not in saida and "_2]" not in saida
    if politica == "total":
        assert saida == "******** ouviu *******."


# --- Retirar uma ocorrência da lista ---------------------------------------
#
# `remascarar` existe para o "Não é PII" da revisão: o revisor aponta um falso
# positivo e o documento aberto precisa refletir isso na hora. Reprocessar
# custaria minutos para chegar ao mesmo texto, porque a detecção não muda — o
# que muda é um item de uma lista já decidida.


def entidades(texto: str, *spans):
    """As ocorrências no formato que a rota recebe da interface."""
    return [
        {"type": tipo, "text": texto[ini:fim], "start": ini, "end": fim, "score": s}
        for ini, fim, tipo, s in spans
    ]


def test_remascarar_devolve_o_mesmo_texto_que_a_deteccao_original():
    """
    A garantia de base: com a lista intacta, remascarar é indistinguível de
    aplicar as máscaras no fluxo normal. Sem isso, "desfazer uma detecção"
    mudaria o documento inteiro por efeito colateral.
    """
    texto = "ANA LIMA e BRUNO SÁ assinaram; ANA LIMA compareceu."
    spans = [
        em(texto, "ANA LIMA", "PERSON"),
        em(texto, "BRUNO SÁ", "PERSON"),
        em(texto, "ANA LIMA", "PERSON", 1),
    ]

    saida = PresidioEngine.remascarar(
        text=texto, entidades=entidades(texto, *spans)
    )

    assert saida["anonymized_text"] == mascarar(texto, spans)
    assert saida["valores_distintos"] == {"PERSON": 2}


def test_tirar_uma_ocorrencia_renumera_as_seguintes():
    """
    Os números seguem a ordem de leitura, então tirar a primeira pessoa promove
    a segunda a `[PESSOA_1]`. Manter o número antigo deixaria um buraco na
    sequência — e a conferência que a conversa faz sobre o texto
    (`pseudonimos.conferir`) recusa o documento com buraco, o que transformaria
    um "não é PII" em "este documento não pode mais ser conversado".
    """
    texto = "ANA LIMA e BRUNO SÁ assinaram."
    todas = entidades(
        texto, em(texto, "ANA LIMA", "PERSON"), em(texto, "BRUNO SÁ", "PERSON")
    )

    saida = PresidioEngine.remascarar(text=texto, entidades=todas[1:])

    assert saida["anonymized_text"] == "ANA LIMA e [PESSOA_1] assinaram."
    assert saida["valores_distintos"] == {"PERSON": 1}


def test_remascarar_sem_nenhuma_ocorrencia_devolve_o_texto_intacto():
    texto = "Nada aqui é dado pessoal."
    saida = PresidioEngine.remascarar(text=texto, entidades=[])
    assert saida["anonymized_text"] == texto
    assert saida["entities_found"] == []


def test_remascarar_recusa_ocorrencias_sobrepostas():
    """
    `_aplicar_mascaras` substitui de trás para frente e pressupõe spans
    disjuntos: sobrepostos, ele corrompe o texto **em silêncio**, produzindo um
    documento que parece anonimizado e não está. A recusa é a diferença entre
    um erro visível e um vazamento.
    """
    texto = "ANA LIMA assinou."
    cruzados = entidades(
        texto, (0, 8, "PERSON", 0.9), (4, 12, "PERSON", 0.9)
    )

    with pytest.raises(ValueError):
        PresidioEngine.remascarar(text=texto, entidades=cruzados)


def test_remascarar_recusa_span_fora_do_texto():
    texto = "ANA LIMA assinou."
    with pytest.raises(ValueError):
        PresidioEngine.remascarar(
            text=texto, entidades=entidades(texto, (0, 999, "PERSON", 0.9))
        )


def test_rota_remascarar_responde_sem_o_motor_carregado():
    """
    A rota não pode depender do NER estar de pé.

    É o que separa "reaplicar máscaras" de "reprocessar": tirar um falso
    positivo de uma lista já decidida não é trabalho de modelo nenhum. Se um dia
    alguém trocar o `PresidioEngine.remascarar` estático por
    `get_engine().remascarar`, este teste passa a carregar 2,5 GB de BERT para
    reescrever uma linha — e é aqui que isso aparece.

    Também confere o contrato HTTP, que os testes acima não veem: os spans
    atravessam o Pydantic como `EntityFound` nos dois sentidos.
    """
    import os

    from fastapi.testclient import TestClient

    import server

    texto = "ANA LIMA e BRUNO SÁ assinaram."
    resposta = TestClient(server.app).post(
        "/remascarar",
        headers={"X-Presidio-Token": os.environ["PRESIDIO_TOKEN"]},
        json={
            "text": texto,
            "entities": entidades(texto, em(texto, "BRUNO SÁ", "PERSON")),
            "politica_mascara": "placeholder",
        },
    )

    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["anonymized_text"] == "ANA LIMA e [PESSOA_1] assinaram."


def test_rota_remascarar_recusa_lista_incoerente():
    """400, não 500: o pedido é que está errado, e quem chamou precisa saber."""
    import os

    from fastapi.testclient import TestClient

    import server

    texto = "ANA LIMA assinou."
    resposta = TestClient(server.app).post(
        "/remascarar",
        headers={"X-Presidio-Token": os.environ["PRESIDIO_TOKEN"]},
        json={
            "text": texto,
            "entities": entidades(texto, (0, 8, "PERSON", 0.9), (4, 12, "PERSON", 0.9)),
        },
    )

    assert resposta.status_code == 400
