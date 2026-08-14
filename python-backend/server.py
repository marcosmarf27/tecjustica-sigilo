"""
Servidor FastAPI para anonimização de PII com Microsoft Presidio.
Roda localmente como processo filho do Electron.
"""

import argparse
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from engine import get_engine
from config_loader import get_raw_deny_list, save_deny_list
from striprtf.striprtf import rtf_to_text

app = FastAPI(title="Presidio Anon API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnonymizeRequest(BaseModel):
    text: str
    entities: list[str]
    language: str = "pt"


class EntityFound(BaseModel):
    type: str
    text: str
    start: int
    end: int
    score: float


class AnonymizeResponse(BaseModel):
    anonymized_text: str
    entities_found: list[EntityFound]


class ExtractTextRequest(BaseModel):
    content: str
    format: str


class DenyListUpdate(BaseModel):
    deny_list: dict[str, list[str]]


@app.post("/extract-text")
def extract_text(req: ExtractTextRequest):
    if req.format == "rtf":
        plain = rtf_to_text(req.content)
        return {"text": plain}
    return {"text": req.content}


@app.get("/health")
def health():
    engine = get_engine()
    return {
        "status": "ready" if engine.is_ready() else "loading",
        "nlp_mode": engine.nlp_mode,
        # Quando o modo pedido não é o que está rodando, a interface precisa
        # dizer isso: o modo leve detecta menos entidades em texto jurídico, e
        # cair para ele em silêncio dá uma falsa sensação de segurança.
        "nlp_mode_solicitado": engine.modo_solicitado,
        "motivo_fallback": engine.motivo_fallback,
    }


@app.post("/anonymize", response_model=AnonymizeResponse)
def anonymize(req: AnonymizeRequest):
    engine = get_engine()
    result = engine.anonymize(
        text=req.text,
        entities=req.entities,
        language=req.language,
    )
    return AnonymizeResponse(
        anonymized_text=result["anonymized_text"],
        entities_found=[
            EntityFound(**e) for e in result["entities_found"]
        ],
    )


@app.get("/config/deny-list")
def get_deny_list():
    return {"deny_list": get_raw_deny_list()}


@app.post("/config/deny-list")
def update_deny_list(req: DenyListUpdate):
    try:
        save_deny_list(req.deny_list)
        get_engine().reload_deny_list()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "ok"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8123)
    args = parser.parse_args()

    import sys
    engine = get_engine()
    print(f"Carregando modelo NLP (modo={engine.nlp_mode})...", flush=True)
    engine.initialize()
    print(f"Modelo carregado. Servidor rodando na porta {args.port}", flush=True)
    sys.stdout.flush()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
