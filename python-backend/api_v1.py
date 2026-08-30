"""
API local versionada — o contrato para quem não é a janela do aplicativo.

A CLI, uma extensão do PJe e um agente MCP falam por aqui. As rotas antigas
(`/health`, `/anonymize`, `/processar…`, `/ocr`, `/config/deny-list`) continuam
existindo e funcionando: a v1 é **casca** sobre `engine.py`, `documentos.py` e
`ocr_engine.py`, que já eram chamáveis em processo. Nada foi reescrito para ela.

## A fronteira que organiza tudo

Cliente externo **manda o conteúdo**; quem lê o disco por caminho continua sendo
só a janela do aplicativo. Por isso `/v1/documento` recebe o arquivo por
multipart em vez de aceitar um caminho, e por isso o escopo `arquivo-local`
nunca é concedido em pareamento.

Isso responde direto ao aviso do `CLAUDE.md`: "`127.0.0.1` não protege nada.
Qualquer página aberta no navegador alcança portas locais, e `/processar` abre
arquivo por caminho."
"""

from __future__ import annotations

import documentos
import ocr_engine
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import clientes
from engine import get_engine
from mask_config import POLITICA_PADRAO, POLITICAS

# Teto de upload em `/v1/documento`. Autos de verdade passam dos 100 MB, então
# o limite é alto de propósito: ele não existe para restringir uso legítimo, e
# sim para que um corpo gigante não derrube o backend por falta de memória.
LIMITE_UPLOAD_BYTES = 512 * 1024 * 1024

router = APIRouter(prefix="/v1")


class PedidoDePareamento(BaseModel):
    nome: str
    escopos: list[str]


class AnonimizarRequest(BaseModel):
    texto: str
    entidades: list[str] = []
    politica: str = POLITICA_PADRAO
    idioma: str = "pt"


@router.get("/info")
def info():
    """
    Cartão de visita da instalação. **Pública** — é por ela que um cliente
    descobre com o que está falando antes de pedir pareamento.

    Não expõe nada sensível: versão, modo do motor, o que sabe ler e se o OCR
    está pronto. Nenhum dado de documento, nenhuma lista de clientes.
    """
    engine = get_engine()
    return {
        "produto": "TecJustiça Sigilo",
        "api": 1,
        "motor": {
            "pronto": engine.is_ready(),
            "modo_nlp": engine.nlp_mode,
            "modo_solicitado": engine.modo_solicitado,
            "motivo_fallback": engine.motivo_fallback,
        },
        # Vem do registro de recognizers, não de uma lista à mão: uma cópia
        # escrita à mão envelhece em silêncio.
        "entidades": engine.entidades_suportadas(),
        "politicas": list(POLITICAS),
        "politica_padrao": POLITICA_PADRAO,
        "formatos": sorted(documentos.EXTENSOES_DOCUMENTO),
        "ocr": {
            "offline": documentos.ocr_offline(),
            "motor": f"PP-OCRv6 {ocr_engine.perfil_ativo()}",
        },
        "escopos_pareaveis": sorted(clientes.ESCOPOS_PAREAVEIS),
    }


@router.post("/parear", status_code=202)
def parear(req: PedidoDePareamento, request: Request):
    """
    Abre um pedido de pareamento.

    Responde **202** com o código de seis caracteres. O mesmo código aparece no
    diálogo do aplicativo — ver o código nos dois lados é o que impede uma
    aprovação às cegas, em que a pessoa clica "permitir" sem saber quem pediu.
    """
    origem = request.headers.get("origin") or request.headers.get("user-agent")
    pedido = clientes.criar_pedido(req.nome, req.escopos, origem)
    return {
        "pedido": pedido.id,
        "codigo": pedido.codigo,
        "escopos_concedidos": pedido.escopos,
        "expira_em": clientes.VALIDADE_DO_PEDIDO_S,
        "instrucao": "Confira o código na janela do TecJustiça Sigilo e aprove.",
    }


@router.get("/parear/{pedido_id}")
def consultar_pareamento(pedido_id: str):
    """
    Estado do pedido. `200` com o token quando aprovado — **uma vez só**.

    Quem perdeu o token pareia de novo. Deixar a credencial disponível para
    releitura seria transformar o id do pedido, que trafega em URL, numa segunda
    credencial.
    """
    estado, token = clientes.consultar_pedido(pedido_id)

    if estado == "pendente":
        return JSONResponse(status_code=202, content={"estado": "pendente"})
    if estado == "negado":
        return JSONResponse(status_code=403, content={"estado": "negado"})
    if estado == "desconhecido":
        return JSONResponse(
            status_code=404,
            content={"estado": "desconhecido", "detail": "pedido expirado, já entregue ou inexistente"},
        )
    return {"estado": "aprovado", "token": token}


