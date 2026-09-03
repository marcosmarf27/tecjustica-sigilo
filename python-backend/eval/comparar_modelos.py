"""
Compara dois modelos NER sobre o mesmo corpus de textos extraídos.

Disciplina do guia de anonimização (seção 37): promotor de modelo só com
benchmark cego. O corpus é uma pasta de arquivos `.md`/`.txt` já extraídos —
a extração (com OCR) é independente do modelo e roda uma vez só.

Um processo por modelo, nunca dois BERTs na memória ao mesmo tempo:

    python -m eval.comparar_modelos --modelo novo  --pasta <dir> --saida novo.json
    python -m eval.comparar_modelos --modelo antigo --pasta <dir> --saida antigo.json
    python -m eval.comparar_modelos --relatorio novo.json antigo.json

O JSON guarda TODAS as entidades de cada documento (tipo, texto, posição,
score) para que o relatório possa diferenciar valores únicos de PERSON sem
rodar o motor de novo.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval.run_eval import ENTIDADES_DA_INTERFACE  # noqa: E402

MODELO_ANTIGO = "pierreguillou/ner-bert-large-cased-pt-lenerbr"


def _obter_modelo(nome: str) -> str:
    """Devolve o identificador que o engine deve carregar para este lado do A/B.

    O "antigo" é o modelo anterior, por id de repositório — o Presidio resolve
    e cacheia sozinho. O "novo" é o caminho do engine (revisão pinada por SHA).
    """
    if nome == "novo":
        import engine

        return engine._resolver_modelo_bert()
    if nome == "antigo":
        return MODELO_ANTIGO
    raise ValueError(f"modelo desconhecido: {nome} (use 'novo' ou 'antigo')")


def rodar(pasta: Path, lado: str, saida: Path) -> None:
    import engine

    if lado == "antigo":
        # A/B só: aponta o resolver para o repositório antigo. Nada disso entra
        # no produto — o default do engine segue pinado no SHA do novo modelo.
        engine._resolver_modelo_bert = lambda: MODELO_ANTIGO  # type: ignore[assignment]

    motor = engine.PresidioEngine()
    motor.initialize()
    print(
        f"[ab] lado={lado} modelo_carregado={lado} modo={motor.nlp_mode}",
        flush=True,
    )

    arquivos = sorted(
        p for p in pasta.iterdir() if p.suffix.lower() in {".md", ".txt"}
    )
    if not arquivos:
        print(f"[ab] nenhum .md/.txt em {pasta}", flush=True)
        sys.exit(2)

    docs: list[dict] = []
    for arquivo in arquivos:
        texto = arquivo.read_text(encoding="utf-8", errors="replace")
        t0 = time.time()
        resultado = motor.anonymize(texto, entities=ENTIDADES_DA_INTERFACE)
        tempo = time.time() - t0
        entidades = resultado["entities_found"]
        por_tipo: dict[str, int] = {}
        for e in entidades:
            por_tipo[e["type"]] = por_tipo.get(e["type"], 0) + 1
        docs.append(
            {
                "arquivo": arquivo.name,
                "chars": len(texto),
                "tempo_s": round(tempo, 2),
                "por_tipo": por_tipo,
                "entidades": entidades,
            }
        )
        print(
            f"[ab] {arquivo.name}: {len(texto)} chars, {len(entidades)} entidades, {tempo:.1f}s",
            flush=True,
        )

    payload = {
        "lado": lado,
        "entidades_pedidas": ENTIDADES_DA_INTERFACE,
        "docs": docs,
    }
    saida.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    total_e = sum(len(d["entidades"]) for d in docs)
    total_s = sum(d["tempo_s"] for d in docs)
    print(f"[ab] total: {total_e} entidades em {total_s:.1f}s -> {saida}", flush=True)


def relatorio(caminho_novo: Path, caminho_antigo: Path) -> None:
    novo = json.loads(caminho_novo.read_text(encoding="utf-8"))
    antigo = json.loads(caminho_antigo.read_text(encoding="utf-8"))

    def resumo(payload: dict) -> dict:
        tipos: dict[str, int] = {}
        pessoas: set[str] = set()
        for d in payload["docs"]:
            for tipo, n in d["por_tipo"].items():
                tipos[tipo] = tipos.get(tipo, 0) + n
            for e in d["entidades"]:
                if e["type"] == "PERSON":
                    pessoas.add(e["text"])
        return {
            "tempo_s": round(sum(d["tempo_s"] for d in payload["docs"]), 1),
            "por_tipo": tipos,
            "person_unicos": pessoas,
        }

    r_novo, r_antigo = resumo(novo), resumo(antigo)

    print("\n=== Resumo por tipo ===")
    chaves = sorted(set(r_novo["por_tipo"]) | set(r_antigo["por_tipo"]))
    print(f"{'tipo':22} {'antigo':>8} {'novo':>8}")
    for k in chaves:
        print(f"{k:22} {r_antigo['por_tipo'].get(k, 0):>8} {r_novo['por_tipo'].get(k, 0):>8}")
    print(f"{'tempo total (s)':22} {r_antigo['tempo_s']:>8} {r_novo['tempo_s']:>8}")

    so_antigo = sorted(r_antigo["person_unicos"] - r_novo["person_unicos"])
    so_novo = sorted(r_novo["person_unicos"] - r_antigo["person_unicos"])
    comuns = sorted(r_novo["person_unicos"] & r_antigo["person_unicos"])
    print(f"\n=== PERSON únicos: antigo {len(r_antigo['person_unicos'])} | novo {len(r_novo['person_unicos'])} ===")
    print(f"\n--- só no ANTIGO ({len(so_antigo)}) — o que o novo deixou de tarjar ---")
    for v in so_antigo:
        print(f"  - {v!r}")
    print(f"\n--- só no NOVO ({len(so_novo)}) ---")
    for v in so_novo:
        print(f"  - {v!r}")
    print(f"\n--- em ambos ({len(comuns)}) ---")
    for v in comuns:
        print(f"  - {v!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pasta", help="pasta com os .md/.txt extraídos")
    parser.add_argument("--modelo", choices=["novo", "antigo"])
    parser.add_argument("--saida", help="JSON de saída desta rodada")
    parser.add_argument(
        "--relatorio", nargs=2, metavar=("NOVO_JSON", "ANTIGO_JSON"),
        help="compara duas rodadas prontas e sai",
    )
    args = parser.parse_args()

    if args.relatorio:
        relatorio(Path(args.relatorio[0]), Path(args.relatorio[1]))
        return 0
    if not args.pasta or not args.modelo or not args.saida:
        parser.error("--pasta, --modelo e --saida são obrigatórios sem --relatorio")
        return 2

    rodar(Path(args.pasta), args.modelo, Path(args.saida))
    return 0


if __name__ == "__main__":
    sys.exit(main())
