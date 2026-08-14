"""
Corpus de avaliação: documentos reais de processos judiciais, OCRizados.

Os arquivos NÃO ficam no repositório — contêm dados pessoais reais. Este módulo
apenas aponta para eles e registra o hash de cada um, para que um resultado de
avaliação possa ser conferido contra a versão exata do documento que o produziu.

O caminho pode ser sobrescrito com a variável de ambiente PRESIDIO_EVAL_CORPUS.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CORPUS_DIR = Path("/mnt/c/Users/marco/Downloads")

# nome curto → nome do arquivo no diretório do corpus
CORPUS_FILES = {
    "civel_0200161": "9h- 20-082026 -  0200161-20.2024.md",
    "juri_19-08": "Juri  19-08.md",
    "expedientes_13-08": "10h 13-08-2026 expedientes.md",
}

_RE_PAGINA = re.compile(r"^##\s+P[áa]gina\s+(\d+)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Pagina:
    """Uma página do documento, com o offset onde começa no texto completo."""

    numero: int
    start: int
    end: int
    texto: str


@dataclass(frozen=True)
class Documento:
    nome: str
    caminho: Path
    texto: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.texto.encode("utf-8")).hexdigest()

    def paginas(self) -> list[Pagina]:
        """
        Divide o documento em páginas usando o marcador `## Página N`.

        O texto de cada página vai do fim do seu marcador até o início do
        marcador seguinte. Documento sem marcador nenhum vira uma página só.
        """
        marcadores = list(_RE_PAGINA.finditer(self.texto))
        if not marcadores:
            return [Pagina(1, 0, len(self.texto), self.texto)]

        paginas: list[Pagina] = []
        for i, m in enumerate(marcadores):
            start = m.end()
            end = marcadores[i + 1].start() if i + 1 < len(marcadores) else len(self.texto)
            paginas.append(
                Pagina(
                    numero=int(m.group(1)),
                    start=start,
                    end=end,
                    texto=self.texto[start:end],
                )
            )
        return paginas


def corpus_dir() -> Path:
    return Path(os.environ.get("PRESIDIO_EVAL_CORPUS", str(DEFAULT_CORPUS_DIR)))


def carregar(nome: str) -> Documento:
    caminho = corpus_dir() / CORPUS_FILES[nome]
    texto = caminho.read_text(encoding="utf-8", errors="replace")
    return Documento(nome=nome, caminho=caminho, texto=texto)


def carregar_todos() -> list[Documento]:
    return [carregar(nome) for nome in CORPUS_FILES]


def disponivel() -> bool:
    """True se todos os documentos do corpus existem — usado para skip nos testes."""
    return all((corpus_dir() / f).exists() for f in CORPUS_FILES.values())
