import { useCallback, useEffect, useState } from "react";
import { usePythonBackend } from "./hooks/usePythonBackend";
import { useLote, mensagemDoLote } from "./hooks/useLote";
import { useSalvamento } from "./hooks/useSalvamento";
import { useBiblioteca } from "./hooks/useBiblioteca";
import { ProvedorEstado, useApp } from "./estado/AppEstado";
import { TrilhoNavegacao } from "./componentes/TrilhoNavegacao";
import { MotorCarregando, MotorComFalha } from "./componentes/PainelMotor";
import { ConsentimentoCofre } from "./componentes/ConsentimentoCofre";
import { AprovacaoDePareamento } from "./componentes/AprovacaoDePareamento";
import { Mesa } from "./telas/Mesa";
import { Documentos } from "./telas/Documentos";
import { Conexoes } from "./telas/Conexoes";
import { Ajustes } from "./telas/Ajustes";
import { Revisao } from "./telas/Revisao";
import { Toast } from "./components/Toast";
import type { EntityFound, ProcessedFile } from "./types";
import type { ClientePareado } from "./hooks/usePythonBackend";

/**
 * Casca do aplicativo: trilho fixo à esquerda, destino à direita.
 *
 * Este arquivo tinha 546 linhas e continha o estado inteiro, a orquestração do
 * lote, a gravação em disco, as telas de carregamento e erro, e o JSX de todas
 * as telas. Agora é casca e roteador; cada peça foi para o seu lugar
 * (`estado/`, `hooks/`, `telas/`).
 *
 * A mudança estrutural que importa: carregamento e erro do motor **não** são
 * mais `return` antecipados. Eles renderizam ao lado do trilho, que fica
 * sempre montado.
 */

