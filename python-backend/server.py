"""
Servidor FastAPI para anonimização de PII com Microsoft Presidio.
Roda localmente como processo filho do Electron.
"""

import argparse
import os
import secrets
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import api_v1
import clientes
import documentos
import jobs
import ocr_engine
from engine import PresidioEngine, get_engine
from config_loader import get_raw_deny_list, save_deny_list
from jobs import Job, registro
from mask_config import POLITICA_PADRAO, POLITICAS
from striprtf.striprtf import rtf_to_text

app = FastAPI(title="TecJustiça Sigilo API")

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
# interface descobre que o servidor está de pé. `/v1/info` é o cartão de visita
# da instalação, que um cliente lê antes de pedir pareamento — não expõe nada
# de documento nem a lista de clientes.
ROTAS_PUBLICAS = {"/health", "/docs", "/openapi.json", "/v1/info"}

# Abrir um pedido de pareamento e perguntar como ele ficou são, por definição,
# coisas que se fazem **sem** credencial: é o que se está tentando obter. A
# proteção aqui não é o token, é a aprovação humana no diálogo, com o mesmo
# código nos dois lados, e a validade curta do pedido.
ROTAS_DE_PAREAMENTO = "/v1/parear"


@app.middleware("http")
async def exigir_token(request: Request, call_next):
    caminho = request.url.path

    if caminho in ROTAS_PUBLICAS or request.method == "OPTIONS":
        return await call_next(request)
    if caminho == ROTAS_DE_PAREAMENTO or caminho.startswith(ROTAS_DE_PAREAMENTO + "/"):
        return await call_next(request)

    enviado = request.headers.get("x-presidio-token", "")

    # O token de sessão é o da janela do aplicativo: escopo total, inclusive
    # `arquivo-local`. Continua sendo comparado com `compare_digest`.
    if secrets.compare_digest(enviado, TOKEN_SESSAO):
        return await call_next(request)

    # Token de cliente pareado: vale só onde os escopos dele alcançam.
    escopo = clientes.escopo_da_rota(caminho, request.method)
    if escopo is not None:
        cliente = clientes.autenticar(enviado)
        if cliente is not None and escopo in cliente.escopos:
            return await call_next(request)

    return JSONResponse(
        status_code=403,
        content={"detail": "requisição sem credencial desta sessão"},
    )


# CORS, e só em desenvolvimento.
#
# Empacotado, a interface é servida pelo próprio Electron e não há origem
# cruzada: nenhum cabeçalho de CORS é montado, e o comportamento continua o de
# sempre. Em dev a interface vem do Vite, em `http://localhost:5173`, e falar
# com o backend em `127.0.0.1` passa a ser origem cruzada.
#
# O que quebrava era sutil e vale registrar, porque os dois mecanismos de
# segurança se atropelaram: `comTimeout` manda `X-Presidio-Token` em TODA
# requisição, `/health` inclusive. Cabeçalho customizado torna a requisição
# não-simples, o navegador manda um OPTIONS de preflight antes, e o backend —
# que nunca precisou responder preflight — devolvia 405 sem
# `Access-Control-Allow-Origin`. O navegador então abortava a requisição de
# verdade, o `catch` do hook engolia o erro em silêncio e a tela ficava presa em
# "Carregando motor de anonimização" até estourar os 180 s. Ou seja: foi o
# cabeçalho que protege o backend que criou a condição da falha.
#
# Nenhum teste pega isso — sem navegador não existe CORS, e a suíte fala HTTP
# direto com o backend.
#
# A origem é declarada pelo Electron, não adivinhada aqui: assim o backend
# empacotado nunca aceita origem nenhuma, mesmo que alguém suba um servidor na
# 5173. E CORS não é o que protege este backend de qualquer forma — o token é.
# CORS só decide quem pode LER a resposta; não impede a requisição de chegar.
# Com a API v1, uma extensão de navegador passa a ser cliente legítimo — e
# extensão tem origem `chrome-extension://<32 letras a–p>`. O regex libera essa
# forma e **só** ela; nenhuma origem `http://` de página comum é aceita, nem
# mesmo em desenvolvimento, porque é exatamente o caso que o token existe para
# barrar.
#
# **CORS não é autorização.** Quem autoriza é o token; o regex só evita que o
# preflight reprove um cliente legítimo antes de a requisição chegar.
# `allow_credentials` continua desligado: a credencial viaja no cabeçalho
# `X-Presidio-Token`, não em cookie.
ORIGEM_EXTENSAO = r"^chrome-extension://[a-p]{32}$"
ORIGEM_DEV = os.environ.get("PRESIDIO_DEV_ORIGIN", "").strip()

