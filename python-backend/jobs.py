"""
Processamento em segundo plano, com progresso e cancelamento de verdade.

Anonimizar um processo de centenas de páginas leva minutos. Uma requisição
síncrona obriga a interface a escolher entre ficar travada ou mentir: era o que
acontecia antes, com a barra parada em 0% do começo ao fim e um "cancelar" que
só desistia de esperar enquanto o Python seguia ocupando a máquina.

Aqui o trabalho roda numa thread, publica progresso a cada etapa e consulta um
sinalizador de cancelamento entre os blocos — então cancelar realmente para.
"""

from __future__ import annotations

import threading
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

# Estados possíveis, na ordem em que acontecem.
EXTRAINDO = "extraindo"
ANALISANDO = "analisando"
CONCLUIDO = "concluido"
CANCELADO = "cancelado"
ERRO = "erro"


@dataclass
class Job:
    id: str
    nome_arquivo: str
    estado: str = EXTRAINDO
    etapa: str = "Preparando"
    atual: int = 0
    total: int = 0
    resultado: dict[str, Any] | None = None
    erro: str | None = None
    criado_em: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    _cancelar: threading.Event = field(default_factory=threading.Event, repr=False)

    @property
    def cancelado(self) -> bool:
        return self._cancelar.is_set()

    def cancelar(self) -> None:
        self._cancelar.set()

    def para_json(self) -> dict[str, Any]:
        """O que a interface precisa saber — sem carregar o resultado à toa."""
        return {
            "id": self.id,
            "nome_arquivo": self.nome_arquivo,
            "estado": self.estado,
            "etapa": self.etapa,
            "atual": self.atual,
            "total": self.total,
            "erro": self.erro,
            "tem_resultado": self.resultado is not None,
        }


class RegistroDeJobs:
    """
    Guarda os trabalhos em memória. Um resultado é entregue uma vez e
    descartado: ele contém o documento inteiro, e mantê-lo por perto depois de
    lido só aumentaria o tempo em que dado pessoal fica na memória do processo.
    """

    def __init__(self, maximo: int = 20):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._maximo = maximo

    def criar(self, nome_arquivo: str) -> Job:
        job = Job(id=uuid.uuid4().hex, nome_arquivo=nome_arquivo)
        with self._lock:
            self._jobs[job.id] = job
            self._podar()
        return job

    def obter(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def descartar(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def _podar(self) -> None:
        """
        Remove os trabalhos terminados mais antigos quando passam do limite.

        Um trabalho concluído cujo resultado ainda não foi buscado fica de
        fora: descartá-lo faria a interface pedir o resultado e receber "não
        encontrado", perdendo silenciosamente um documento já processado.
        """
        if len(self._jobs) <= self._maximo:
            return

        descartaveis = sorted(
            (
                j
                for j in self._jobs.values()
                if j.estado in (CANCELADO, ERRO)
                or (j.estado == CONCLUIDO and j.resultado is None)
            ),
            key=lambda j: j.criado_em,
        )
        for job in descartaveis[: len(self._jobs) - self._maximo]:
            self._jobs.pop(job.id, None)

    def executar(self, job: Job, tarefa: Callable[[Job], dict[str, Any]]) -> None:
        """Roda a tarefa numa thread, registrando desfecho e erro."""

        def _rodar() -> None:
            try:
                resultado = tarefa(job)
                if job.cancelado:
                    job.estado = CANCELADO
                    job.etapa = "Cancelado"
                else:
                    job.resultado = resultado
                    job.estado = CONCLUIDO
                    job.etapa = "Concluído"
                    job.atual = job.total
            except Exception as exc:  # noqa: BLE001 — o erro vai para a interface
                if job.cancelado:
                    job.estado = CANCELADO
                    job.etapa = "Cancelado"
                else:
                    job.estado = ERRO
                    job.erro = str(exc) or exc.__class__.__name__
                    job.etapa = "Falhou"
                    traceback.print_exc()

        threading.Thread(target=_rodar, daemon=True, name=f"job-{job.id[:8]}").start()


registro = RegistroDeJobs()