function Casca() {
  const {
    status,
    enderecoApi,
    nlpMode,
    avisoDeModo,
    processar,
    extractText,
    reconectar,
    adicionarNaDenyList,
    buscarDenyList,
    gravarDenyList,
    listarClientes,
    revogarCliente,
    listarPedidos,
    decidirPedido,
  } = usePythonBackend();

  const { estado, despachar, prefs, definirPref } = useApp();
  const biblioteca = useBiblioteca(prefs.cofreLigado, prefs.diasDeExpurgo);

  /**
   * Clientes pareados, mantidos aqui porque **dois** consumidores precisam
   * deles: o rodapé do trilho ("API · 2 clientes", sempre visível) e a tela de
   * Conexões. Buscar nos dois lugares faria duas chamadas para a mesma coisa.
   */
  const [clientes, setClientes] = useState<ClientePareado[]>([]);

  const recarregarClientes = useCallback(async () => {
    try {
      setClientes(await listarClientes());
    } catch {
      // Backend ainda subindo, ou fora do Electron. Sem clientes a mostrar.
    }
  }, [listarClientes]);

  /** Resultado à espera de decisão sobre guardar no cofre. */
  const [aguardandoConsentimento, setAguardandoConsentimento] = useState<
    ProcessedFile[] | null
  >(null);

  const avisar = useCallback(
    (mensagem: string, tipo: "sucesso" | "erro" = "sucesso") =>
      despachar({ tipo: "avisar", mensagem, tipoAviso: tipo }),
    [despachar]
  );

  const { executar, cancelar } = useLote({ despachar, processar, extractText });
  const { salvarTodos, baixarUm } = useSalvamento({
    avisar,
    formato: prefs.formato,
    pastaDeSaida: prefs.pastaDeSaida,
  });

  /** Guarda o lote no cofre, contando o que falhou em vez de silenciar. */
  const guardarNoCofre = useCallback(
    async (arquivos: ProcessedFile[]) => {
      let guardados = 0;
      for (const arquivo of arquivos) {
        try {
          await biblioteca.guardar(arquivo, prefs.autoArquivamento);
          guardados++;
        } catch (erro) {
          /* Falha aqui é quase sempre cofre indisponível — e o usuário precisa
             saber, porque acabou de pedir para guardar. Anunciar sucesso sobre
             uma gravação recusada é o pior desfecho possível. */
          avisar(
            `Não foi possível guardar ${arquivo.originalName}: ${
              erro instanceof Error ? erro.message : "erro desconhecido"
            }`,
            "erro"
          );
          return guardados;
        }
      }
      if (guardados > 0) {
        avisar(
          `${guardados} documento${guardados > 1 ? "s" : ""} no cofre, cifrado${guardados > 1 ? "s" : ""}.`
        );
      }
      return guardados;
    },
    [biblioteca, prefs.autoArquivamento, avisar]
  );

  const anonimizar = useCallback(async () => {
    if (estado.fila.length === 0 || prefs.entidades.length === 0) return;

    /* O `try` existe porque a alternativa é o sumiço.
       Sem ele, qualquer exceção que escapasse do lote rejeitava esta promise
       sem tratamento: a tela de progresso fechava pelo `finally` do `executar`
       e o aplicativo voltava para a Mesa **sem uma palavra** — o usuário via
       "começou, parou e voltou", e nem quem fosse consertar tinha por onde
       começar. Falhar é aceitável; falhar em silêncio, não. */
    let resultado;
    try {
      resultado = await executar(estado.fila, prefs.entidades, prefs.politica);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : "erro desconhecido";
      console.error("O lote foi interrompido:", erro);
      avisar(`O processamento foi interrompido: ${motivo}`, "erro");
      return;
    }

    const aviso = mensagemDoLote(resultado, estado.fila.length);
    if (aviso) avisar(aviso.mensagem, aviso.tipo);

    if (resultado.processados.length === 0) return;

    despachar({
      tipo: "abrir-revisao",
      revisao: { arquivos: resultado.processados, origem: "processamento" },
    });

    /* Três caminhos: cofre ligado guarda direto; nunca perguntado levanta o
       consentimento; recusado antes não repete a pergunta a cada documento. */
    if (prefs.cofreLigado) {
      guardarNoCofre(resultado.processados);
    } else if (!prefs.cofrePerguntado && biblioteca.disponivel) {
      setAguardandoConsentimento(resultado.processados);
    }
  }, [
    estado.fila,
    prefs.entidades,
    prefs.politica,
    prefs.cofreLigado,
    prefs.cofrePerguntado,
    biblioteca.disponivel,
    executar,
    avisar,
    despachar,
    guardarNoCofre,
  ]);

  const abrirDaBiblioteca = useCallback(
    async (item: EntradaDoCofre) => {
      const arquivo = await biblioteca.abrir(item);
      if (!arquivo) {
        avisar(
          "Não foi possível ler este documento do cofre. Ele pode ter sido gravado por outra conta de usuário.",
          "erro"
        );
        return;
      }
      despachar({
        tipo: "abrir-revisao",
        revisao: {
          arquivos: [arquivo],
          origem: "biblioteca",
          idNoCofre: item.id,
        },
      });
    },
    [biblioteca, avisar, despachar]
  );

  const rejeitarDeteccao = useCallback(
    async (entidade: EntityFound) => {
      try {
        await adicionarNaDenyList(entidade.type, entidade.text);
        avisar(
          `"${entidade.text}" não será mais mascarado. Processe de novo para ver o efeito.`
        );
      } catch (erro) {
        avisar(
          `Não foi possível gravar a exceção: ${erro instanceof Error ? erro.message : "erro desconhecido"}`,
          "erro"
        );
      }
    },
    [adicionarNaDenyList, avisar]
  );

  const estadoMotor =
    status === "loading" ? "carregando" : status === "error" ? "erro" : "pronto";

  useEffect(() => {
    if (estadoMotor === "pronto") recarregarClientes();
  }, [estadoMotor, recarregarClientes]);

  /* A revisão sobrepõe o destino; fora dela, o destino manda. Carregamento e
     erro do motor só bloqueiam a Mesa: Ajustes, Documentos e Conexões
     continuam úteis enquanto o motor sobe ou depois que ele falha. */
  const conteudo = () => {
    if (estado.revisao) {
      return (
        <Revisao
          aoSalvarTodos={() => salvarTodos(estado.revisao!.arquivos)}
          aoBaixarArquivo={baixarUm}
          aoRejeitarDeteccao={rejeitarDeteccao}
        />
      );
    }

    switch (estado.destino) {
      case "mesa":
        if (estadoMotor === "carregando")
          return <MotorCarregando modoNlp={nlpMode} />;
        if (estadoMotor === "erro")
          return <MotorComFalha aoTentarDeNovo={reconectar} />;
        return (
          <Mesa
            aoAnonimizar={anonimizar}
            aoCancelar={cancelar}
            motorPronto={estadoMotor === "pronto"}
          />
        );
      case "documentos":
        return (
          <Documentos
            itens={biblioteca.itens}
            cofreDisponivel={biblioteca.disponivel}
            cofreLigado={prefs.cofreLigado}
            expurgados={biblioteca.expurgados}
            aoAbrir={abrirDaBiblioteca}
            aoApagar={biblioteca.apagar}
          />
        );
      case "conexoes":
        return (
          <Conexoes
            enderecoApi={enderecoApi}
            motorPronto={estadoMotor === "pronto"}
            avisar={avisar}
            clientes={clientes}
            aoRecarregar={recarregarClientes}
            revogarCliente={revogarCliente}
          />
        );
      case "ajustes":
        return (
          <Ajustes
            modoNlp={nlpMode}
            avisoDeModo={avisoDeModo}
            cofreDisponivel={biblioteca.disponivel}
            itensNoCofre={biblioteca.itens.length}
            aoEsvaziarCofre={async () => {
              await biblioteca.esvaziar();
              avisar("Cofre esvaziado.");
            }}
            buscarDenyList={buscarDenyList}
            gravarDenyList={gravarDenyList}
            avisar={avisar}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-bg">
      <TrilhoNavegacao
        destino={estado.destino}
        aoNavegar={(destino) => despachar({ tipo: "ir-para", destino })}
        estadoMotor={estadoMotor}
        modoNlp={nlpMode}
        degradado={avisoDeModo !== null}
        clientesConectados={estadoMotor === "pronto" ? clientes.length : null}
      />

      <main className="flex flex-1 flex-col overflow-hidden">{conteudo()}</main>

      {/* Na casca, não na tela de Conexões: quem roda `tecjustica-sigilo
          conectar` olha para a janela, que pode estar em qualquer destino. */}
      <AprovacaoDePareamento
        ativo={estadoMotor === "pronto"}
        listarPedidos={listarPedidos}
        decidirPedido={decidirPedido}
        avisar={avisar}
        aoAprovar={recarregarClientes}
      />

      <ConsentimentoCofre
        aberto={aguardandoConsentimento !== null}
        nomeDoDocumento={
          aguardandoConsentimento?.[0]?.originalName ?? "este documento"
        }
        aoAceitar={() => {
          const arquivos = aguardandoConsentimento;
          definirPref("cofreLigado", true);
          definirPref("cofrePerguntado", true);
          setAguardandoConsentimento(null);
          if (arquivos) guardarNoCofre(arquivos);
        }}
        aoRecusar={() => {
          definirPref("cofrePerguntado", true);
          setAguardandoConsentimento(null);
        }}
      />

      {estado.aviso && (
        <Toast
          message={estado.aviso.mensagem}
          type={estado.aviso.tipo === "erro" ? "error" : "success"}
          onClose={() => despachar({ tipo: "fechar-aviso" })}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ProvedorEstado>
      <Casca />
    </ProvedorEstado>
  );
}
