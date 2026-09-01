import type { AcaoApp, EstadoApp } from "./tipos";

/**
 * Reducer do estado de sessão.
 *
 * Trocar onze `useState` soltos por um reducer não é preferência de estilo: as
 * transições aqui são **acopladas**. Sair de uma revisão precisa limpar a
 * revisão e voltar o destino; encerrar um lote precisa zerar o progresso e
 * decidir para onde ir conforme houve resultado ou não. Com estados
 * independentes, cada chamador tinha de lembrar de todos os passos — e a versão
 * anterior tinha três funções (`handleBack`, `handleNewProcess`,
 * `handleOpenHistoryEntry`) que faziam combinações ligeiramente diferentes da
 * mesma limpeza.
 */
export function reducer(estado: EstadoApp, acao: AcaoApp): EstadoApp {
  switch (acao.tipo) {
    case "ir-para":
      /* Navegar fecha a revisão. Deixá-la aberta por baixo faria o trilho
         mudar de destino sem que a tela mudasse — o clique pareceria ignorado. */
      return { ...estado, destino: acao.destino, revisao: null };

    case "definir-fila":
      return {
        ...estado,
        fila: acao.arquivos.map((a) => ({ ...a, estado: "na-fila" as const })),
      };

    case "limpar-fila":
      return { ...estado, fila: [], progresso: null };

    case "estado-do-arquivo":
      return {
        ...estado,
        fila: estado.fila.map((a) =>
          a.path === acao.caminho
            ? { ...a, estado: acao.estado, motivoDaFalha: acao.motivo }
            : a
        ),
      };

    case "iniciar-lote":
      return {
        ...estado,
        revisao: null,
        progresso: {
          atual: 0,
          total: acao.total,
          nomeArquivo: acao.primeiroNome,
          etapa: "Preparando",
        },
      };

    case "progresso":
      /* Progresso que chega depois do lote encerrado é resposta atrasada de uma
         chamada cancelada. Ignorar evita a barra ressuscitar sobre a revisão. */
      return estado.progresso ? { ...estado, progresso: acao.progresso } : estado;

    case "encerrar-lote":
      return { ...estado, progresso: null };

    case "abrir-revisao":
      return { ...estado, revisao: acao.revisao, progresso: null };

    case "fechar-revisao":
      return {
        ...estado,
        revisao: null,
        destino: estado.revisao?.origem === "biblioteca" ? "documentos" : "mesa",
      };

    case "abrir-conversa":
      return {
        ...estado,
        destino: "conversa",
        conversaAberta: acao.ids,
        revisao: null,
      };

    case "fechar-conversa":
      return { ...estado, destino: "documentos", conversaAberta: null };

    case "avisar":
      return {
        ...estado,
        aviso: { mensagem: acao.mensagem, tipo: acao.tipoAviso ?? "sucesso" },
      };

    case "fechar-aviso":
      return { ...estado, aviso: null };
  }
}
