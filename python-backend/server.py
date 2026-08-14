"""
Servidor FastAPI para anonimização de PII com Microsoft Presidio.
Roda localmente como processo filho do Electron.
"""

import argparse
import os
import secrets
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import documentos
import jobs
from engine import get_engine
from config_loader import get_raw_deny_list, save_deny_list
from jobs import Job, registro
from mask_config import POLITICA_PADRAO, POLITICAS
from striprtf.striprtf import rtf_to_text

app = FastAPI(title="Presidio Anon API")

# Segredo de sessão.
#
# O servidor escuta em 127.0.0.1, mas isso sozinho não protege: qualquer página
# aberta no navegador da máquina consegue falar com uma porta local. E como
# `/processar` abre um arquivo pelo caminho e devolve o conteúdo, sem um
# segredo um site qualquer poderia mandar o backend ler documentos do disco.
#
# O Electron lê este token da saída do processo e o repassa à interface; quem
# não o tiver recebe 403. Ele muda a cada execução e nunca vai para o disco.
TOKEN_SESSAO = os.environ.get("PRESIDIO_TOKEN") or secrets.token_urlsafe(32)

# Rotas sem token: `/health` só informa se o motor subiu, e é por ela que a
# interface descobre que o servidor está de pé.
ROTAS_PUBLICAS = {"/health", "/docs", "/openapi.json"}


@app.middleware("http")
async def exigir_token(request: Request, call_next):
    if request.url.path in ROTAS_PUBLICAS or request.method == "OPTIONS":
        return await call_next(request)

    enviado = request.headers.get("x-presidio-token", "")
    if not secrets.compare_digest(enviado, TOKEN_SESSAO):
        return JSONResponse(
            status_code=403,
            content={"detail": "requisição sem credencial desta sessão"},
        )
    return await call_next(request)


class AnonymizeRequest(BaseModel):
    text: str
    entities: list[str]
    language: str = "pt"
    politica_mascara: str = POLITICA_PADRAO


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
        "politicas_mascara": list(POLITICAS),
        "politica_padrao": POLITICA_PADRAO,
        "formatos_documento": sorted(documentos.EXTENSOES_DOCUMENTO),
        # False significa que o OCR precisaria buscar os dados de idioma na
        # rede — o que a interface deve avisar antes de prometer sigilo.
        "ocr_offline": documentos.tessdata_disponivel(),
    }


@app.post("/anonymize", response_model=AnonymizeResponse)
def anonymize(req: AnonymizeRequest):
    """
    Anonimização síncrona. Mantida para a CLI e para textos curtos; a interface
    usa `/processar`, que informa progresso e permite cancelar.
    """
    engine = get_engine()
    result = engine.anonymize(
        text=req.text,
        entities=req.entities,
        language=req.language,
        politica_mascara=req.politica_mascara,
    )
    return AnonymizeResponse(
        anonymized_text=result["anonymized_text"],
        entities_found=[
            EntityFound(**e) for e in result["entities_found"]
        ],
    )


# --- Processamento com progresso e cancelamento ----------------------------


class ProcessarRequest(BaseModel):
    """
    Ou `caminho` (documento em disco: PDF, DOCX, imagem) ou `texto` já lido.
    Documento passa antes pela extração; texto vai direto para a análise.
    """

    caminho: str | None = None
    texto: str | None = None
    nome_arquivo: str = ""
    entities: list[str] = []
    language: str = "pt"
    politica_mascara: str = POLITICA_PADRAO


@app.post("/processar")
def processar(req: ProcessarRequest):
    if not req.caminho and req.texto is None:
        raise HTTPException(status_code=400, detail="informe 'caminho' ou 'texto'")

    if req.caminho:
        alvo = Path(req.caminho)
        if not alvo.is_file():
            raise HTTPException(status_code=404, detail="arquivo não encontrado")
        # Só formatos que o aplicativo declara ler. Sem isso, um caminho
        # arbitrário viraria leitura de qualquer arquivo do disco.
        if not documentos.suportado(alvo):
            raise HTTPException(
                status_code=415,
                detail=f"formato não suportado: {alvo.suffix or 'sem extensão'}",
            )

    nome = req.nome_arquivo or (Path(req.caminho).name if req.caminho else "texto")
    job = registro.criar(nome)

    def tarefa(job: Job) -> dict:
        texto = req.texto or ""

        if req.caminho:
            job.estado = jobs.EXTRAINDO
            job.etapa = "Lendo o documento"

            def progresso_extracao(prontas: int, total: int) -> None:
                job.atual, job.total = prontas, total
                if total:
                    job.etapa = f"Lendo o documento — {total} páginas"

            documento = documentos.extrair(req.caminho, progresso=progresso_extracao)
            texto = documento.como_markdown()

            if documento.houve_ocr:
                job.etapa = "Documento lido por OCR"

        if job.cancelado:
            return {}

        job.estado = jobs.ANALISANDO
        job.etapa = "Procurando dados pessoais"

        def progresso_analise(prontos: int, total: int) -> None:
            job.atual, job.total = prontos, total

        engine = get_engine()
        resultado = engine.anonymize(
            text=texto,
            entities=req.entities,
            language=req.language,
            progresso=progresso_analise,
            politica_mascara=req.politica_mascara,
            cancelado=lambda: job.cancelado,
        )
        resultado["texto_original"] = texto
        return resultado

    registro.executar(job, tarefa)
    return {"job_id": job.id, **job.para_json()}


@app.get("/processar/{job_id}")
def status_do_job(job_id: str):
    job = registro.obter(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="processamento não encontrado")
    return job.para_json()


@app.get("/processar/{job_id}/resultado")
def resultado_do_job(job_id: str):
    """
    Entrega o resultado uma vez e o descarta da memória — ele contém o
    documento inteiro, e mantê-lo depois de lido só prolongaria o tempo em que
    dado pessoal fica no processo.
    """
    job = registro.obter(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="processamento não encontrado")
    if job.estado != jobs.CONCLUIDO or job.resultado is None:
        raise HTTPException(
            status_code=409,
            detail=f"processamento ainda em '{job.estado}'",
        )

    resultado = job.resultado
    job.resultado = None
    registro.descartar(job_id)
    return resultado


@app.post("/processar/{job_id}/cancelar")
def cancelar_job(job_id: str):
    job = registro.obter(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="processamento não encontrado")
    job.cancelar()
    return job.para_json()


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
    # O Electron lê esta linha para saber o token da sessão.
    print(f"PRESIDIO_TOKEN={TOKEN_SESSAO}", flush=True)
    print(f"Modelo carregado. Servidor rodando na porta {args.port}", flush=True)
    sys.stdout.flush()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
