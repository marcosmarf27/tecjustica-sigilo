"""
Como a CLI e o servidor MCP encontram — ou levantam — o motor.

## A decisão de arquitetura

**A CLI é cliente fino, não uma segunda cópia do motor.** Carregar o BERT custa
minutos e ~2,5 GB de memória. Uma CLI que sobe o próprio motor a cada chamada é
inútil para script: dez arquivos num laço seriam dez carregamentos.

Então:

- app aberto → delega por HTTP, com o motor **já quente**;
- app fechado → sobe em processo, **avisando o custo** antes de o usuário
  esperar sem entender por quê.

`--offline` força o local; `--remoto` força falhar em vez de esperar o
carregamento.

## Descoberta

`sessao.json`, no `userData` do aplicativo, traz porta e pid — e **não** traz
token. Essa é a fronteira: uma página de navegador não lê arquivo, um programa
local lê. Quem descobre a porta ainda precisa parear para obter credencial, e o
pareamento exige aprovação humana com código visível nos dois lados.

O token do cliente, esse sim, fica guardado aqui do lado, em `credencial.json` —
é do próprio usuário, no perfil dele, e serve para não ter de parear a cada
comando.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import urllib.error
import urllib.request

# Os dois nomes que a pasta de dados pode ter, e por que são dois.
#
# `app.getPath("userData")` deriva de `app.getName()`. Em **desenvolvimento**
# isso vem do campo `name` do `package.json` (`tecjustica-sigilo`); no app
# **empacotado**, o electron-builder aplica o `productName` e a pasta vira
# `TecJustiça Sigilo`. O caminho, portanto, muda conforme o app foi iniciado.
#
# Cravar só o nome de produção fazia a CLI funcionar depois de instalada e
# falhar em desenvolvimento — o pior tipo de bug para diagnosticar, porque o
# sintoma é "funciona na máquina do usuário e não na minha". Procurar nos dois
# custa um `exists()` e cobre os dois mundos.
NOMES_DA_PASTA = ("TecJustiça Sigilo", "tecjustica-sigilo")

# Quanto esperar por uma resposta do app já quente. Anonimizar um processo
# inteiro leva minutos, então o limite é generoso; o que ele evita é a espera
# infinita quando o backend morreu sem fechar a porta.
TIMEOUT_LONGO_S = 30 * 60
TIMEOUT_CURTO_S = 15


def _raizes_de_dados() -> list[Path]:
    """
    Onde o `userData` do Electron pode estar, na convenção de cada sistema.

    Devolve os candidatos em ordem: primeiro o nome de produção, depois o de
    desenvolvimento. Ver a nota em `NOMES_DA_PASTA`.
    """
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        bases = [Path(base)] if base else []
    elif sys.platform == "darwin":
        bases = [Path.home() / "Library" / "Application Support"]
    else:
        bases = [Path.home() / ".config"]

    return [base / nome for base in bases for nome in NOMES_DA_PASTA]


def _achar(nome_do_arquivo: str) -> Path | None:
    """O primeiro candidato que existe de verdade."""
    for raiz in _raizes_de_dados():
        caminho = raiz / nome_do_arquivo
        if caminho.exists():
            return caminho
    return None


def _onde_gravar(nome_do_arquivo: str) -> Path:
    """
    Onde gravar um arquivo novo.

    Se já existe em algum candidato, grava lá. Senão, ao lado do `sessao.json`
    — que é a pasta que o app realmente usa nesta instalação. Só quando nem
    isso existe é que o primeiro candidato serve de padrão.
    """
    existente = _achar(nome_do_arquivo)
    if existente:
        return existente
    sessao = _achar("sessao.json")
    if sessao:
        return sessao.parent / nome_do_arquivo
    return _raizes_de_dados()[0] / nome_do_arquivo


@dataclass
class Sessao:
    porta: int
    pid: int
    api: str

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.porta}"


def ler_sessao() -> Sessao | None:
    """A sessão publicada pelo app, se ele estiver de pé."""
    arquivo = _achar("sessao.json")
    if arquivo is None:
        return None
    try:
        with arquivo.open(encoding="utf-8") as f:
            bruto = json.load(f)
        sessao = Sessao(
            porta=int(bruto["porta"]),
            pid=int(bruto.get("pid", 0)),
            api=str(bruto.get("api", "habilitada")),
        )
    except Exception:
        return None

    if sessao.api != "habilitada":
        return None
    return sessao


def ler_credencial() -> str | None:
    arquivo = _achar("credencial.json")
    if arquivo is None:
        return None
    try:
        with arquivo.open(encoding="utf-8") as f:
            return json.load(f).get("token")
    except Exception:
        return None


def gravar_credencial(token: str) -> Path:
    arquivo = _onde_gravar("credencial.json")
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    # `newline="\n"` explícito: no Windows a gravação em modo texto trocaria
    # `\n` por `\r\n`, e o hábito no projeto é manter os bytes previsíveis.
    with arquivo.open("w", encoding="utf-8", newline="\n") as f:
        json.dump({"token": token}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return arquivo


def pedir(
    base: str,
    caminho: str,
    *,
    metodo: str = "GET",
    corpo: dict | None = None,
    token: str | None = None,
    timeout: float = TIMEOUT_CURTO_S,
) -> tuple[int, dict]:
    """Requisição HTTP simples, sem dependência externa. Devolve (status, json)."""
    dados = None
    cabecalhos = {"Accept": "application/json"}
    if corpo is not None:
        dados = json.dumps(corpo).encode("utf-8")
        cabecalhos["Content-Type"] = "application/json"
    if token:
        cabecalhos["X-Presidio-Token"] = token

    requisicao = urllib.request.Request(
        f"{base}{caminho}", data=dados, headers=cabecalhos, method=metodo
    )
    try:
        with urllib.request.urlopen(requisicao, timeout=timeout) as resposta:
            texto = resposta.read().decode("utf-8")
            return resposta.status, (json.loads(texto) if texto else {})
    except urllib.error.HTTPError as erro:
        texto = erro.read().decode("utf-8", errors="replace")
        try:
            return erro.code, json.loads(texto)
        except Exception:
            return erro.code, {"detail": texto}
    except Exception as erro:
        # Conexão recusada, DNS, timeout: o app não está lá.
        return 0, {"detail": str(erro)}


# A assinatura que `/v1/info` devolve. Confirma que quem atendeu é este produto,
# e não outro programa qualquer que ficou com a porta.
PRODUTO = "TecJustiça Sigilo"
API = 1


def app_no_ar() -> Sessao | None:
    """
    A sessão, confirmada por uma chamada real a `/v1/info` **que se identifica**.

    Status 200 não basta, e a diferença é um vazamento. O `sessao.json` fica
    órfão sempre que o aplicativo morre sem passar pelo `before-quit` — queda de
    energia, fim de processo pelo gerenciador de tarefas. A porta 8123 volta ao
    pool e outro programa pode pegá-la. Se esse programa responder 200 com um
    JSON qualquer em `/v1/info`, a checagem antiga aprovava, e o passo seguinte
    da CLI é um POST com o **conteúdo dos autos** para ele. Justamente o que
    este produto existe para impedir.

    (Um servidor que devolve HTML já era recusado por acidente: o `pedir` não
    consegue interpretar a resposta e retorna status 0. Acidente não é defesa.)

    O `sessao.ts` descreve como defesa "conferir se o `pid` ainda existe", e o
    cliente de referência nunca conferiu — a promessa vivia só no comentário.
    A conferência de identidade é mais forte e não tem a armadilha do pid: um
    `pid` reciclado passaria, e pior, `os.kill(pid, 0)` — o idioma POSIX para
    "esse processo existe?" — no Windows chama `TerminateProcess`. A checagem
    ingênua **mataria o aplicativo** em vez de perguntar por ele.
    """
    sessao = ler_sessao()
    if sessao is None:
        return None

    status, corpo = pedir(sessao.base, "/v1/info", timeout=3)
    if status != 200:
        return None
    if not isinstance(corpo, dict):
        return None
    if corpo.get("produto") != PRODUTO or corpo.get("api") != API:
        return None
    return sessao


def enviar_documento(sessao: Sessao, caminho: Path, token: str) -> dict:
    """
    Manda o arquivo para `/v1/documento` do aplicativo aberto.

    Vive aqui, e não no `cli.py`, porque **todo** cliente que fala com o app
    tem de usar este caminho. O servidor MCP extraía o documento no próprio
    processo mesmo com o aplicativo aberto, e a diferença não era de desempenho:
    o `MotorLocal` é quem chama `documentos.configurar_ocr`, então, pulando-o, o
    liteparse caía no OCR embutido — o mesmo que recuperava 17,7% das palavras
    numa matrícula datilografada e motivou a troca pelo PP-OCRv6. Sem erro
    nenhum: saía um documento mutilado com cara de completo.

    O conteúdo vai; o caminho, não. É a fronteira do desenho — quem abre arquivo
    por caminho continua sendo só a janela.
    """
    import mimetypes
    import uuid

    limite = f"----tecjustica{uuid.uuid4().hex}"
    tipo = mimetypes.guess_type(caminho.name)[0] or "application/octet-stream"

    corpo = bytearray()
    corpo += f"--{limite}\r\n".encode()
    corpo += (
        f'Content-Disposition: form-data; name="file"; filename="{caminho.name}"\r\n'
    ).encode()
    corpo += f"Content-Type: {tipo}\r\n\r\n".encode()
    corpo += caminho.read_bytes()
    corpo += f"\r\n--{limite}--\r\n".encode()

    requisicao = urllib.request.Request(
        f"{sessao.base}/v1/documento",
        data=bytes(corpo),
        headers={
            "Content-Type": f"multipart/form-data; boundary={limite}",
            "X-Presidio-Token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(requisicao, timeout=TIMEOUT_LONGO_S) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Modo offline: motor em processo
# ---------------------------------------------------------------------------


class MotorLocal:
    """
    Motor carregado neste processo, com o OCR ligado num servidor efêmero.

    ## Por que existe um servidor de OCR aqui dentro

    O liteparse **não aceita motor de OCR injetado em processo**: o único ponto
    de extensão é `ocr_server_url`, um endereço HTTP. Então o modo offline sobe
    o `_servidor_autonomo()` do `ocr_engine` numa porta efêmera, aponta o
    liteparse para ele e o derruba ao terminar.

    Sem isso, o liteparse cai **em silêncio** no Tesseract embutido no wheel — o
    motor descartado por recuperar 17,7% das palavras numa matrícula
    datilografada. E o que o OCR não lê, nenhum recognizer detecta: sairia um
    documento mutilado com cara de completo.
    """

    def __init__(self, quieto: bool = False) -> None:
        self.quieto = quieto
        self._processo_ocr = None
        self._porta_ocr = 0
        self._engine = None

    def _avisar(self, mensagem: str) -> None:
        if not self.quieto:
            print(mensagem, file=sys.stderr, flush=True)

    def __enter__(self) -> "MotorLocal":
        import socket
        import subprocess
        import time

        from engine import get_engine

        # Porta efêmera pedida ao sistema, para não colidir com nada.
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self._porta_ocr = s.getsockname()[1]

        self._avisar(
            "O aplicativo não está aberto: carregando o motor neste processo.\n"
            "Isso leva de alguns segundos a alguns minutos, e repete a cada\n"
            "comando. Com o aplicativo aberto, o motor já está quente."
        )

        self._processo_ocr = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "ocr_engine",
                "--port",
                str(self._porta_ocr),
            ],
            cwd=str(Path(__file__).parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # O servidor autônomo não tem token: fica em 127.0.0.1 e some ao fim do
        # comando. É a mesma escolha que o bench já fazia.
        import documentos

        documentos.configurar_ocr(f"http://127.0.0.1:{self._porta_ocr}/ocr", {})

        # Espera curta pela porta abrir, para o primeiro documento não falhar.
        for _ in range(100):
            with socket.socket() as s:
                s.settimeout(0.1)
                if s.connect_ex(("127.0.0.1", self._porta_ocr)) == 0:
                    break
            time.sleep(0.1)

        # A partir daqui há um processo filho vivo, e `__exit__` **não** será
        # chamado se algo falhar antes de `__enter__` retornar — o `with` só
        # arma a limpeza depois que o corpo do `__enter__` termina. Sem este
        # try, um erro ao carregar o modelo deixaria o servidor de OCR rodando
        # sozinho, segurando uma porta, até alguém matá-lo à mão.
        try:
            self._engine = get_engine()
            self._engine.initialize()
        except BaseException:
            self.__exit__(None, None, None)
            raise

        self._avisar(f"Motor pronto (modo={self._engine.nlp_mode}).")
        return self

    def __exit__(self, *_) -> None:
        if self._processo_ocr is not None:
            self._processo_ocr.terminate()
            try:
                self._processo_ocr.wait(timeout=5)
            except Exception:
                self._processo_ocr.kill()
            self._processo_ocr = None

    @property
    def engine(self):
        return self._engine
