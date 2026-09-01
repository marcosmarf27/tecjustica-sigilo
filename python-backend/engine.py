"""
Engine singleton que inicializa o Presidio AnalyzerEngine com suporte a pt-BR.

O texto é analisado em janelas com sobreposição sobre uma vista sem quebras de
linha (ver `_vista_linear`), e os spans de todas as janelas são fundidos por um
mapa de tipo por caractere. As máscaras são as de `mask_config`, aplicadas
diretamente — o `AnonymizerEngine` do Presidio não as produziria sem operadores
customizados, e por isso não é usado.

NLP backend:
  - PRESIDIO_NLP_MODE=transformer (default): usa pierreguillou/ner-bert-large-cased-pt-lenerbr,
    modelo BERT fine-tuned em jurisprudência brasileira (F1≈0.91 em LeNER-Br).
  - PRESIDIO_NLP_MODE=spacy: fallback para pt_core_news_lg (mais leve,
    qualidade inferior em textos jurídicos).
"""

import os
import re
from typing import Callable

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

from recognizers import criar_recognizers_brasil
from mask_config import POLITICA_PADRAO, Mascarador, apply_mask
from config_loader import load_deny_list, normalize

_instance: "PresidioEngine | None" = None


class CancelamentoSolicitado(RuntimeError):
    """Levantada quando o operador cancela o processamento em andamento."""


class _SpanSimples:
    """Portador de start/end para reaproveitar `_extend_person`, que espera um
    objeto com esses atributos mutáveis (é o formato do RecognizerResult)."""

    __slots__ = ("start", "end")

    def __init__(self, start: int, end: int):
        self.start = start
        self.end = end

# Regex para detectar sequências de 2+ palavras ALL CAPS (prováveis nomes).
# Só é aplicado no modo spacy — o BERT jurídico não precisa desse truque.
_RE_CAPS_SEQUENCE = re.compile(
    r"\b[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]{2,}"
    r"(?:(?:\s+(?:DE|DA|DO|DOS|DAS|E|DI|DEL|VON)\s+|\s+)"
    r"[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]{2,})+"
    r"\b"
)

# Estende PERSON para a direita quando termina antes de preposição + sobrenome.
# Ex: "Danger Pereira" → "Danger Pereira De Araujo".
_RE_NAME_CONTINUATION_RIGHT = re.compile(
    r"\s+(?:DE|DA|DO|DOS|DAS|E|DI|DEL|VON|De|Da|Do|Dos|Das|Di|Del|Von|de|da|do|dos|das|e|di|del|von)\s+"
    r"[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑa-záàâãéèêíïóôõöúçñ]+"
)

# Estende PERSON para a esquerda quando spaCy pegou só o último token.
# Captura "João da " em "João da Silva" quando NER marcou apenas "Silva".
_RE_NAME_CONTINUATION_LEFT = re.compile(
    r"(?:[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ][A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑa-záàâãéèêíïóôõöúçñ]+\s+"
    r"(?:DE|DA|DO|DOS|DAS|E|DI|DEL|VON|De|Da|Do|Dos|Das|Di|Del|Von|de|da|do|dos|das|e|di|del|von)\s+)+$"
)

# Palavras que não podem iniciar um sobrenome — interrompe a extensão à direita.
_STOP_WORDS_NAME_EXT = {
    "audiencia", "audiência", "processo", "pena", "prisao", "prisão",
    "cumprimento", "medida", "direito", "acordo", "termo", "tutela",
    "instancia", "instância", "origem", "defesa", "acusacao", "acusação",
    "sentenca", "sentença",
}

# --- Chunking -------------------------------------------------------------
#
# O texto é analisado em janelas, não linha a linha. Analisar por linha faz o
# OCR desta base vazar sistematicamente: o rótulo "RG:" termina uma linha e o
# número está na seguinte, "(85)" se separa de "99233-2854", "CEP - 60.755-"
# quebra antes do "000", e um nome se parte entre duas colunas do PDF. Isolada,
# cada metade é irreconhecível.
#
# TAMANHO_JANELA é conservador de propósito: o BERT aceita 512 tokens, e OCR
# com blocos de dígitos tokeniza a pouco mais de um caractere por token.
TAMANHO_JANELA = 1200
# O overlap precisa ser maior que a maior entidade esperada. Um período de
# qualificação ("brasileiro, casado, filho de X e Y, nascido em..., portador
# do RG..., residente à Rua...") passa de 200 caracteres.
OVERLAP_JANELA = 300

# Quando dois spans disputam o mesmo trecho, vence o tipo mais específico.
# Efeito desejado em "Rua Antônio José Correia": sai um ENDERECO_BR inteiro,
# em vez de um PERSON costurado com pedaços de LOCATION.
PRIORIDADE_ENTIDADE = [
    "DATE_TIME", "LAW", "CASE_LAW", "ORGANIZATION",
    "DATE_OF_BIRTH", "LOCATION", "PERSON", "ENDERECO_BR", "CEP_BR",
    "EMAIL_ADDRESS", "PHONE_NUMBER", "PHONE_NUMBER_BR", "CONTA_BANCARIA",
    "OAB_BR", "NIT_PIS_PASEP", "RG_BR", "CNPJ_BR", "NUMERO_PROCESSO_CNJ",
    "CPF_BR",
]
_PRIORIDADE = {nome: i + 1 for i, nome in enumerate(PRIORIDADE_ENTIDADE)}