@router.post("/anonimizar")
async def anonimizar(req: AnonimizarRequest):
    """Texto entra, texto sai. Nada toca o disco."""
    engine = get_engine()
    if not engine.is_ready():
        raise HTTPException(status_code=503, detail="o motor ainda está subindo")
    if req.politica not in POLITICAS:
        raise HTTPException(status_code=422, detail=f"política desconhecida: {req.politica}")

    resultado = await run_in_threadpool(
        engine.anonymize,
        req.texto,
        req.entidades,
        req.idioma,
        None,
        req.politica,
        None,
    )
    return {
        "texto_anonimizado": resultado["anonymized_text"],
        "ocorrencias": resultado["entities_found"],
        "politica": resultado.get("politica_mascara", req.politica),
        "valores_distintos": resultado.get("valores_distintos"),
    }


@router.post("/ocr")
async def ocr_v1(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form(documentos.IDIOMA_OCR),
):
    """
    Reconhecimento de texto numa imagem, para cliente externo.

    Separada de `/ocr`, que serve ao liteparse com o contrato dele. Esta não
    conta a página no registro de atendimento: quem chama daqui não está no meio
    de um job de extração, e contar inflaria a contagem de páginas reconhecidas
    de um documento que nem está sendo processado.
    """
    declarado = request.headers.get("content-length")
    if declarado and declarado.isdigit() and int(declarado) > ocr_engine.TAMANHO_MAXIMO:
        return JSONResponse(
            status_code=413,
            content={"error": f"corpo acima de {ocr_engine.TAMANHO_MAXIMO} bytes"},
        )

    conteudo = await file.read()
    if not conteudo:
        return JSONResponse(status_code=400, content={"error": "arquivo vazio"})
    if len(conteudo) > ocr_engine.TAMANHO_MAXIMO:
        return JSONResponse(
            status_code=413,
            content={"error": f"imagem acima de {ocr_engine.TAMANHO_MAXIMO} bytes"},
        )

    resultados = await run_in_threadpool(ocr_engine.reconhecer, conteudo, language)
    return {"results": resultados}