_origens_dev = [o for o in ORIGEM_DEV.split(",") if o] if ORIGEM_DEV else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origens_dev,
    allow_origin_regex=ORIGEM_EXTENSAO,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Presidio-Token"],
)


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


class RemascararRequest(BaseModel):
    """
    Reaplica máscaras sobre ocorrências que a interface já decidiu.

    `entities` são as que devem ser mascaradas — a lista completa MENOS o que o
    revisor rejeitou. Não é um pedido de detecção: nada aqui roda o NER.
    """

    text: str
    entities: list[EntityFound]
    politica_mascara: str = POLITICA_PADRAO


class RemascararResponse(BaseModel):
    anonymized_text: str
    entities_found: list[EntityFound]
    politica_mascara: str
    valores_distintos: dict[str, int]


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
        # False significa que o OCR precisaria baixar os modelos da rede — o
        # que a interface deve avisar antes de prometer sigilo.
        "ocr_offline": documentos.ocr_offline(),
        "ocr_motor": f"PP-OCRv6 {ocr_engine.perfil_ativo()}",
    }



@app.get("/contagem-ocr/{extracao}")
def contagem_ocr(extracao: str):
    """
    A contagem de páginas reconhecidas, perguntada a quem contou.

    No aplicativo esta rota é redundante — `/ocr` e a extração rodam no mesmo
    processo, então o dicionário é o mesmo. Ela existe para o contrato ser um
    só: `documentos` pergunta ao servidor de OCR, seja ele qual for. No modo
    offline o servidor é outro processo, e ali a pergunta é a única forma de
    saber.
    """
    return {"atendidas": ocr_engine.paginas_atendidas(extracao)}