# Tipos que nomeiam instituições, atos e diplomas legais — nunca uma pessoa.
# A deny list pode ser aplicada por contenção neles sem risco de apagar um nome.
_TIPOS_INSTITUCIONAIS = {"ORGANIZATION", "LAW", "CASE_LAW", "LOCATION", "DATE_TIME"}

# Partículas que não contam como palavra significativa de um nome.
_PREPOSICOES = {"de", "da", "do", "das", "dos", "e", "di", "del", "von", "san"}

# --- Instituição não é pessoa -----------------------------------------------
#
# O modelo de linguagem devolve "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ" e
# "DELEGACIA MUNICIPAL DE OCARA" como PERSON — são maiúsculas com estrutura de
# nome próprio, e o NER não distingue. Não é um erro pequeno: num processo, o
# cabeçalho institucional se repete em toda página, e como esses spans entram no
# gazetteer que espalha nomes pelo documento, cada acerto falso vira centenas de
# trechos tarjados. O resultado é um documento ilegível — e um órgão público não
# é dado pessoal de ninguém.
#
# A deny list já resolvia isso para os tipos institucionais, por contenção. Em
# PERSON a contenção é proibida: "ADVOGADO João Silva" contém "advogado", e
# descartar o span exporia o nome. Daí as duas regras abaixo, ambas conservadoras.

# Palavras que nomeiam órgão e jamais aparecem em nome de pessoa. Ficam de fora
# de propósito as que também são sobrenome brasileiro — "Câmara", "Vara",
# "Campos", "Seção" —, porque aí o descarte apagaria gente de verdade.
_NUCLEOS_INSTITUCIONAIS = {
    "ministerio", "delegacia", "promotoria", "procuradoria", "defensoria",
    "corregedoria", "ouvidoria", "judiciario", "tribunal", "secretaria",
    "governo", "prefeitura", "penitenciaria", "presidio", "batalhao",
    "juizado", "comarca", "superintendencia", "coordenadoria", "diretoria",
    "departamento", "autarquia", "policia", "conselho",
    "instituto", "fundacao", "universidade", "faculdade", "gabinete",
    "cartorio", "forum", "nucleo", "destacamento",
    "bombeiros", "cadeia", "republica", "assembleia", "senado",
}

# Vocabulário que aparece em rótulo de formulário, cabeçalho de tabela e
# matéria processual. Um span composto **só** disto não é nome de ninguém.
_PALAVRAS_SEM_NOME = {
    # rótulos e cabeçalhos do sistema processual
    "data", "hora", "movimentacao", "movimentacoes", "classe", "assunto",
    "assuntos", "processo", "numero", "documento", "documentos", "tipo",
    "descricao", "situacao", "status", "codigo", "nome", "parte", "partes",
    "autor", "autora", "reu", "re", "vitima", "testemunha", "advogado",
    "advogada", "informado", "informada", "nao", "sim", "assinado",
    "assinada", "certidao", "certidoes", "protocolo", "anexo", "anexos",
    "fls", "fl", "pagina", "paginas", "total", "valor", "observacao",
    "observacoes", "endereco", "telefone", "email", "cpf", "rg", "oab",
    "orgao", "julgador", "grau", "instancia", "competencia", "distribuicao",
    # atores e atos processuais
    "juiz", "juiza", "promotor", "promotora", "delegado", "delegada",
    "escrivao", "escriva", "oficial", "servidor", "servidora", "diretor",
    "diretora", "secretario", "secretaria", "autoridade", "defensor",
    "defensora", "perito", "perita", "acusado", "acusada", "indiciado",
    "indiciada", "denunciado", "denunciada", "requerente", "requerido",
    "requerida", "declarante", "interrogatorio", "audiencia", "sentenca",
    "decisao", "despacho", "peticao", "mandado", "oficio", "inquerito",
    "flagrante", "prisao", "preventiva", "temporaria", "liberdade",
    "provisoria", "custodia", "citacao", "intimacao", "publicacao",
    # matéria penal e civil que o modelo lê como nome próprio
    "trafico", "drogas", "entorpecentes", "condutas", "afins", "crime",
    "crimes", "homicidio", "roubo", "furto", "receptacao", "lesao",
    "corporal", "ameaca", "estelionato", "violencia", "domestica",
    "familiar", "mulher", "porte", "arma", "fogo", "associacao",
    "criminosa", "penal", "civel", "criminal", "execucao", "pena",
    # adjetivos e substantivos de órgão que também podem ser sobrenome
    # ("Vara", "Campos", "Guarda"): aqui não descartam sozinhos, só deixam de
    # contar como nome — a recusa exige que nada mais reste no trecho.
    "vara", "poder", "justica", "seguranca", "custodia", "regional",
    "policial", "estado", "municipio", "municipal", "federal", "civil",
    "militar", "publico", "publica", "social", "defesa", "geral", "nacional",
    "unica", "uniao", "camara", "seccional", "comarca", "distrital",
    # conectivos que sobram de frase mal segmentada
    "bem", "como", "que", "em", "no", "na", "nos", "nas", "por", "para",
    "com", "sem", "sob", "sobre", "ante", "apos", "ate", "desde", "entre",
    "este", "esta", "esse", "essa", "aquele", "aquela", "seu", "sua",
    "qual", "quais", "onde", "quando", "outros", "outras", "demais",
}

