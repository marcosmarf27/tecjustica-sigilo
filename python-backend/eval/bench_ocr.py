"""
Bench das configurações do PP-OCRv6, uma contra a outra.

Isola o motor de propósito: rasteriza a página e chama o `ocr_engine` direto,
sem o liteparse no meio. Serve para escolher resolução e perfil, **não** para
prever o resultado em produção — lá o liteparse preserva o texto nativo, decide
página a página e remonta o texto com lógica espacial própria. Diferença medida
entre os dois caminhos: a mesma configuração devolveu 6 identificadores aqui e
16 no caminho real. Para decidir integridade de identificador, meça ponta a
ponta.

**Por que não medir contra outro OCR.** A medição de 14/08 comparou o texto do
Tesseract com o texto do PaddleOCR e tratou o segundo como referência. O próprio
relatório registra a ressalva: nos dois piores documentos o motor de referência
também produziu lixo, então parte da divergência é ruído dos dois lados. Aqui a
métrica não depende de gabarito nem de um segundo motor:

- **palavras_lexico** — quantas palavras reconhecidas são palavras portuguesas
  de verdade, conferidas no vocabulário do `pt_core_news_lg`. É a métrica de
  cabeceira: premia transcrever mais (cobertura) e transcrever certo (um `vlor`
  no lugar de `valor` não conta), sem precisar de gabarito humano. OCR ruim
  produz sequências que não são palavra nenhuma.
- **docs_validos** — CPF, CNPJ e número CNJ com dígito verificador batendo.
  É gabarito de graça: só valida se o motor transcreveu todos os dígitos na
  ordem certa. E é o que este aplicativo existe para encontrar.
- **segundos** — orçamento de tempo por página, que é metade da decisão.

Nenhuma delas é recall: sem gabarito humano não há recall, precisão nem CER.
São indicadores comparativos entre configurações do mesmo motor, e é só isso
que devem ser lidos como sendo.

Uso:
    python -m eval.bench_ocr --pdfs /caminho/*.pdf
    python -m eval.bench_ocr --corpus /caminho/da/pasta --saida bench.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import validators  # noqa: E402

# Só palavras com pelo menos 4 letras entram na taxa de léxico. Abaixo disso o
# ruído de OCR acerta por acaso ("de", "os", "e") e o número perde sentido.
_MINIMO_LETRAS = 4
_TOKEN = re.compile(r"[A-Za-zÀ-ÿ]{%d,}" % _MINIMO_LETRAS)

_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
_CNJ = re.compile(r"\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b")


@dataclass
class Medida:
    documento: str
    motor: str
    palavras: int = 0
    palavras_lexico: int = 0
    taxa_lexico: float = 0.0
    docs_validos: int = 0
    caracteres: int = 0
    segundos: float = 0.0
    erro: str | None = None
    detalhe: dict[str, Any] = field(default_factory=dict)


def _lexico() -> Callable[[str], bool]:
    """Vocabulário português, para separar palavra de ruído de OCR.

    Usa os vetores do `pt_core_news_lg` (500 mil formas) como lista de palavras.
    Não é dicionário curado — deixa passar algum ruído —, mas separa muito bem
    `hipotecários` de `Auaa`, que é o que a medição precisa distinguir.
    """
    import spacy

    vocab = spacy.load("pt_core_news_lg", exclude=["ner", "parser", "tagger"]).vocab

    def conhecida(palavra: str) -> bool:
        return vocab.has_vector(palavra) or vocab.has_vector(palavra.lower())

    return conhecida


def medir_texto(texto: str, conhecida: Callable[[str], bool]) -> dict[str, Any]:
    palavras = _TOKEN.findall(texto)
    acertos = sum(1 for p in palavras if conhecida(p))
    validos = 0
    for padrao, valida in ((_CPF, validators.cpf_valid), (_CNPJ, validators.cnpj_valid), (_CNJ, validators.processo_cnj_valid)):
        validos += sum(1 for achado in padrao.findall(texto) if valida(achado))
    return {
        "palavras": len(palavras),
        "palavras_lexico": acertos,
        "taxa_lexico": round(acertos / len(palavras), 4) if palavras else 0.0,
        "docs_validos": validos,
        "caracteres": len(texto),
    }


def _paginas_em_png(caminho: Path, dpi: int) -> Iterable[bytes]:
    """Rasteriza o PDF página a página, sem manter todas em memória.

    Uma A4 a 300 dpi em RGBA passa de 30 MB antes dos tensores; guardar o
    documento inteiro rasterizado é como se estoura a RAM num processo de 500
    páginas (§9 do guia).
    """
    import io

    import pypdfium2 as pdfium

    documento = pdfium.PdfDocument(str(caminho))
    try:
        for indice in range(len(documento)):
            pagina = documento[indice]
            imagem = pagina.render(scale=dpi / 72).to_pil()
            buffer = io.BytesIO()
            imagem.save(buffer, format="PNG")
            yield buffer.getvalue()
            imagem.close()
            pagina.close()
    finally:
        documento.close()


def texto_ppocrv6(caminho: Path, dpi: int, perfil: str, ajustes: dict[str, Any]) -> str:
    """PP-OCRv6 direto sobre as páginas rasterizadas, sem o liteparse no meio.

    Isola o motor: qualquer diferença aqui é do OCR, não da montagem do texto.
    """
    import ocr_engine

    ocr_engine._motores.clear()
    anteriores = {chave: getattr(ocr_engine, chave) for chave in ajustes}
    for chave, valor in ajustes.items():
        setattr(ocr_engine, chave, valor)
    try:
        partes = []
        for png in _paginas_em_png(caminho, dpi):
            resultados = ocr_engine.reconhecer(png, "pt", perfil)
            partes.append(" ".join(r["text"] for r in resultados))
        return "\n".join(partes)
    finally:
        for chave, valor in anteriores.items():
            setattr(ocr_engine, chave, valor)
        ocr_engine._motores.clear()


# As configurações comparadas. `v6-small-padrao` reproduz o que foi medido em
# 14/08 (defaults do RapidOCR); as demais sobem a resolução que aquele padrão
# jogava fora.
CONFIGURACOES: dict[str, dict[str, Any]] = {
    "v6-small-padrao": {"perfil": "small", "LADO_MAXIMO": 2000, "LADO_DETECTOR": 736},
    "v6-small-1536": {"perfil": "small", "LADO_MAXIMO": 4000, "LADO_DETECTOR": 1536},
    "v6-small-2048": {"perfil": "small", "LADO_MAXIMO": 4000, "LADO_DETECTOR": 2048},
    "v6-medium-1536": {"perfil": "medium", "LADO_MAXIMO": 4000, "LADO_DETECTOR": 1536},
}


def rodar(pdfs: list[Path], dpi: int, motores: list[str]) -> list[Medida]:
    conhecida = _lexico()
    medidas: list[Medida] = []
    for pdf in pdfs:
        for motor in motores:
            medida = Medida(documento=pdf.name, motor=motor)
            inicio = time.perf_counter()
            try:
                config = dict(CONFIGURACOES[motor])
                perfil = config.pop("perfil")
                texto = texto_ppocrv6(pdf, dpi, perfil, config)
                medida.segundos = round(time.perf_counter() - inicio, 2)
                for chave, valor in medir_texto(texto, conhecida).items():
                    setattr(medida, chave, valor)
            except Exception as erro:  # noqa: BLE001 - um motor quebrado não pode parar o bench
                medida.segundos = round(time.perf_counter() - inicio, 2)
                medida.erro = f"{type(erro).__name__}: {erro}"
            medidas.append(medida)
            print(
                f"{pdf.name[:38]:38} {motor:16} "
                f"lex={medida.palavras_lexico:5} ({medida.taxa_lexico:.0%})  "
                f"docs={medida.docs_validos:3}  {medida.segundos:6.1f}s"
                + (f"  ERRO {medida.erro}" if medida.erro else ""),
                flush=True,
            )
    return medidas


def resumir(medidas: list[Medida]) -> dict[str, dict[str, Any]]:
    """Consolida por motor. Soma o léxico em vez de tirar média das taxas: um
    documento de 3 páginas não pode pesar igual a um de 20."""
    por_motor: dict[str, dict[str, Any]] = {}
    for medida in medidas:
        alvo = por_motor.setdefault(
            medida.motor,
            {"palavras_lexico": 0, "palavras": 0, "docs_validos": 0, "segundos": 0.0, "erros": 0},
        )
        if medida.erro:
            alvo["erros"] += 1
            continue
        alvo["palavras_lexico"] += medida.palavras_lexico
        alvo["palavras"] += medida.palavras
        alvo["docs_validos"] += medida.docs_validos
        alvo["segundos"] += medida.segundos
    for alvo in por_motor.values():
        alvo["taxa_lexico"] = round(alvo["palavras_lexico"] / alvo["palavras"], 4) if alvo["palavras"] else 0.0
        alvo["segundos"] = round(alvo["segundos"], 1)
    return por_motor


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, help="pasta com os PDFs")
    parser.add_argument("--pdfs", type=Path, nargs="*", default=[])
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument(
        "--motores",
        nargs="*",
        default=["v6-small-padrao", "v6-small-1536"],
        choices=list(CONFIGURACOES),
    )
    parser.add_argument("--saida", type=Path, default=Path(__file__).parent / "bench_ocr.json")
    args = parser.parse_args()

    pdfs = sorted(args.pdfs)
    if args.corpus:
        pdfs += sorted(args.corpus.glob("*.pdf"))
    if not pdfs:
        parser.error("nenhum PDF: use --corpus ou --pdfs")

    medidas = rodar(pdfs, args.dpi, args.motores)
    resumo = resumir(medidas)

    print("\n" + "=" * 78)
    for motor, dados in resumo.items():
        print(
            f"{motor:16} lexico={dados['palavras_lexico']:6} ({dados['taxa_lexico']:.1%})  "
            f"docs={dados['docs_validos']:3}  total={dados['segundos']:7.1f}s"
            + (f"  erros={dados['erros']}" if dados["erros"] else "")
        )

    args.saida.write_text(
        json.dumps({"dpi": args.dpi, "resumo": resumo, "medidas": [asdict(m) for m in medidas]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {args.saida}")


if __name__ == "__main__":
    main()
