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
from mask_config import apply_mask
from config_loader import load_deny_list, normalize

_instance: "PresidioEngine | None" = None

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

# Partículas que não contam como palavra significativa de um nome.
_PREPOSICOES = {"de", "da", "do", "das", "dos", "e", "di", "del", "von", "san"}


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

    def anonymize(
        self,
        text: str,
        entities: list[str],
        language: str = "pt",
        progresso: "Callable[[int, int], None] | None" = None,
    ) -> dict:
        """
        Analisa e anonimiza o texto em janelas com sobreposição.

        `progresso`, se informado, é chamado como (janelas_prontas, total) —
        é o que permite à interface mostrar avanço real dentro de um arquivo
        grande, em vez de ficar parada em 0%.

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

        brutos.extend(self._propagar_nomes(text, brutos))
        spans = self._fundir_spans(text, brutos)

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
            "anonymized_text": self._aplicar_mascaras(text, spans),
            "entities_found": entidades,
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
        texto: str, spans: list[tuple[int, int, str, float]]
    ) -> str:
        """Aplica as máscaras de trás para frente, sobre spans já disjuntos."""
        saida = texto
        for ini, fim, tipo, _ in sorted(spans, key=lambda s: s[0], reverse=True):
            saida = saida[:ini] + apply_mask(tipo, texto[ini:fim]) + saida[fim:]
        return saida

    def _apply_deny_list(self, text: str, results: list) -> list:
        """
        Aplica a deny list a cada entidade detectada:
          - match exato (normalizado) → descarta.
          - detecção começa com termo da deny list + espaço → trimma o prefixo
            institucional (ex: 'Ministério Público Dr. FULANO' → 'FULANO').
          - detecção é prefixo de um termo da deny list → descarta.
        """
        out = []
        for r in results:
            terms = self._deny_list.get(r.entity_type, set())
            detected = text[r.start:r.end]
            norm = normalize(detected)

            if norm in terms:
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
