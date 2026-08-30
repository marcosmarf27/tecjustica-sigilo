"""
Carrega deny list e palavras de contexto de arquivos JSON externos.
Permite customização sem editar código fonte.
"""

import json
import os
import threading
import unicodedata
from pathlib import Path

_CONFIG_DIR = Path(__file__).parent / "config"
_DENY_LIST_FILE = _CONFIG_DIR / "deny_list.json"
_CONTEXT_FILE = _CONFIG_DIR / "context_words.json"

# Serializa as gravações da deny list.
#
# `save_deny_list` reescreve o arquivo inteiro. Com um cliente só isso nunca
# incomodou, mas a interface e a API local podem gravar ao mesmo tempo, e duas
# reescritas concorrentes se perdem: a última a terminar leva, e o termo que a
# outra acabou de acrescentar some sem erro nenhum.
_LOCK_DENY_LIST = threading.Lock()


def _strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def normalize(text: str) -> str:
    """Normaliza texto para comparação: lowercase + sem acentos + strip."""
    return _strip_accents(text.strip().lower())


def load_deny_list() -> dict[str, set[str]]:
    """
    Retorna dict {entity_type: set(normalized_strings)}.
    Normaliza cada entrada para matching robusto.
    """
    with _DENY_LIST_FILE.open(encoding="utf-8") as f:
        raw = json.load(f)
    return {
        entity: {normalize(term) for term in terms}
        for entity, terms in raw.items()
    }


def load_context_words() -> dict[str, list[str]]:
    """Retorna dict {entity_type: list(context_words)}."""
    with _CONTEXT_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def save_deny_list(deny_list: dict[str, list[str]]) -> None:
    """
    Grava a deny list no disco (usado pelo endpoint de config).

    Duas garantias que a versão anterior não dava:

    - **Serializada** pelo `_LOCK_DENY_LIST`, porque o arquivo é reescrito
      inteiro e duas gravações concorrentes perdiam uma das duas em silêncio.
    - **Atômica**, gravando num temporário e substituindo com `os.replace`. Um
      `write_text` direto que morre no meio deixa um JSON truncado, e um JSON
      truncado derruba a próxima leitura — ou seja, o backend não sobe mais.

    O `newline="\\n"` é explícito de propósito: no Windows, a gravação em modo
    texto troca `\\n` por `\\r\\n`, o que muda os bytes do arquivo sem mudar o
    conteúdo. Aqui não há hash conferido, mas o hábito é o mesmo que o resto do
    projeto segue, e evita que o `deny_list.json` apareça inteiro no diff a cada
    termo acrescentado.
    """
    conteudo = json.dumps(deny_list, ensure_ascii=False, indent=2)
    with _LOCK_DENY_LIST:
        temporario = _DENY_LIST_FILE.with_suffix(".json.tmp")
        with temporario.open("w", encoding="utf-8", newline="\n") as f:
            f.write(conteudo)
        os.replace(temporario, _DENY_LIST_FILE)


def get_raw_deny_list() -> dict[str, list[str]]:
    """Retorna o conteúdo bruto do arquivo (para o endpoint GET /config)."""
    with _DENY_LIST_FILE.open(encoding="utf-8") as f:
        return json.load(f)