# Unidades da federação: aparecem sozinhas e o modelo as tipa como pessoa.
_UNIDADES_FEDERACAO = {
    "acre", "alagoas", "amapa", "amazonas", "bahia", "ceara", "distrito federal",
    "espirito santo", "goias", "maranhao", "mato grosso", "mato grosso do sul",
    "minas gerais", "para", "paraiba", "parana", "pernambuco", "piaui",
    "rio de janeiro", "rio grande do norte", "rio grande do sul", "rondonia",
    "roraima", "santa catarina", "sao paulo", "sergipe", "tocantins", "brasil",
}


def _recortar_nome(texto: str) -> tuple[int, int] | None:
    """
    Onde, dentro do trecho, começa e termina o que pode ser nome de pessoa.

    Devolve `None` quando não há nome ali. Recortar em vez de recusar o trecho
    inteiro é o ponto crítico desta função: o modelo costuma marcar órgão e
    pessoa num span só — "MINISTÉRIO PÚBLICO DO ESTADO DO CEARÁ, por seu
    promotor FULANO DE TAL". Descartar esse span limparia o cabeçalho e
    **exporia o promotor**, trocando excesso de máscara por vazamento. A
    primeira versão desta limpeza fazia exatamente isso, e o harness mediu: oito
    nomes reais desprotegidos num único documento.

    Então o trecho é varrido palavra a palavra, o vocabulário de órgão e de
    formulário é descartado, e o que fica é o maior bloco contíguo de palavras
    que ainda podem nomear alguém.
    """
    palavras = [(m.group(0), m.start(), m.end()) for m in re.finditer(r"[\wÀ-ÿ]+", texto)]
    if not palavras:
        return None

    normalizadas = [normalize(p[0]) for p in palavras]
    if " ".join(normalizadas) in _UNIDADES_FEDERACAO:
        return None

    tinha_orgao = any(n in _NUCLEOS_INSTITUCIONAIS for n in normalizadas)

    def e_nome(indice: int) -> bool:
        """A palavra sustenta um nome por si só."""
        n = normalizadas[indice]
        if n in _NUCLEOS_INSTITUCIONAIS or n in _UNIDADES_FEDERACAO:
            return False
        if n in _PALAVRAS_SEM_NOME or n in _PREPOSICOES:
            return False
        return len(n) > 1

    def atravessa(indice: int) -> bool:
        """
        A palavra não sustenta um nome, mas também não o interrompe.

        "Vara", "Câmara", "Campos" e "Guarda" nomeiam repartição *e* são
        sobrenome corrente; "de", "da", "dos" ligam nome e sobrenome. Se
        qualquer uma delas cortasse o bloco, "Pedro Vara Lima" viraria "Pedro"
        e o resto do nome ficaria exposto — vazamento, não excesso. Só o núcleo
        de órgão interrompe de fato.
        """
        n = normalizadas[indice]
        return n not in _NUCLEOS_INSTITUCIONAIS and n not in _UNIDADES_FEDERACAO

    # Maior bloco contíguo aproveitável. As bordas são aparadas até cair numa
    # palavra que sustenta nome, então "ASSINADO POR FULANO" rende "FULANO".
    melhor: tuple[int, int] | None = None
    atual: list[int] = []

    def fechar() -> None:
        nonlocal melhor
        bloco = list(atual)
        while bloco and not e_nome(bloco[0]):
            bloco.pop(0)
        while bloco and not e_nome(bloco[-1]):
            bloco.pop()
        significativas = [i for i in bloco if e_nome(i)]
        if not significativas:
            return
        # Num trecho que mistura órgão e pessoa, exigir nome e sobrenome evita
        # que sobras como "Social" ou "Regional" virem nome. Onde não há órgão
        # nenhum, uma palavra basta — nomes isolados existem no documento.
        if tinha_orgao and len(significativas) < 2:
            return
        candidato = (palavras[bloco[0]][1], palavras[bloco[-1]][2])
        if melhor is None or (candidato[1] - candidato[0]) > (melhor[1] - melhor[0]):
            melhor = candidato

    for i in range(len(palavras)):
        if atravessa(i):
            atual.append(i)
        else:
            fechar()
            atual = []
    fechar()

    return melhor


