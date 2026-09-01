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
