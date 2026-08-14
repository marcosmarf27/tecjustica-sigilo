"""
Roda o motor sobre o corpus real e publica as três métricas de acurácia.

Uso:
    python -m eval.run_eval                    # corpus inteiro, modo do engine
    python -m eval.run_eval --paginas 40       # amostra rápida, para iterar
    python -m eval.run_eval --doc juri_19-08
    PRESIDIO_NLP_MODE=spacy python -m eval.run_eval

O resultado sai em tabela no terminal e, com --json, num arquivo para comparar
rodadas (antes/depois de uma correção).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval import corpus, gold, metrics  # noqa: E402
from eval.metrics import Deteccao  # noqa: E402

# Espelha `ALL_ENTITIES` de src/types/index.ts — a lista que a interface envia
# em toda requisição. Se as duas divergirem, a medição deixa de descrever o
# comportamento real do aplicativo.
ENTIDADES_DA_INTERFACE = [
    "PERSON",
    "CPF_BR",
    "CNPJ_BR",
    "RG_BR",
    "PHONE_NUMBER_BR",
    "EMAIL_ADDRESS",
    "ENDERECO_BR",
    "CEP_BR",
    "LOCATION",
    "OAB_BR",
    "DATE_OF_BIRTH",
    "NIT_PIS_PASEP",
    "NUMERO_PROCESSO_CNJ",
    "CONTA_BANCARIA",
]


def _texto_amostrado(doc: corpus.Documento, n_paginas: int | None) -> str:
    """Recorta as N primeiras páginas, preservando os offsets desde o início."""
    if not n_paginas:
        return doc.texto
    paginas = doc.paginas()
    if n_paginas >= len(paginas):
        return doc.texto
    return doc.texto[: paginas[n_paginas - 1].end]


def _formatar_pct(valor: float) -> str:
    if valor != valor:  # NaN
        return "    —"
    return f"{valor:6.2%}"


def relatorio(resultados: dict[str, metrics.ResultadoTipo], titulo: str) -> None:
    print()
    print(f"── {titulo} ".ljust(96, "─"))
    print(
        f"{'tipo':12} {'B: valor único':>16} {'A: ocorrência':>16} "
        f"{'C: boilerplate':>16}  {'lim.inf 95%':>12}  vazamentos"
    )
    for tipo in sorted(resultados):
        r = resultados[tipo]
        lim = metrics.limite_inferior_wilson(
            r.protegidas_substantivas, r.ocorrencias_substantivas
        )
        print(
            f"{tipo:12} "
            f"{_formatar_pct(r.protecao_valor)} ({r.valores_protegidos:3}/{r.valores_unicos:3}) "
            f"{_formatar_pct(r.recall_ocorrencia)} ({r.protegidas_substantivas:4}/{r.ocorrencias_substantivas:4}) "
            f"{_formatar_pct(r.recall_boilerplate)} "
            f"{_formatar_pct(lim)}  {len(r.vazamentos)}"
        )


def inventario_vazamentos(
    texto: str, resultados: dict[str, metrics.ResultadoTipo], limite: int = 12
) -> None:
    """Lista os vazamentos com o trecho literal — é o que permite corrigir."""
    print()
    print("── Inventário de vazamentos (amostra) ".ljust(96, "─"))
    for tipo in sorted(resultados):
        vaz = resultados[tipo].vazamentos
        if not vaz:
            continue
        print(f"\n  {tipo} — {len(vaz)} ocorrência(s) não mascarada(s):")
        for item in vaz[:limite]:
            linha_inicio = texto.rfind("\n", 0, item.start) + 1
            linha_fim = texto.find("\n", item.end)
            if linha_fim == -1:
                linha_fim = len(texto)
            contexto = " ".join(texto[linha_inicio:linha_fim].split())[:110]
            print(f"    · {texto[item.start:item.end]!r}")
            print(f"      linha: {contexto}")
        if len(vaz) > limite:
            print(f"    … e mais {len(vaz) - limite}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--doc", help="nome curto do documento; padrão: todos")
    parser.add_argument("--paginas", type=int, help="processa só as N primeiras páginas")
    parser.add_argument("--json", type=Path, help="grava o resultado para comparação")
    parser.add_argument(
        "--todas-entidades",
        action="store_true",
        help="analisa tudo, inclusive tipos que a interface nunca ativa",
    )
    args = parser.parse_args()

    if not corpus.disponivel():
        print(f"Corpus não encontrado em {corpus.corpus_dir()}", file=sys.stderr)
        return 2

    from engine import get_engine  # import tardio: carrega o modelo NLP

    engine = get_engine()
    print(f"Carregando motor (modo={engine.nlp_mode})…", flush=True)
    t0 = time.time()
    engine.initialize()
    print(f"Motor pronto em {time.time() - t0:.1f}s — modo efetivo: {engine.nlp_mode}")

    # Por padrão mede exatamente o que a interface pede. Medir com
    # `entities=[]` creditaria detecções de tipos que a GUI nunca ativa (o
    # PHONE_NUMBER genérico do Presidio, por exemplo) e o número deixaria de
    # descrever o produto que o usuário roda.
    entidades_medidas = [] if args.todas_entidades else ENTIDADES_DA_INTERFACE
    print(
        "Entidades medidas: "
        + ("todas as suportadas" if args.todas_entidades else f"{len(entidades_medidas)} da interface")
    )

    docs = [corpus.carregar(args.doc)] if args.doc else corpus.carregar_todos()
    saida: dict[str, dict] = {}

    for doc in docs:
        texto = _texto_amostrado(doc, args.paginas)
        gabarito = [i for i in gold.construir(doc) if i.end <= len(texto)]

        t0 = time.time()
        resultado = engine.anonymize(text=texto, entities=entidades_medidas)
        duracao = time.time() - t0

        deteccoes = [
            Deteccao(tipo=e["type"], start=e["start"], end=e["end"])
            for e in resultado["entities_found"]
        ]

        resultados = metrics.avaliar(texto, gabarito, deteccoes)
        relatorio(
            resultados,
            f"{doc.nome} — {len(texto):,} chars, {duracao:.1f}s, "
            f"{len(deteccoes)} detecções, gabarito {len(gabarito)}",
        )
        inventario_vazamentos(texto, resultados)

        saida[doc.nome] = {
            "sha256": doc.sha256,
            "chars": len(texto),
            "segundos": round(duracao, 1),
            "modo_nlp": engine.nlp_mode,
            "deteccoes": len(deteccoes),
            "tipos": {
                t: {
                    "protecao_valor": r.protecao_valor,
                    "recall_ocorrencia": r.recall_ocorrencia,
                    "recall_boilerplate": r.recall_boilerplate,
                    "valores_unicos": r.valores_unicos,
                    "valores_protegidos": r.valores_protegidos,
                    "ocorrencias_substantivas": r.ocorrencias_substantivas,
                    "protegidas_substantivas": r.protegidas_substantivas,
                }
                for t, r in resultados.items()
            },
        }

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nResultado gravado em {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