def _sem_instituicoes(
    texto: str, brutos: list[tuple[int, int, str, float]]
) -> list[tuple[int, int, str, float]]:
    """
    Reduz cada PERSON ao que nele nomeia gente; descarta o que não nomeia.

    Roda **antes** da propagação de nomes, e a ordem é o ponto: o gazetteer usa
    cada PERSON confirmado como semente para varrer o documento inteiro. Filtrar
    só no fim corrigiria a ocorrência original e deixaria de pé as centenas que
    ela gerou.
    """
    saida: list[tuple[int, int, str, float]] = []
    for ini, fim, tipo, score in brutos:
        if tipo != "PERSON":
            saida.append((ini, fim, tipo, score))
            continue
        recorte = _recortar_nome(texto[ini:fim])
        if recorte is None:
            continue
        saida.append((ini + recorte[0], ini + recorte[1], tipo, score))
    return saida


def _vista_linear(texto: str) -> str:
    """
    Troca quebras de linha e tabulações por espaço, preservando o comprimento.

    Preservar o comprimento é o que permite usar os offsets desta vista
    diretamente no texto original, sem tabela de tradução. Qualquer
    transformação que mude o tamanho (remover hífen de fim de linha, normalizar
    Unicode, colapsar espaços) desalinharia todos os spans — e o sintoma seria
    máscara no lugar errado, não uma exceção.
    """
    return texto.replace("\n", " ").replace("\r", " ").replace("\t", " ")


def _janelas(texto: str, tamanho: int, overlap: int) -> list[tuple[int, int]]:
    """
    Divide o texto em janelas com sobreposição, cortando sempre em fim de
    linha para não partir uma entidade ao meio.
    """
    if len(texto) <= tamanho:
        return [(0, len(texto))]

    limites: list[tuple[int, int]] = []
    inicio = 0
    while inicio < len(texto):
        fim = min(inicio + tamanho, len(texto))
        if fim < len(texto):
            quebra = texto.rfind("\n", inicio + tamanho - overlap, fim)
            if quebra > inicio:
                fim = quebra + 1
        limites.append((inicio, fim))
        if fim >= len(texto):
            break
        inicio = max(inicio + 1, fim - overlap)
    return limites


def _spacy_config() -> dict:
    return {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "pt", "model_name": "pt_core_news_lg"}],
    }


def _transformer_config() -> dict:
    return {
        "nlp_engine_name": "transformers",
        "models": [
            {
                "lang_code": "pt",
                "model_name": {
                    "spacy": "pt_core_news_lg",
                    "transformers": "pierreguillou/ner-bert-large-cased-pt-lenerbr",
                },
            }
        ],
        "ner_model_configuration": {
            "labels_to_ignore": ["O"],
            "aggregation_strategy": "max",
            "alignment_mode": "expand",
            "model_to_presidio_entity_mapping": {
                "PESSOA": "PERSON",
                "PER": "PERSON",
                "ORGANIZACAO": "ORGANIZATION",
                "ORG": "ORGANIZATION",
                "LOCAL": "LOCATION",
                "LOC": "LOCATION",
                "TEMPO": "DATE_TIME",
                "TIME": "DATE_TIME",
                "LEGISLACAO": "LAW",
                "JURISPRUDENCIA": "CASE_LAW",
            },
            "low_confidence_score_multiplier": 0.4,
            "low_score_entity_names": ["ORGANIZATION", "ORG"],
        },
    }


