#!/usr/bin/env python3
"""
CLI standalone de anonimização.

Uso humano:
    tecjustica-sigilo arquivo.txt                 # imprime no stdout
    tecjustica-sigilo arquivo.txt -o saida.txt    # grava em arquivo
    cat x.txt | tecjustica-sigilo                 # stdin -> stdout
    tecjustica-sigilo *.txt --in-place            # edita no lugar

Uso por agentes (Claude Code etc.):
    tecjustica-sigilo arquivo.txt --format json   # devolve texto + lista de entidades
    echo "CPF 12345678909" | tecjustica-sigilo --format json --entities CPF_BR

Códigos de saída:
    0 = sucesso
    1 = erro de I/O ou parsing
    2 = engine falhou
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from mask_config import POLITICA_PADRAO, POLITICAS

from engine import get_engine


def _read_input(path: str | None) -> str:
    if path is None or path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def _write_output(path: str | None, content: str) -> None:
    if path is None or path == "-":
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")
        return
    Path(path).write_text(content, encoding="utf-8")


def _parse_entities(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [e.strip() for e in raw.split(",") if e.strip()]


def _process_one(
    engine, text: str, entities: list[str], politica: str
) -> dict:
    return engine.anonymize(
        text=text, entities=entities, politica_mascara=politica
    )


def _cmd_single(args, engine) -> int:
    entities = _parse_entities(args.entities)

    if args.files and not args.in_place:
        if len(args.files) > 1:
            print(
                "erro: múltiplos arquivos só são suportados com --in-place ou --output-dir",
                file=sys.stderr,
            )
            return 1
        text = _read_input(args.files[0])
    else:
        text = _read_input(None)

    result = _process_one(engine, text, entities, args.mascara)

    if args.format == "json":
        out = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        out = result["anonymized_text"]

    _write_output(args.output, out)
    return 0


def _cmd_batch(args, engine) -> int:
    entities = _parse_entities(args.entities)
    out_dir = Path(args.output_dir) if args.output_dir else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    for path_str in args.files:
        path = Path(path_str)
        text = path.read_text(encoding="utf-8")
        result = _process_one(engine, text, entities, args.mascara)

        if args.in_place:
            dest = path
        elif out_dir:
            dest = out_dir / f"{path.stem}_anonimizado{path.suffix}"
        else:
            dest = path.with_name(f"{path.stem}_anonimizado{path.suffix}")

        dest.write_text(result["anonymized_text"], encoding="utf-8")
        print(f"{path} -> {dest}", file=sys.stderr)

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="tecjustica-sigilo",
        description="Anonimiza PII (CPF, CNPJ, RG, nomes, processos CNJ etc.) em textos jurídicos brasileiros.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "files",
        nargs="*",
        help="Arquivo(s) de entrada. Sem argumento lê de stdin.",
    )
    parser.add_argument(
        "-o", "--output",
        help="Arquivo de saída (default: stdout). Ignorado com múltiplos inputs.",
    )
    parser.add_argument(
        "--output-dir",
        help="Diretório onde gravar saídas com sufixo _anonimizado (batch).",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Sobrescreve os arquivos de entrada com a versão anonimizada.",
    )
    parser.add_argument(
        "-f", "--format",
        choices=["text", "json"],
        default="text",
        help="text=apenas o conteúdo anonimizado; json=dict com entidades encontradas.",
    )
    parser.add_argument(
        "-e", "--entities",
        help="Lista separada por vírgula de entidades a mascarar (ex: PERSON,CPF_BR,CNPJ_BR). Default: todas.",
    )
    parser.add_argument(
        "-m",
        "--mascara",
        choices=POLITICAS,
        default=POLITICA_PADRAO,
        help=(
            "como substituir o dado encontrado: "
            "placeholder = [PESSOA_1] (nada permanece), "
            "parcial = J**** d* S**** (mantém iniciais), "
            "total = ************* (esconde até o formato)"
        ),
    )
    parser.add_argument(
        "--nlp-mode",
        choices=["transformer", "spacy"],
        help="Sobrescreve PRESIDIO_NLP_MODE apenas para esta execução.",
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suprime mensagens de inicialização no stderr.",
    )

    args = parser.parse_args(argv)

    if args.nlp_mode:
        os.environ["PRESIDIO_NLP_MODE"] = args.nlp_mode

    try:
        if not args.quiet:
            print("Inicializando engine...", file=sys.stderr, flush=True)
        engine = get_engine()
        engine.initialize()
        if not args.quiet:
            print(f"Pronto (modo={engine.nlp_mode}).", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"erro ao inicializar engine: {exc}", file=sys.stderr)
        return 2

    try:
        is_batch = (args.in_place or args.output_dir) and args.files
        if is_batch:
            return _cmd_batch(args, engine)
        return _cmd_single(args, engine)
    except FileNotFoundError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