@router.post("/documento")
async def documento(
    file: UploadFile = File(...),
    entidades: str = Form(""),
    politica: str = Form(POLITICA_PADRAO),
    anonimizar_texto: bool = Form(True),
):
    """
    Lê um documento **enviado** (PDF, DOCX, XLSX, imagem) e devolve o texto.

    O arquivo chega por multipart, nunca por caminho. É a diferença entre um
    cliente externo mandar um documento que ele já tem e um cliente externo
    poder mandar o backend abrir qualquer arquivo do disco do usuário.

    O arquivo temporário é apagado no `finally`: um PDF de autos deixado em
    `%TEMP%` seria um vazamento silencioso, justamente do que o produto existe
    para proteger.
    """
    import logging
    import os
    import tempfile
    import time
    from pathlib import Path

    # Validar a requisição antes do estado do servidor: 4xx antes de 5xx.
    # Um `.conf` enviado é erro de quem chamou e continua sendo erro depois que
    # o motor sobe — responder 503 faria o cliente concluir "tente mais tarde" e
    # reenviar para sempre um arquivo que nunca será aceito.
    sufixo = Path(file.filename or "documento").suffix.lower()
    if sufixo not in documentos.EXTENSOES_DOCUMENTO:
        raise HTTPException(
            status_code=415,
            detail=f"formato não suportado: {sufixo or '(sem extensão)'}",
        )

    engine = get_engine()
    if anonimizar_texto and not engine.is_ready():
        raise HTTPException(status_code=503, detail="o motor ainda está subindo")

    # Direto para o disco, em pedaços, com teto.
    #
    # `await file.read()` materializava o corpo inteiro em memória antes de
    # copiá-lo para o temporário — dois GB de autos viravam dois GB de RAM, mais
    # a cópia. O processo Python morre por falta de memória e leva o backend do
    # aplicativo junto: a janela volta a "Carregando motor de anonimização" sem
    # explicação. E o cliente nem precisa ser malicioso; processo grande basta.
    descritor, caminho = tempfile.mkstemp(suffix=sufixo)
    tamanho = 0
    try:
        with os.fdopen(descritor, "wb") as f:
            while True:
                pedaco = await file.read(1024 * 1024)
                if not pedaco:
                    break
                tamanho += len(pedaco)
                if tamanho > LIMITE_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "arquivo maior que o limite de "
                            f"{LIMITE_UPLOAD_BYTES // (1024 * 1024)} MB"
                        ),
                    )
                f.write(pedaco)

        if tamanho == 0:
            raise HTTPException(status_code=400, detail="arquivo vazio")

        extraido = await run_in_threadpool(documentos.extrair, caminho)
        texto = extraido.como_markdown()

        resposta = {
            "texto": texto,
            "ocr": {
                "houve_ocr": extraido.houve_ocr,
                "paginas_ocr": extraido.paginas_ocr,
                "paginas_com_erro": extraido.paginas_com_erro,
                "erros": extraido.erros,
                "total_paginas": extraido.total_paginas,
            },
        }

        if anonimizar_texto:
            # `e.strip()` era conferido e **descartado**: `" CPF_BR"` passava no
            # teste e ia para o motor com o espaço, onde não casa com recognizer
            # nenhum. O pedido era silenciosamente ignorado e o CPF saía em
            # claro — e um cliente que monta a lista com `", ".join(...)`, que é
            # o idioma natural, cai nisso em toda chamada.
            lista = [e.strip() for e in entidades.split(",") if e.strip()]
            resultado = await run_in_threadpool(
                engine.anonymize, texto, lista, "pt", None, politica, None
            )
            resposta["texto_anonimizado"] = resultado["anonymized_text"]
            resposta["ocorrencias"] = resultado["entities_found"]

        return resposta
    finally:
        # Um PDF de autos deixado em `%TEMP%` é vazamento silencioso do que este
        # produto existe para proteger, então a remoção insiste em vez de
        # desistir no primeiro erro: no Windows, um antivírus ou o próprio
        # leitor podem manter o arquivo aberto por um instante depois de
        # fechado, e um `unlink` engolido deixaria o documento para trás.
        for tentativa in range(5):
            try:
                os.unlink(caminho)
                break
            except FileNotFoundError:
                break
            except OSError:
                if tentativa == 4:
                    # Última linha de defesa: sobrescreve o conteúdo antes de
                    # desistir. O arquivo fica, mas sem o texto dos autos.
                    registro = logging.getLogger(__name__)
                    try:
                        with open(caminho, "wb") as f:
                            f.write(b"\0" * 64)
                        registro.warning(
                            "não foi possível remover o temporário %s; "
                            "o conteúdo foi sobrescrito",
                            caminho,
                        )
                    except OSError as erro:
                        # Nem apagar, nem sobrescrever: o documento inteiro
                        # ficou em %TEMP%. É o pior desfecho desta rota, e um
                        # `pass` o tornava invisível — quem opera a máquina
                        # precisa saber para ir lá remover à mão.
                        registro.error(
                            "TEMPORÁRIO NÃO REMOVIDO E NÃO SOBRESCRITO: %s — "
                            "contém o documento enviado e precisa ser apagado "
                            "à mão (%s)",
                            caminho,
                            erro,
                        )
                else:
                    time.sleep(0.2)


@router.get("/clientes")
def listar_clientes():
    """Só com o token de sessão: é a janela do aplicativo que administra isto."""
    return {"clientes": clientes.listar()}


@router.delete("/clientes/{cliente_id}")
def revogar_cliente(cliente_id: str):
    if not clientes.revogar(cliente_id):
        raise HTTPException(status_code=404, detail="cliente não encontrado")
    return {"revogado": cliente_id}


@router.get("/pedidos")
def listar_pedidos():
    """Pedidos de pareamento à espera de decisão. Consumido pela janela."""
    return {"pedidos": clientes.pedidos_pendentes()}


@router.post("/pedidos/{pedido_id}/decidir")
def decidir_pedido(pedido_id: str, aprovado: bool):
    if not clientes.decidir(pedido_id, aprovado):
        raise HTTPException(
            status_code=404, detail="pedido inexistente, expirado ou já decidido"
        )
    return {"pedido": pedido_id, "aprovado": aprovado}