@app.post("/ocr")
async def ocr(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form(documentos.IDIOMA_OCR),
):
    """Reconhecimento de texto numa imagem de página.

    Quem chama não é a interface: é o liteparse, de dentro do próprio job de
    extração, porque ele não aceita motor de OCR injetado em processo (só
    `ocr_server_url`). O contrato é o do liteparse — `multipart/form-data` com
    `file` e `language`, resposta `{"results": [{text, bbox, confidence}]}`.

    A rota fica **atrás do token** como qualquer outra: o liteparse manda o
    cabeçalho porque o `documentos.configurar_ocr()` o entregou a ele. Deixá-la
    pública seria dar a qualquer página aberta no navegador da máquina um
    serviço de OCR gratuito rodando com a CPU do usuário.

    Não há risco de travar o servidor chamando a si mesmo: o job roda em thread
    própria (ver jobs.py), então o laço de eventos continua livre para atender
    estas requisições no threadpool.
    """
    # Recusa pelo Content-Length ANTES de ler o corpo. Checar depois do
    # `read()` já teria trazido o upload inteiro para a memória — o 413 sairia
    # bonito e o dano já estaria feito.
    declarado = request.headers.get("content-length")
    if declarado and declarado.isdigit() and int(declarado) > ocr_engine.TAMANHO_MAXIMO:
        return JSONResponse(
            status_code=413,
            content={"error": f"corpo acima de {ocr_engine.TAMANHO_MAXIMO} bytes"},
        )

    try:
        conteudo = await file.read()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "arquivo ilegível"})
    if not conteudo:
        return JSONResponse(status_code=400, content={"error": "arquivo vazio"})

    if len(conteudo) > ocr_engine.TAMANHO_MAXIMO:
        return JSONResponse(
            status_code=413,
            content={"error": f"imagem acima de {ocr_engine.TAMANHO_MAXIMO} bytes"},
        )

    try:
        resultados = await run_in_threadpool(ocr_engine.reconhecer, conteudo, language)
        # Só conta depois de dar certo: é assim que a extração descobre quantas
        # páginas realmente passaram pelo reconhecimento.
        ocr_engine.registrar_atendimento(
            request.headers.get("x-presidio-ocr-extracao"), conteudo
        )
    except ocr_engine.ArquivoGrandeDemais as exc:
        return JSONResponse(status_code=413, content={"error": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
    return {"results": resultados}


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


@app.post("/remascarar", response_model=RemascararResponse)
def remascarar(req: RemascararRequest):
    """
    Reescreve o texto mascarado a partir de uma lista de ocorrências revisada.

    A revisão precisa disto para que "Não é PII" tenha efeito no documento
    aberto. Sem a rota, a única forma de tirar um falso positivo era reprocessar
    — minutos de CPU para chegar ao mesmo texto, já que a detecção não muda.

    Vale notar o que a rota NÃO faz: ela não decide o que é dado pessoal, e não
    consulta a deny-list. Recebe a lista e aplica. Quem escolhe é a interface, e
    a permanência do "nunca mascare este termo" continua sendo a deny-list, que
    vale para os documentos seguintes.
    """
    try:
        resultado = PresidioEngine.remascarar(
            text=req.text,
            entidades=[e.model_dump() for e in req.entities],
            politica_mascara=req.politica_mascara,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return RemascararResponse(
        anonymized_text=resultado["anonymized_text"],
        entities_found=[EntityFound(**e) for e in resultado["entities_found"]],
        politica_mascara=resultado["politica_mascara"],
        valores_distintos=resultado["valores_distintos"],
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
        info_ocr: dict | None = None

        if req.caminho:
            job.estado = jobs.EXTRAINDO
            job.etapa = "Lendo o documento"

            def progresso_extracao(prontas: int, total: int) -> None:
                # `prontas` são as páginas que já voltaram do OCR, contadas pela
                # rota `/ocr`. A etapa nomeia a página em curso porque é a
                # informação que responde "travou?": numa procuração de 12
                # páginas digitalizadas a leitura leva minutos, e a tela dizia
                # apenas "Lendo o documento" o tempo todo.
                job.atual, job.total = prontas, total
                if total and prontas:
                    job.etapa = f"Lendo o documento — página {prontas} de {total}"
                elif total:
                    job.etapa = f"Lendo o documento — {total} páginas"

            documento = documentos.extrair(req.caminho, progresso=progresso_extracao)
            texto = documento.como_markdown()

            # O aviso de OCR viaja no RESULTADO, não em `job.etapa`.
            #
            # Ele já morou em `job.etapa` e nunca chegou a ninguém: a linha
            # seguinte o sobrescreve com "Procurando dados pessoais" em alguns
            # microssegundos, e a interface faz polling em intervalo fixo — só
            # veria a mensagem por coincidência. Um aviso que depende de sorte
            # não é aviso.
            #
            # `paginas_com_erro` é o campo que não pode sumir: são páginas que
            # o parser não conseguiu ler — inclusive falha de OCR, que
            # `ocr_failure_fatal=False` deixa de ser fatal de propósito. O texto
            # delas não está no documento de saída, e quem revisa precisa saber
            # disso antes de assinar embaixo.
            info_ocr = {
                "houve_ocr": documento.houve_ocr,
                "paginas_ocr": documento.paginas_ocr,
                "paginas_com_erro": documento.paginas_com_erro,
                "erros": list(documento.erros),
                "total_paginas": documento.total_paginas,
            }

            if documento.houve_ocr:
                if documento.paginas_ocr and documento.total_paginas:
                    job.etapa = (
                        f"{documento.paginas_ocr} de {documento.total_paginas} "
                        "páginas lidas por OCR — confira o resultado"
                    )
                else:
                    job.etapa = "Documento lido por OCR — confira o resultado"

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
        if info_ocr is not None:
            resultado["ocr"] = info_ocr
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


# Rotas versionadas. Registradas por último, depois de todas as antigas, para
# que a ordem de declaração deixe claro que a v1 é acréscimo — as rotas que a
# interface usa hoje continuam exatamente onde estavam.
app.include_router(api_v1.router)


def preparar_runtime(porta: int, token: str | None = None) -> None:
    """
    Prepara o que **todo** entrypoint precisa antes de processar qualquer coisa.

    Isto era um trecho solto dentro do `if __name__ == "__main__"`, e essa é a
    armadilha que a função existe para desarmar: qualquer entrypoint novo que
    não repetisse a chamada — o servidor MCP, o modo offline da CLI, um teste —
    fazia o liteparse cair **em silêncio** no Tesseract embutido no wheel. E o
    Tesseract é justamente o motor descartado em 29/08/2026 por recuperar 17,7%
    das palavras numa matrícula de cartório datilografada.

    A degradação não levanta erro nenhum: sai um documento mutilado com cara de
    completo, e o que o OCR não leu, nenhum recognizer detecta — logo, nada é
    mascarado. Por isso a preparação virou uma função com nome, chamada de todos
    os lados, em vez de quatro linhas que alguém precisa lembrar de copiar.
    """
    documentos.configurar_ocr(
        f"http://127.0.0.1:{porta}/ocr",
        {"X-Presidio-Token": token or TOKEN_SESSAO},
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8123)
    args = parser.parse_args()

    import sys

    preparar_runtime(args.port)

    engine = get_engine()
    print(f"Carregando modelo NLP (modo={engine.nlp_mode})...", flush=True)
    engine.initialize()
    # O Electron lê esta linha para saber o token da sessão. A ordem importa:
    # o token só sai DEPOIS do initialize(), e o Electron faz parsing linha a
    # linha com buffer porque o chunk pode cortar o token no meio.
    print(f"PRESIDIO_TOKEN={TOKEN_SESSAO}", flush=True)
    print(f"Modelo carregado. Servidor rodando na porta {args.port}", flush=True)
    sys.stdout.flush()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
