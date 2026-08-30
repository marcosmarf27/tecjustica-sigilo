"""
Registro de clientes pareados com a API local.

## O problema que isto resolve

A porta é dinâmica (`findAvailablePort(8123)`), o token de sessão é sorteado a
cada execução e anunciado por stdout, e os dois só existem na memória de dois
processos. Nenhum programa externo — a CLI, uma extensão do PJe, um agente
MCP — tem como alcançar o motor. Descoberta é o gap número um, e o pareamento
é o que fecha a outra metade: quem descobriu ainda precisa ser autorizado.

## Por que hash e não cifra

O plano pedia "cliente guardado cifrado". `safeStorage` vive no processo
principal do Electron, não aqui, e inventar uma cifra no Python exigiria
gerenciar uma chave — que precisaria ficar guardada em algum lugar, o que só
muda o problema de lugar.

O que se guarda é o **hash** do token, nunca o token. Quem ler este arquivo não
consegue se autenticar com ele, que é a propriedade que importa. O resto — nome,
escopos, datas — não é dado pessoal. É o mesmo raciocínio de um arquivo de
senhas: não se cifra a senha, guarda-se o digest.

O texto do documento, esse sim, é cifrado — no cofre, do lado do Electron.

## Escopos

| escopo | rota | risco |
|---|---|---|
| `anonimizar` | `POST /v1/anonimizar` (texto entra, texto sai) | baixo |
| `ocr` | `POST /v1/ocr` (bytes entram) | baixo |
| `documento` | `POST /v1/documento` (arquivo enviado, multipart) | baixo |
| `arquivo-local` | `/processar` com `caminho` | **alto** |

`arquivo-local` **nunca é concedido em pareamento**. Ele deixa quem chama pedir
a leitura de um arquivo por caminho, e é exatamente o que o aviso do `CLAUDE.md`
descreve: "`127.0.0.1` não protege nada… e `/processar` abre arquivo por
caminho". Cliente externo manda o conteúdo; quem lê o disco continua sendo só a
janela do aplicativo.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path

# Escopos que um cliente externo pode receber.
ESCOPOS_PAREAVEIS = frozenset({"anonimizar", "ocr", "documento"})

# Escopo que só a janela do aplicativo tem, e que o pareamento nunca concede.
ESCOPO_ARQUIVO_LOCAL = "arquivo-local"

TODOS_OS_ESCOPOS = ESCOPOS_PAREAVEIS | {ESCOPO_ARQUIVO_LOCAL}

# Quanto tempo um pedido de pareamento fica de pé esperando aprovação.
# Curto de propósito: o código aparece nos dois lados e a pessoa aprova na hora.
# Um pedido que sobrevive à tarde inteira vira uma aprovação distraída.
VALIDADE_DO_PEDIDO_S = 180

_LOCK = threading.Lock()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _arquivo_registro() -> Path:
    """
    Onde o registro mora.

    `PRESIDIO_DADOS` é entregue pelo Electron e aponta para o `userData`. Sem
    ela — CLI em modo offline, testes — o registro é de sessão: fica ao lado do
    módulo, num arquivo que não sobrevive a nada importante. É a escolha certa
    para um processo efêmero, que não deveria criar clientes permanentes.
    """
    base = os.environ.get("PRESIDIO_DADOS", "").strip()
    raiz = Path(base) if base else Path(__file__).parent
    return raiz / "clientes.json"


@dataclass
class Cliente:
    id: str
    nome: str
    escopos: list[str]
    criado_em: float
    ultimo_uso: float | None = None
    origem: str | None = None
    hash_token: str = ""

    def publico(self) -> dict:
        """Sem o hash: a interface lista clientes, não credenciais."""
        d = asdict(self)
        d.pop("hash_token")
        return d


@dataclass
class PedidoDePareamento:
    id: str
    nome: str
    escopos: list[str]
    codigo: str
    criado_em: float
    origem: str | None = None
    # None = pendente. True = aprovado. False = negado.
    decisao: bool | None = None
    token: str | None = field(default=None, repr=False)
    # O token só é entregue uma vez; depois disso some daqui.
    entregue: bool = False

    def expirado(self) -> bool:
        return time.time() - self.criado_em > VALIDADE_DO_PEDIDO_S

    def publico(self) -> dict:
        return {
            "id": self.id,
            "nome": self.nome,
            "escopos": self.escopos,
            "codigo": self.codigo,
            "criado_em": self.criado_em,
            "origem": self.origem,
        }


# Pedidos vivem só em memória: são efêmeros por natureza e não devem
# sobreviver a um reinício do backend.
_pedidos: dict[str, PedidoDePareamento] = {}


def _carregar() -> dict[str, Cliente]:
    arquivo = _arquivo_registro()
    if not arquivo.exists():
        return {}
    try:
        with arquivo.open(encoding="utf-8") as f:
            bruto = json.load(f)
        return {c["id"]: Cliente(**c) for c in bruto}
    except Exception:
        # Registro corrompido não pode impedir o backend de subir. O custo é
        # ter de parear de novo, que é recuperável; não subir, não é.
        return {}


def _gravar(clientes: dict[str, Cliente]) -> None:
    """
    Grava o registro em claro — e o que fica em claro está limitado de propósito.

    O que **não** fica: o token. Só o SHA-256 dele. Quem ler este arquivo não
    consegue se passar por um cliente pareado.

    O que fica: `id`, `nome`, `origem`, escopos e carimbos de tempo. `nome` e
    `origem` vêm do cliente e podem trazer identificação de pessoa se ele
    escolher mandar ("Automação de Fulano de Tal"). Não são cifrados porque
    cifrá-los exigiria uma chave que este processo Python teria de guardar em
    algum lugar — e uma chave ao lado do arquivo cifrado não protege de nada,
    além de o registro precisar ser legível na abertura, antes de qualquer
    janela existir. O cofre pode cifrar porque a chave é do sistema (DPAPI, via
    Electron); aqui não há esse recurso.

    A defesa, então, é não pedir esse dado: `docs/api-local.md` orienta o autor
    do cliente a usar um nome de **programa** ("Extensão PJe"), nunca de pessoa.
    """
    arquivo = _arquivo_registro()
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    conteudo = json.dumps(
        [asdict(c) for c in clientes.values()], ensure_ascii=False, indent=2
    )
    # Temporário + replace: atômico, para uma queda no meio não deixar um JSON
    # truncado que derrubaria a próxima leitura. `newline="\n"` explícito porque
    # no Windows a gravação em modo texto trocaria `\n` por `\r\n`.
    temporario = arquivo.with_suffix(".json.tmp")
    with temporario.open("w", encoding="utf-8", newline="\n") as f:
        f.write(conteudo)
    os.replace(temporario, arquivo)


def listar() -> list[dict]:
    with _LOCK:
        return [c.publico() for c in _carregar().values()]


def criar_pedido(
    nome: str, escopos: list[str], origem: str | None = None
) -> PedidoDePareamento:
    """
    Abre um pedido de pareamento e devolve o código a mostrar nos dois lados.

    Escopos fora dos pareáveis são **descartados em silêncio** aqui, e isso é
    deliberado: pedir `arquivo-local` não é erro do cliente, é um pedido que
    simplesmente não se concede. Ele recebe o pareamento sem esse escopo e leva
    403 se tentar usá-lo — o que é a resposta certa, e visível.
    """
    limpos = sorted(set(escopos) & ESCOPOS_PAREAVEIS)

    pedido = PedidoDePareamento(
        id=secrets.token_urlsafe(16),
        nome=(nome or "cliente sem nome").strip()[:80],
        escopos=limpos,
        # Seis caracteres sem dígitos ambíguos: quem confere lê em voz alta ou
        # compara de relance, e 0/O e 1/I atrapalham exatamente isso.
        codigo="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6)),
        criado_em=time.time(),
        origem=origem,
    )
    with _LOCK:
        # Aproveita para varrer os expirados, para a lista não crescer sozinha.
        for pid in [p for p, v in _pedidos.items() if v.expirado()]:
            _pedidos.pop(pid, None)
        _pedidos[pedido.id] = pedido
    return pedido


def pedidos_pendentes() -> list[dict]:
    with _LOCK:
        return [
            p.publico()
            for p in _pedidos.values()
            if p.decisao is None and not p.expirado()
        ]


def decidir(pedido_id: str, aprovado: bool) -> bool:
    """Aprova ou nega um pedido. Devolve False se ele não existe ou expirou."""
    with _LOCK:
        pedido = _pedidos.get(pedido_id)
        if pedido is None or pedido.expirado() or pedido.decisao is not None:
            return False

        pedido.decisao = aprovado
        if not aprovado:
            return True

        token = secrets.token_urlsafe(32)
        pedido.token = token

        cliente = Cliente(
            id=secrets.token_urlsafe(12),
            nome=pedido.nome,
            escopos=pedido.escopos,
            criado_em=time.time(),
            origem=pedido.origem,
            hash_token=_hash_token(token),
        )
        registro = _carregar()
        registro[cliente.id] = cliente
        _gravar(registro)
        return True


def consultar_pedido(pedido_id: str) -> tuple[str, str | None]:
    """
    Estado de um pedido, do ponto de vista de quem pediu.

    Devolve `("pendente"|"aprovado"|"negado"|"desconhecido", token)`. O token
    sai **uma vez só**: na segunda consulta o pedido já está marcado como
    entregue e responde "desconhecido". Quem perdeu o token pareia de novo, que
    é mais barato do que deixar uma credencial disponível para releitura.
    """
    with _LOCK:
        pedido = _pedidos.get(pedido_id)
        if pedido is None or pedido.expirado():
            return "desconhecido", None
        if pedido.decisao is None:
            return "pendente", None
        if pedido.decisao is False:
            return "negado", None
        if pedido.entregue:
            return "desconhecido", None

        pedido.entregue = True
        token = pedido.token
        pedido.token = None
        return "aprovado", token


def autenticar(token: str) -> Cliente | None:
    """
    Encontra o cliente dono deste token e registra o uso.

    A comparação é feita sobre o hash, com `compare_digest`, para não vazar
    informação pelo tempo de resposta.
    """
    if not token:
        return None
    alvo = _hash_token(token)
    with _LOCK:
        registro = _carregar()
        for cliente in registro.values():
            if secrets.compare_digest(cliente.hash_token, alvo):
                cliente.ultimo_uso = time.time()
                _gravar(registro)
                return cliente
    return None


def revogar(cliente_id: str) -> bool:
    with _LOCK:
        registro = _carregar()
        if cliente_id not in registro:
            return False
        del registro[cliente_id]
        _gravar(registro)
        return True


def escopo_da_rota(caminho: str, metodo: str) -> str | None:
    """
    Qual escopo a rota exige. `None` = só o token de sessão serve.

    Tudo que não estiver mapeado aqui fica fora do alcance de cliente externo
    por omissão — inclusive `/processar`, `/anonymize` e a deny-list. É a
    escolha certa para o padrão: uma rota nova nasce inacessível e passa a ser
    alcançável quando alguém decidir que deve, em vez do contrário.
    """
    if caminho == "/v1/anonimizar":
        return "anonimizar"
    if caminho == "/v1/ocr":
        return "ocr"
    if caminho == "/v1/documento":
        return "documento"
    return None
