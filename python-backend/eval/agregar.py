"""
Consolida os resultados dos três documentos num quadro único e compara duas
rodadas (antes e depois de uma correção).

Uso:
    python -m eval.agregar eval/baseline_spacy.json eval/depois_spacy.json
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from eval.metrics import limite_inferior_wilson

CAMPOS = [
    ("valores_protegidos", "valores_unicos"),
    ("protegidas_substantivas", "ocorrencias_substantivas"),
]


def somar(caminho: Path) -> dict[str, dict[str, int]]:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    totais: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for doc in dados.values():
        for tipo, m in doc["tipos"].items():
            for num, den in CAMPOS:
                totais[tipo][num] += m[num]
                totais[tipo][den] += m[den]
    return totais


def _pct(num: int, den: int) -> str:
    return f"{num / den:7.2%}" if den else "      —"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    antes = somar(Path(sys.argv[1])) if len(sys.argv) > 2 else None
    depois = somar(Path(sys.argv[-1]))

    print()
    print("Corpus consolidado — três processos, ~1,6 MB de OCR")
    print("=" * 78)
    print(
        f"{'entidade':12} {'proteção por valor':>22} {'recall por ocorrência':>26} {'lim.inf':>9}"
    )
    print("-" * 78)

    tot_vu = tot_vp = tot_ou = tot_op = 0
    for tipo in sorted(depois):
        d = depois[tipo]
        vp, vu = d["valores_protegidos"], d["valores_unicos"]
        op, ou = d["protegidas_substantivas"], d["ocorrencias_substantivas"]
        tot_vp += vp
        tot_vu += vu
        tot_op += op
        tot_ou += ou

        col_valor = f"{_pct(vp, vu)} ({vp:3}/{vu:3})"
        col_ocor = f"{_pct(op, ou)} ({op:4}/{ou:4})"

        if antes and tipo in antes:
            a = antes[tipo]
            col_valor = f"{_pct(a['valores_protegidos'], a['valores_unicos'])} → " + col_valor
            col_ocor = (
                f"{_pct(a['protegidas_substantivas'], a['ocorrencias_substantivas'])} → "
                + col_ocor
            )

        print(
            f"{tipo:12} {col_valor:>22} {col_ocor:>26} "
            f"{limite_inferior_wilson(op, ou):8.2%}"
        )

    print("-" * 78)
    linha_total = f"{'TOTAL':12} {_pct(tot_vp, tot_vu):>7} ({tot_vp}/{tot_vu})"
    print(
        f"{linha_total}   {_pct(tot_op, tot_ou)} ({tot_op}/{tot_ou})   "
        f"lim.inf {limite_inferior_wilson(tot_op, tot_ou):.2%}"
    )
    print()
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    raise SystemExit(main())