class PresidioEngine:
    def __init__(self):
        self._analyzer: AnalyzerEngine | None = None
        self._ready = False
        self._nlp_mode = os.environ.get("PRESIDIO_NLP_MODE", "transformer").lower()
        self._modo_solicitado = self._nlp_mode
        self._motivo_fallback: str | None = None
        self._deny_list: dict[str, set[str]] = {}

    @property
    def nlp_mode(self) -> str:
        return self._nlp_mode

    @property
    def modo_solicitado(self) -> str:
        """O modo pedido por configuração, que pode não ser o que está rodando."""
        return self._modo_solicitado

    @property
    def motivo_fallback(self) -> str | None:
        """Por que o modo pedido não pôde ser usado, se foi o caso."""
        return self._motivo_fallback

    def initialize(self):
        """Carrega modelo NLP e inicializa os engines. Chamado uma vez."""
        if self._ready:
            return

        nlp_engine = None
        self._motivo_fallback = None

        if self._nlp_mode == "transformer":
            # Checar `import transformers` não basta e dá falso positivo: o
            # Presidio só registra o motor "transformers" quando o pacote
            # `spacy-huggingface-pipelines` está instalado. Sem ele, tudo parece
            # certo até a criação do engine falhar — e o app passa a rodar em
            # spaCy sem ninguém perceber, com qualidade bem inferior.
            try:
                from presidio_analyzer.nlp_engine import NlpEngineProvider as _P

                disponiveis = list(_P().nlp_engines)
                if "transformers" not in disponiveis:
                    raise RuntimeError(
                        "o motor 'transformers' não está registrado no Presidio — "
                        "falta o pacote spacy-huggingface-pipelines "
                        f"(motores disponíveis: {', '.join(disponiveis)})"
                    )

                provider = NlpEngineProvider(nlp_configuration=_transformer_config())
                nlp_engine = provider.create_engine()
            except Exception as exc:
                self._motivo_fallback = str(exc)
                print(
                    f"[engine] AVISO: o modo BERT não pôde ser carregado — {exc}. "
                    "Rodando com spaCy, que detecta menos entidades em texto "
                    "jurídico. Instale as dependências do modo transformer para "
                    "usar o modelo completo.",
                    flush=True,
                )
                self._nlp_mode = "spacy"

        if nlp_engine is None:
            provider = NlpEngineProvider(nlp_configuration=_spacy_config())
            nlp_engine = provider.create_engine()

        registry = RecognizerRegistry(supported_languages=["pt"])
        registry.load_predefined_recognizers(
            nlp_engine=nlp_engine, languages=["pt"]
        )
        for recognizer in criar_recognizers_brasil():
            registry.add_recognizer(recognizer)

        self._analyzer = AnalyzerEngine(
            registry=registry,
            nlp_engine=nlp_engine,
            supported_languages=["pt"],
        )
        self._deny_list = load_deny_list()
        self._ready = True

    def reload_deny_list(self) -> None:
        """Recarrega a deny list do disco (usado pelo endpoint /config)."""
        self._deny_list = load_deny_list()

    def is_ready(self) -> bool:
        return self._ready

    def entidades_suportadas(self) -> list[str]:
        """
        Os tipos que este motor sabe detectar, perguntados ao próprio analyzer.

        Existe para `GET /v1/info`: um cliente externo precisa saber o que pedir
        em `entidades` sem ter de adivinhar nem manter uma cópia da lista. Vem
        do registro de recognizers, e não de uma constante escrita à mão, porque
        uma cópia à mão envelhece em silêncio — foi exatamente o que aconteceu
        com as cores de entidade, que existiam em dois lugares e divergiram.

        Devolve vazio com o motor ainda subindo, e não levanta: `/v1/info` é a
        rota que o cliente chama justamente para descobrir se dá para trabalhar.
        """
        if not self._ready or self._analyzer is None:
            return []
        try:
            return sorted(set(self._analyzer.get_supported_entities(language="pt")))
        except Exception:
            return []

    def anonymize(
        self,
        text: str,
        entities: list[str],
        language: str = "pt",
        progresso: "Callable[[int, int], None] | None" = None,
        politica_mascara: str = POLITICA_PADRAO,
        cancelado: "Callable[[], bool] | None" = None,
    ) -> dict:
        """
        Analisa e anonimiza o texto em janelas com sobreposição.

        `progresso`, se informado, é chamado como (janelas_prontas, total) —
        é o que permite à interface mostrar avanço real dentro de um arquivo
        grande, em vez de ficar parada em 0%.

        `cancelado` é consultado entre as janelas: quando devolve True, o
        trabalho para de verdade, em vez de a interface apenas desistir de
        esperar enquanto o processo segue ocupando a máquina.

        `politica_mascara` escolhe entre placeholder numerado, máscara parcial
        e cobertura total — ver `mask_config`.

        Retorna dict com:
          - anonymized_text: texto com PII mascarado
          - entities_found: lista de entidades detectadas, em offsets do
            texto original
        """
        if not self._ready or self._analyzer is None:
            raise RuntimeError("Engine não inicializado. Chame initialize() primeiro.")

        # Vista linear: mesmo comprimento, sem quebras de linha. É sobre ela
        # que tudo é analisado, para que uma entidade partida entre duas linhas
        # pelo OCR volte a ser contígua.
        vista = _vista_linear(text)
        assert len(vista) == len(text), "a vista precisa preservar o comprimento"

        # No modo spaCy, ALL CAPS vira Title Case para o NER reconhecer nomes.
        # `str.title()` preserva o comprimento, então os offsets seguem válidos.
        if self._nlp_mode == "spacy":
            vista = _RE_CAPS_SEQUENCE.sub(lambda m: m.group(0).title(), vista)
            assert len(vista) == len(text), "o pré-processo mudou o comprimento"

        limites = _janelas(vista, TAMANHO_JANELA, OVERLAP_JANELA)
        brutos: list[tuple[int, int, str, float]] = []

        for i, (inicio, fim) in enumerate(limites):
            if cancelado is not None and cancelado():
                raise CancelamentoSolicitado(
                    f"cancelado após {i} de {len(limites)} blocos"
                )
            trecho = vista[inicio:fim]
            if not trecho.strip():
                if progresso:
                    progresso(i + 1, len(limites))
                continue

            resultados = self._analyzer.analyze(
                text=trecho,
                language=language,
                entities=entities if entities else None,
                score_threshold=0.35,
            )

            if entities:
                resultados = [r for r in resultados if r.entity_type in entities]

            for r in resultados:
                r.start += inicio
                r.end += inicio

            for r in resultados:
                if r.entity_type == "PERSON":
                    self._extend_person(vista, r)

            for r in self._apply_deny_list(vista, resultados):
                ajustado = self._aparar(vista, r.start, r.end)
                if ajustado is None:
                    continue
                inicio_ap, fim_ap = ajustado
                brutos.append((inicio_ap, fim_ap, r.entity_type, r.score))

            if progresso:
                progresso(i + 1, len(limites))

        # Instituição sai antes de propagar: um "MINISTÉRIO PÚBLICO" aceito
        # aqui viraria semente do gazetteer e se multiplicaria pelo documento.
        brutos = _sem_instituicoes(vista, brutos)

        propagados = self._propagar_nomes(text, brutos)

        # Os nomes propagados também precisam ser estendidos e aparados: se o
        # modelo só reconheceu "ELIONEUDO EVARISTO", a propagação repete esse
        # pedaço pelo documento e o sobrenome continuaria exposto em toda
        # ocorrência. A extensão por preposição alcança "DE ABREU".
        estendidos: list[tuple[int, int, str, float]] = []
        for ini, fim, tipo, score in propagados:
            marcador = _SpanSimples(ini, fim)
            self._extend_person(vista, marcador)
            ajustado = self._aparar(vista, marcador.start, marcador.end)
            if ajustado is None:
                continue
            estendidos.append((ajustado[0], ajustado[1], tipo, score))

        # Segunda passagem do mesmo filtro: `_extend_person` avança por
        # preposições e pode encostar o span numa palavra de órgão vizinha,
        # remontando um trecho institucional a partir de semente legítima.
        brutos.extend(_sem_instituicoes(vista, estendidos))
        spans = self._fundir_spans(text, brutos)
        mascarador = Mascarador(politica_mascara)

        entidades = [
            {
                "type": tipo,
                "text": text[ini:fim],
                "start": ini,
                "end": fim,
                "score": round(score, 2),
            }
            for ini, fim, tipo, score in spans
        ]

        return {
            "anonymized_text": self._aplicar_mascaras(text, spans, mascarador),
            "entities_found": entidades,
            "politica_mascara": politica_mascara,
            "valores_distintos": mascarador.resumo(),
        }

    @staticmethod
    def remascarar(
        text: str,
        entidades: list[dict],
        politica_mascara: str = POLITICA_PADRAO,
    ) -> dict:
        """
        Reaplica as máscaras a partir de uma lista de ocorrências já decidida.

        É estático de propósito: não toca o analisador, então funciona com o
        motor ainda subindo ou fora do ar. Tirar um falso positivo de uma lista
        já decidida não é trabalho de NLP.

        Não detecta nada: recebe os spans prontos e só reescreve o texto. Existe
        porque a revisão precisa desfazer uma detecção **naquele documento,
        agora** — o usuário aponta um falso positivo e espera vê-lo sair da
        lista, não ler que o efeito vem no próximo processamento.

        Reprocessar seria a resposta óbvia e custaria minutos por documento para
        chegar ao mesmo texto: a decisão de quem é entidade já foi tomada, e o
        que muda é um item da lista.

        A numeração é recalculada do zero, e tem de ser: os placeholders são
        numerados por ordem de leitura, então tirar a terceira pessoa do
        documento renumera a quarta. Deixar buraco na sequência quebraria a
        conferência que a conversa faz sobre o texto (`pseudonimos.conferir`).
        """
        spans = sorted(
            (
                (
                    int(e["start"]),
                    int(e["end"]),
                    str(e["type"]),
                    float(e.get("score", 1.0)),
                )
                for e in entidades
            ),
            key=lambda s: s[0],
        )

        # `_aplicar_mascaras` exige spans disjuntos: sobrepostos, a substituição
        # de trás para frente corrompe o texto em silêncio. Quem chama monta a
        # lista tirando itens de uma que já era disjunta — mas isso é premissa
        # sobre o chamador, e premissa sobre chamador é o que se confere aqui.
        anterior = 0
        for ini, fim, _, _ in spans:
            if fim <= ini or ini < anterior or fim > len(text):
                raise ValueError(
                    "as ocorrências precisam ser disjuntas e caber no texto"
                )
            anterior = fim

        # A geometria pode estar certa e apontar para o lugar errado: um span
        # dentro dos limites cujo `text` declarado não é o que está ali mascara
        # outro trecho e deixa o valor de verdade em claro. `entities_found`
        # sempre carrega `text == text[start:end]` (é assim que o motor o
        # monta), então divergência é pedido corrompido, não caso legítimo. A
        # mensagem não repete o valor: erro que ecoa o dado é vazamento.
        for e in entidades:
            declarado = e.get("text")
            if declarado is not None and text[int(e["start"]) : int(e["end"])] != declarado:
                raise ValueError(
                    "uma ocorrência declara um texto diferente do que há em "
                    f"start/end (tipo {e.get('type')})"
                )

        mascarador = Mascarador(politica_mascara)
        return {
            "anonymized_text": PresidioEngine._aplicar_mascaras(text, spans, mascarador),
            "entities_found": [
                {
                    "type": tipo,
                    "text": text[ini:fim],
                    "start": ini,
                    "end": fim,
                    "score": round(score, 2),
                }
                for ini, fim, tipo, score in spans
            ],
            "politica_mascara": politica_mascara,
            "valores_distintos": mascarador.resumo(),
        }

    @staticmethod
    def _propagar_nomes(
        texto: str, brutos: list[tuple[int, int, str, float]]
    ) -> list[tuple[int, int, str, float]]:
        """
        Segunda passada: reencontra, no documento inteiro, os nomes já
        detectados em algum ponto.

        O OCR desta base parte nomes entre linhas e colunas — "ELIONEUDO
        EVARISTO" fica numa linha e "DE ABREU" na seguinte, com indentação
        arbitrária no meio. O NER reconhece o nome onde ele está inteiro e
        perde onde está partido. Aqui o nome reconhecido vira busca: cada parte
        contígua de duas ou mais palavras é procurada com espaçamento flexível,
        e `\\s+` casa também a quebra de linha.

        Regra que evita catástrofe: nunca menos de duas palavras significativas.
        Propagar um sobrenome isolado ("SILVA", "SANTOS") mascararia meio
        documento, incluindo topônimos e expressões correntes.
        """
        nomes: set[str] = set()
        for ini, fim, tipo, score in brutos:
            if tipo != "PERSON" or score < 0.4:
                continue
            bruto = " ".join(texto[ini:fim].split())
            tokens = bruto.split()
            significativos = [
                t for t in tokens if normalize(t) not in _PREPOSICOES and len(t) > 1
            ]
            if len(significativos) >= 2 and len(bruto) >= 6:
                nomes.add(bruto)

        # Blocos contíguos de 2+ palavras: cobre o caso em que só o pedaço
        # final ("AFONSO DOS SANTOS") aparece numa dada ocorrência.
        variantes: set[str] = set()
        for nome in nomes:
            tokens = nome.split()
            for i in range(len(tokens)):
                for j in range(i + 2, len(tokens) + 1):
                    bloco = tokens[i:j]
                    if bloco[0].lower() in _PREPOSICOES or bloco[-1].lower() in _PREPOSICOES:
                        continue
                    significativos = [
                        t for t in bloco if normalize(t) not in _PREPOSICOES and len(t) > 1
                    ]
                    if len(significativos) >= 2:
                        variantes.add(" ".join(bloco))

        if not variantes:
            return []

        # Uma única alternância varre o documento uma vez só. Uma regex por
        # variante custaria uma varredura de todo o texto por nome, o que num
        # processo de 1 MB com dezenas de partes fica proibitivo.
        #
        # A ordenação por comprimento decrescente faz a alternância preferir o
        # nome completo ao pedaço: em regex, o primeiro ramo que casa vence.
        alternativas = []
        for variante in sorted(variantes, key=lambda v: (-len(v), v)):
            partes = [re.escape(t) for t in variante.split()]
            # Teto no espaçamento: sem ele, o padrão poderia colar duas colunas
            # distantes do PDF que só por acaso têm as palavras certas.
            alternativas.append(r"\s{1,40}".join(partes))

        try:
            combinada = re.compile("|".join(alternativas), re.IGNORECASE)
        except re.error:
            return []

        return [
            (m.start(), m.end(), "PERSON", 0.6)
            for m in combinada.finditer(texto)
        ]

    @staticmethod
    def _aparar(texto: str, start: int, end: int) -> tuple[int, int] | None:
        """Remove pontuação das bordas do span; devolve None se sobrar lixo."""
        while start < end and not (texto[start].isalpha() or texto[start].isdigit()):
            start += 1
        while end > start and not (texto[end - 1].isalpha() or texto[end - 1].isdigit()):
            end -= 1
        if end - start < 2:
            return None
        return start, end

    @staticmethod
    def _fundir_spans(
        texto: str, brutos: list[tuple[int, int, str, float]]
    ) -> list[tuple[int, int, str, float]]:
        """
        Funde os spans de todas as janelas num conjunto sem sobreposição.

        Usa um mapa de tipo por caractere: cada span pinta seu intervalo, e os
        de maior prioridade pintam por cima. Isso resolve num passo só a
        duplicação entre janelas sobrepostas, o conflito de tipos e as
        sobreposições parciais — que, aplicadas como substituições sucessivas,
        corromperiam o texto.

        Os runs resultantes são quebrados em cada `\\n`: uma máscara não pode
        atravessar a quebra de linha, senão destrói a estrutura do documento
        (as funções de máscara normalizam espaço e comeriam o `\\n`).
        """
        if not brutos:
            return []

        tipos: dict[int, str] = {}
        melhor_score: dict[str, float] = {}
        mapa = bytearray(len(texto))

        for ini, fim, tipo, score in sorted(
            brutos, key=lambda b: _PRIORIDADE.get(b[2], 0)
        ):
            codigo = _PRIORIDADE.get(tipo, 0) or (len(_PRIORIDADE) + 1)
            codigo = min(codigo, 255)
            tipos[codigo] = tipo
            melhor_score[tipo] = max(melhor_score.get(tipo, 0.0), score)
            ini = max(0, ini)
            fim = min(len(texto), fim)
            if fim > ini:
                mapa[ini:fim] = bytes([codigo]) * (fim - ini)

        spans: list[tuple[int, int, str, float]] = []
        pos = 0
        while pos < len(mapa):
            codigo = mapa[pos]
            if codigo == 0:
                pos += 1
                continue
            fim = pos
            while fim < len(mapa) and mapa[fim] == codigo and texto[fim] != "\n":
                fim += 1
            tipo = tipos[codigo]
            if fim > pos:
                spans.append((pos, fim, tipo, melhor_score.get(tipo, 0.0)))
            pos = max(fim, pos + 1)

        return spans

    @staticmethod
    def _aplicar_mascaras(
        texto: str,
        spans: list[tuple[int, int, str, float]],
        mascarador: Mascarador,
    ) -> str:
        """
        Aplica as máscaras sobre spans já disjuntos.

        A numeração dos placeholders precisa seguir a ordem de leitura, então a
        atribuição dos números é feita da esquerda para a direita; a
        substituição no texto é que vai de trás para frente, para não deslocar
        as posições ainda não aplicadas.
        """
        ordenados = sorted(spans, key=lambda s: s[0])
        mascaras = [
            (ini, fim, mascarador.mascarar(tipo, texto[ini:fim]))
            for ini, fim, tipo, _ in ordenados
        ]

        saida = texto
        for ini, fim, mascara in reversed(mascaras):
            saida = saida[:ini] + mascara + saida[fim:]
        return saida

    def _apply_deny_list(self, text: str, results: list) -> list:
        """
        Aplica a deny list a cada entidade detectada:
          - match exato (normalizado) → descarta.
          - detecção começa com termo da deny list + espaço → trimma o prefixo
            institucional (ex: 'Ministério Público Dr. FULANO' → 'FULANO').
          - detecção é prefixo de um termo da deny list → descarta.
        """
        # A chave "*" vale para qualquer tipo. Sem ela, a lista precisaria
        # repetir cada termo em todo tipo que o modelo possa atribuir — e o
        # modelo muda de opinião: "VARA CRIMINAL" sai como LOCATION no modo
        # leve e como ORGANIZATION no BERT, "Código de Processo Penal" sai como
        # LAW. Um termo institucional não é dado pessoal em tipo nenhum.
        globais = self._deny_list.get("*", set())

        out = []
        for r in results:
            terms = self._deny_list.get(r.entity_type, set()) | globais
            detected = text[r.start:r.end]
            norm = normalize(detected)

            if norm in terms:
                continue

            # O modelo costuma marcar o bloco inteiro em volta do termo:
            # "2ª VARA CRIMINAL DA COMARCA DE FORTALEZA", "Código de Processo
            # Penal, artigo 41". Comparar por igualdade deixa tudo isso passar.
            #
            # Para tipos institucionais, conter um termo da lista basta para
            # descartar — nenhum deles carrega nome de pessoa dentro. PERSON
            # fica de fora desta regra de propósito: ali o span pode ser
            # "Ministério Público Dr. FULANO", e descartar apagaria o nome em
            # vez de revelá-lo (é o que o trim de prefixo abaixo resolve).
            if r.entity_type in _TIPOS_INSTITUCIONAIS and any(
                termo and termo in norm for termo in terms
            ):
                continue

            # Prefixo institucional: trimma e mantém só a cauda (ex.: nome real)
            trimmed = False
            for term in terms:
                if not term:
                    continue
                if norm.startswith(term + " "):
                    words_in_term = len(term.split())
                    detected_words = detected.split()
                    if len(detected_words) <= words_in_term:
                        continue
                    tail = " ".join(detected_words[words_in_term:])
                    tail_start_in_detected = detected.find(tail)
                    if tail_start_in_detected > 0:
                        r.start += tail_start_in_detected
                        trimmed = True
                        break

            if trimmed:
                new_detected = text[r.start:r.end]
                if normalize(new_detected) in terms or len(new_detected.strip()) <= 1:
                    continue
                out.append(r)
                continue

            out.append(r)
        return out

    def _extend_person(self, text: str, r) -> None:
        """Estende PERSON à direita e à esquerda para capturar sobrenomes."""
        # Direita: "Danger Pereira" → "Danger Pereira De Araujo"
        remaining = text[r.end:]
        m = _RE_NAME_CONTINUATION_RIGHT.match(remaining)
        while m:
            added = m.group(0)
            # Interrompe se a palavra seguinte for stop-word (ex.: "de audiência")
            next_word = added.strip().split()[-1]
            if normalize(next_word) in _STOP_WORDS_NAME_EXT:
                break
            r.end += m.end()
            remaining = text[r.end:]
            m = _RE_NAME_CONTINUATION_RIGHT.match(remaining)

        # Esquerda: "Silva" com "João da " antes → "João da Silva"
        prefix_region = text[:r.start]
        m_left = _RE_NAME_CONTINUATION_LEFT.search(prefix_region)
        if m_left:
            r.start = m_left.start()

    def _apply_masks_individually(
        self, text: str, results: list
    ) -> str:
        """
        Aplica masks individualmente para cada ocorrência,
        processando de trás para frente para manter as posições corretas.
        """
        sorted_results = sorted(results, key=lambda r: r.start, reverse=True)

        masked_text = text
        for r in sorted_results:
            original = text[r.start:r.end]
            masked = apply_mask(r.entity_type, original)
            masked_text = masked_text[:r.start] + masked + masked_text[r.end:]

        return masked_text


def get_engine() -> PresidioEngine:
    """Retorna a instância singleton do engine."""
    global _instance
    if _instance is None:
        _instance = PresidioEngine()
    return _instance
