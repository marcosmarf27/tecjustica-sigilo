#!/usr/bin/env python3
"""
Servidor MCP do TecJustiça Sigilo — o motor de anonimização como ferramenta de
agente.

    tecjustica-sigilo mcp

Fala **stdio**, que é como clientes MCP (Claude Code, Claude Desktop) levantam
servidores locais. Registre assim, no `claude_desktop_config.json` ou no
`.mcp.json` do projeto:

    {
      "mcpServers": {
        "tecjustica-sigilo": {
          "command": "tecjustica-sigilo",
          "args": ["mcp"]
        }
      }
    }

## Quatro ferramentas

| ferramenta | o que faz |
|---|---|
| `anonimizar_texto` | texto entra, texto mascarado sai |
| `ler_documento` | PDF/DOCX/imagem → markdown, com OCR quando preciso |
| `ocr_imagem` | reconhece o texto de uma imagem |
| `status` | o motor está de pé? em que modo? |

## Por que isto importa para um agente

Um agente que lê autos judiciais tem um problema óbvio: o conteúdo é sigiloso, e
mandá-lo para um modelo na nuvem é o que este produto existe para evitar. Com
estas ferramentas, o agente manda o documento para cá, recebe o texto **já
mascarado**, e só então trabalha com ele.

## A mesma resolução de backend da CLI

App aberto → delega por HTTP para o motor quente. Fechado → sobe em processo,
avisando pelo stderr (nunca pelo stdout, que é o canal do protocolo).

⚠ **Nada pode ser impresso no stdout** além do protocolo MCP. Um `print` de
diagnóstico no lugar errado corrompe o fluxo JSON-RPC e o cliente desconecta
sem dizer por quê — por isso todo aviso deste módulo vai para `sys.stderr`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cliente_local as local
from mask_config import POLITICA_PADRAO, POLITICAS


def _avisar(mensagem: str) -> None:
    """Diagnóstico vai para stderr. O stdout é do protocolo."""
    print(mensagem, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# As quatro ferramentas, independentes do transporte
# ---------------------------------------------------------------------------


class Motor:
    """
    Resolve uma vez por processo e reaproveita.

    Um servidor MCP vive enquanto o agente estiver trabalhando, então vale
    carregar o motor uma vez e manter. É o oposto da CLI, que é chamada e morre.
    """

    def __init__(self) -> None:
        self._sessao = None
        self._local = None
        self._resolvido = False

    def _resolver(self) -> None:
        if self._resolvido:
            return

        self._sessao = local.app_no_ar()
        if self._sessao is not None:
            _avisar(
                f"Usando o aplicativo aberto na porta {self._sessao.porta} "
                "(motor já quente)."
            )
            self._resolvido = True
            return

        _avisar(
            "O aplicativo não está aberto: carregando o motor neste processo. "
            "Isso leva de alguns segundos a alguns minutos."
        )
        self._local = local.MotorLocal(quieto=False).__enter__()
        _avisar("Motor pronto.")

        # `_resolvido` só é marcado **depois** de o motor estar de pé. Marcá-lo
        # no começo, como estava, fazia uma falha de carregamento ser
        # definitiva: a exceção subia, mas a flag ficava ligada, e toda chamada
        # seguinte pulava a resolução e encontrava `engine` nulo — um
        # `AttributeError` obscuro no lugar do erro real, para o resto da vida
        # do processo.
        self._resolvido = True

    @property
    def remoto(self):
        self._resolver()
        return self._sessao

    @property
    def engine(self):
        self._resolver()
        return self._local.engine if self._local else None

    def token(self) -> str:
        credencial = local.ler_credencial()
        if not credencial:
            raise RuntimeError(
                "Esta instalação ainda não foi autorizada. Rode "
                "`tecjustica-sigilo conectar` e aprove na janela do aplicativo."
            )
        return credencial

    def encerrar(self) -> None:
        if self._local is not None:
            self._local.__exit__(None, None, None)
            self._local = None


MOTOR = Motor()


def ferramenta_status(_args: dict) -> str:
    sessao = local.app_no_ar()
    if sessao is None:
        return json.dumps(
            {
                "aplicativo": "fechado",
                "modo": "offline",
                "observacao": (
                    "O motor sobe neste processo. Abrir o aplicativo deixa as "
                    "chamadas muito mais rápidas."
                ),
                "credencial": bool(local.ler_credencial()),
            },
            ensure_ascii=False,
        )

    _, info = local.pedir(sessao.base, "/v1/info")
    return json.dumps(
        {
            "aplicativo": "aberto",
            "porta": sessao.porta,
            "motor": info.get("motor", {}),
            "ocr": info.get("ocr", {}),
            "entidades": info.get("entidades", []),
            "politicas": info.get("politicas", []),
            "credencial": bool(local.ler_credencial()),
        },
        ensure_ascii=False,
        indent=2,
    )


def ferramenta_anonimizar_texto(args: dict) -> str:
    texto = args.get("texto", "")
    if not texto:
        raise ValueError("`texto` é obrigatório")

    entidades = args.get("entidades") or []
    politica = args.get("politica") or POLITICA_PADRAO
    if politica not in POLITICAS:
        raise ValueError(f"política desconhecida: {politica}. Use uma de {list(POLITICAS)}")

    sessao = MOTOR.remoto
    if sessao is not None:
        status, corpo = local.pedir(
            sessao.base,
            "/v1/anonimizar",
            metodo="POST",
            corpo={"texto": texto, "entidades": entidades, "politica": politica},
            token=MOTOR.token(),
            timeout=local.TIMEOUT_LONGO_S,
        )
        if status != 200:
            raise RuntimeError(corpo.get("detail", "falha ao anonimizar"))
        return json.dumps(
            {
                "texto_anonimizado": corpo["texto_anonimizado"],
                "ocorrencias": len(corpo["ocorrencias"]),
                "por_tipo": _contar(corpo["ocorrencias"]),
            },
            ensure_ascii=False,
            indent=2,
        )

    resultado = MOTOR.engine.anonymize(
        text=texto, entities=entidades, politica_mascara=politica
    )
    return json.dumps(
        {
            "texto_anonimizado": resultado["anonymized_text"],
            "ocorrencias": len(resultado["entities_found"]),
            "por_tipo": _contar(resultado["entities_found"]),
        },
        ensure_ascii=False,
        indent=2,
    )


def _contar(ocorrencias) -> dict:
    contagem: dict[str, int] = {}
    for o in ocorrencias:
        tipo = o["type"] if isinstance(o, dict) else o.type
        contagem[tipo] = contagem.get(tipo, 0) + 1
    return contagem


def ferramenta_ler_documento(args: dict) -> str:
    caminho = Path(args.get("caminho", ""))
    if not caminho.exists():
        raise ValueError(f"arquivo não encontrado: {caminho}")

    anonimizar = args.get("anonimizar", True)

    # Diferente da API HTTP, aqui o caminho **é** aceito: um servidor MCP em
    # stdio já roda com os privilégios do usuário que o levantou, e o agente
    # que o chama é o próprio programa dele. A fronteira que a API v1 protege é
    # outra — a de uma página de navegador alcançando a porta local.
    sessao = MOTOR.remoto
    if sessao is not None:
        # Com o aplicativo aberto, o documento vai pela rota dele.
        #
        # Extrair aqui parecia equivalente e não era: quem chama
        # `documentos.configurar_ocr` é o `MotorLocal`, que só entra em cena
        # quando o app está FECHADO. Com o app aberto, `MOTOR._resolver()`
        # devolve a sessão e volta — o extrator ficava sem endereço de OCR e o
        # liteparse caía no motor embutido, o mesmo que recuperava 17,7% das
        # palavras numa matrícula datilografada e foi trocado pelo PP-OCRv6.
        # Sem erro nenhum: uma página digitalizada saía quase vazia, e o que o
        # OCR não lê nenhum recognizer mascara.
        corpo = local.enviar_documento(sessao, caminho, MOTOR.token())
        texto = corpo["texto"]
        ocr = corpo.get("ocr") or {}
        resposta = {
            "paginas": ocr.get("total_paginas", 0),
            "paginas_por_ocr": ocr.get("paginas_ocr", 0),
            "paginas_nao_lidas": ocr.get("paginas_com_erro", 0),
        }
    else:
        import documentos

        extraido = documentos.extrair(str(caminho))
        texto = extraido.como_markdown()
        resposta = {
            "paginas": extraido.total_paginas,
            "paginas_por_ocr": extraido.paginas_ocr,
            # Páginas que precisavam de OCR e não voltaram: o texto delas não
            # está aqui, e o que não está aqui não foi anonimizado nem revisado.
            "paginas_nao_lidas": extraido.paginas_com_erro,
        }

    if resposta["paginas_nao_lidas"]:
        resposta["ATENCAO"] = (
            f"{resposta['paginas_nao_lidas']} página(s) não puderam ser lidas. "
            "O texto delas não está neste resultado."
        )

    if anonimizar:
        anon = json.loads(
            ferramenta_anonimizar_texto(
                {
                    "texto": texto,
                    "entidades": args.get("entidades") or [],
                    "politica": args.get("politica") or POLITICA_PADRAO,
                }
            )
        )
        resposta["texto"] = anon["texto_anonimizado"]
        resposta["ocorrencias_mascaradas"] = anon["ocorrencias"]
        resposta["por_tipo"] = anon["por_tipo"]
    else:
        resposta["texto"] = texto
        resposta["AVISO"] = (
            "Este texto NÃO foi anonimizado e pode conter dados pessoais."
        )

    return json.dumps(resposta, ensure_ascii=False, indent=2)


def ferramenta_ocr_imagem(args: dict) -> str:
    caminho = Path(args.get("caminho", ""))
    if not caminho.exists():
        raise ValueError(f"arquivo não encontrado: {caminho}")

    MOTOR._resolver()
    import ocr_engine

    resultados = ocr_engine.reconhecer(caminho.read_bytes())
    return json.dumps(
        {
            "trechos": len(resultados),
            "texto": "\n".join(r["text"] for r in resultados),
        },
        ensure_ascii=False,
        indent=2,
    )


FERRAMENTAS = [
    {
        "name": "anonimizar_texto",
        "description": (
            "Mascara dados pessoais (CPF, CNPJ, RG, nomes, endereços, números "
            "de processo CNJ) num texto jurídico brasileiro. Roda inteiramente "
            "na máquina local — nada é enviado para fora."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "texto": {"type": "string", "description": "O texto a anonimizar."},
                "entidades": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tipos a mascarar. Vazio = todos.",
                },
                "politica": {
                    "type": "string",
                    "enum": list(POLITICAS),
                    "description": (
                        "placeholder = [PESSOA_1]; parcial = J**** d* S****; "
                        "total = *************"
                    ),
                },
            },
            "required": ["texto"],
        },
    },
    {
        "name": "ler_documento",
        "description": (
            "Lê um PDF, DOCX, XLSX ou imagem do disco e devolve o texto em "
            "markdown, com reconhecimento óptico quando a página é "
            "digitalizada. Por padrão devolve o texto já anonimizado."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "caminho": {"type": "string", "description": "Caminho do arquivo."},
                "anonimizar": {
                    "type": "boolean",
                    "description": "Padrão true. Com false, o texto sai como está nos autos.",
                },
                "entidades": {"type": "array", "items": {"type": "string"}},
                "politica": {"type": "string", "enum": list(POLITICAS)},
            },
            "required": ["caminho"],
        },
    },
    {
        "name": "ocr_imagem",
        "description": "Reconhece o texto de uma imagem com o PP-OCRv6 local.",
        "inputSchema": {
            "type": "object",
            "properties": {"caminho": {"type": "string"}},
            "required": ["caminho"],
        },
    },
    {
        "name": "status",
        "description": (
            "Diz se o aplicativo está aberto, em que modo o motor está "
            "(BERT jurídico ou spaCy leve) e se o OCR está pronto."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]

DESPACHO = {
    "anonimizar_texto": ferramenta_anonimizar_texto,
    "ler_documento": ferramenta_ler_documento,
    "ocr_imagem": ferramenta_ocr_imagem,
    "status": ferramenta_status,
}


# ---------------------------------------------------------------------------
# Transporte
# ---------------------------------------------------------------------------


def executar() -> int:
    """
    Sobe o servidor MCP em stdio.

    Usa o pacote oficial `mcp` quando disponível. Sem ele, cai para uma
    implementação mínima de JSON-RPC sobre stdio — o protocolo é simples o
    bastante para isso, e a alternativa seria o comando falhar num embarcado
    onde a dependência não entrou.
    """
    try:
        return _executar_com_sdk()
    except ImportError:
        _avisar(
            "pacote `mcp` indisponível; usando o transporte JSON-RPC embutido."
        )
        return _executar_minimo()


def _executar_com_sdk() -> int:
    """
    Transporte pelo SDK oficial (`MCPServer`, do pacote `mcp` ≥ 2).

    O SDK deriva o schema de cada ferramenta da **assinatura** da função, então
    aqui as ferramentas são declaradas com parâmetros nomeados e anotados, em
    vez do dicionário `inputSchema` que o transporte mínimo usa. As duas
    descrições precisam contar a mesma história; `FERRAMENTAS` continua sendo a
    fonte para o modo mínimo.

    Cada uma roda numa thread: são síncronas e algumas demoram muito (OCR de um
    processo inteiro), e segurar o laço de eventos travaria o protocolo.
    """
    import anyio
    from mcp.server import MCPServer

    servidor = MCPServer(
        name="tecjustica-sigilo",
        instructions=(
            "Anonimiza dados pessoais em documentos judiciais brasileiros, "
            "inteiramente na máquina local. Use antes de processar autos com "
            "qualquer modelo remoto."
        ),
    )

    async def _em_thread(funcao, argumentos: dict) -> str:
        return await anyio.to_thread.run_sync(funcao, argumentos)

    async def anonimizar_texto(
        texto: str, entidades: list[str] | None = None, politica: str = POLITICA_PADRAO
    ) -> str:
        """Mascara dados pessoais (CPF, CNPJ, RG, nomes, endereços, processos
        CNJ) num texto jurídico brasileiro. Roda 100% local."""
        return await _em_thread(
            ferramenta_anonimizar_texto,
            {"texto": texto, "entidades": entidades or [], "politica": politica},
        )

    async def ler_documento(
        caminho: str,
        anonimizar: bool = True,
        entidades: list[str] | None = None,
        politica: str = POLITICA_PADRAO,
    ) -> str:
        """Lê um PDF, DOCX, XLSX ou imagem do disco e devolve o texto em
        markdown, com OCR quando a página é digitalizada. Por padrão já
        anonimizado."""
        return await _em_thread(
            ferramenta_ler_documento,
            {
                "caminho": caminho,
                "anonimizar": anonimizar,
                "entidades": entidades or [],
                "politica": politica,
            },
        )

    async def ocr_imagem(caminho: str) -> str:
        """Reconhece o texto de uma imagem com o PP-OCRv6 local."""
        return await _em_thread(ferramenta_ocr_imagem, {"caminho": caminho})

    async def status() -> str:
        """Diz se o aplicativo está aberto, em que modo o motor está (BERT
        jurídico ou spaCy leve) e se o OCR está pronto."""
        return await _em_thread(ferramenta_status, {})

    for funcao in (anonimizar_texto, ler_documento, ocr_imagem, status):
        servidor.add_tool(funcao)

    try:
        servidor.run(transport="stdio")
    finally:
        MOTOR.encerrar()
    return 0


def _executar_minimo() -> int:
    """
    JSON-RPC 2.0 sobre stdio, delimitado por linha.

    Cobre `initialize`, `tools/list` e `tools/call`, que é o que um cliente MCP
    precisa para usar as ferramentas. Existe para o comando não morrer numa
    instalação onde o pacote `mcp` não entrou no Python embarcado — o mesmo tipo
    de falha que o `python-multipart` já causou.
    """
    saida = sys.stdout

    def responder(id_, resultado=None, erro=None) -> None:
        corpo = {"jsonrpc": "2.0", "id": id_}
        if erro is not None:
            corpo["error"] = {"code": -32000, "message": str(erro)}
        else:
            corpo["result"] = resultado
        saida.write(json.dumps(corpo, ensure_ascii=False) + "\n")
        saida.flush()

    try:
        for linha in sys.stdin:
            linha = linha.strip()
            if not linha:
                continue
            try:
                pedido = json.loads(linha)
            except json.JSONDecodeError:
                continue

            metodo = pedido.get("method")
            id_ = pedido.get("id")

            if metodo == "initialize":
                responder(
                    id_,
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {
                            "name": "tecjustica-sigilo",
                            "version": "2.0.0",
                        },
                    },
                )
            elif metodo == "tools/list":
                responder(id_, {"tools": FERRAMENTAS})
            elif metodo == "tools/call":
                parametros = pedido.get("params", {})
                funcao = DESPACHO.get(parametros.get("name", ""))
                if funcao is None:
                    responder(id_, erro=f"ferramenta desconhecida: {parametros.get('name')}")
                    continue
                try:
                    texto = funcao(parametros.get("arguments", {}))
                    responder(id_, {"content": [{"type": "text", "text": texto}]})
                except Exception as erro:
                    responder(id_, erro=erro)
            elif id_ is not None:
                responder(id_, erro=f"método não suportado: {metodo}")
    finally:
        MOTOR.encerrar()
    return 0


if __name__ == "__main__":
    sys.exit(executar())
