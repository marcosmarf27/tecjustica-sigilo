import { useCallback, useEffect, useRef, useState } from "react";
import { usePythonBackend } from "./hooks/usePythonBackend";
import { useLote, mensagemDoLote } from "./hooks/useLote";
import { useSalvamento } from "./hooks/useSalvamento";
import { useBiblioteca } from "./hooks/useBiblioteca";
import { ProvedorEstado, useApp } from "./estado/AppEstado";
import { DESTINOS, TrilhoNavegacao } from "./componentes/TrilhoNavegacao";
import { BarraDeTitulo } from "./componentes/BarraDeTitulo";
import { MotorCarregando, MotorComFalha } from "./componentes/PainelMotor";
import { ConsentimentoCofre } from "./componentes/ConsentimentoCofre";
import { AprovacaoDePareamento } from "./componentes/AprovacaoDePareamento";
import { Mesa } from "./telas/Mesa";
import { Documentos } from "./telas/Documentos";
import { Conversa } from "./telas/Conversa";
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

/**
 * Dois termos são o mesmo para efeito da deny-list.
 *
 * Espelha `normalize` de `python-backend/config_loader.py`: é ele que decide se
 * o termo gravado casa com a detecção. Comparando de outro jeito aqui, a lista
 * sairia da tela e a máscara continuaria — ou o contrário.
 */
function mesmoTermo(a: string, b: string): boolean {
  const forma = (t: string) =>
    t
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  return forma(a) === forma(b);
}

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
    remascarar,
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

  /* Se há chave da API guardada. Relido a cada troca de destino porque o
     usuário pode acabar de colá-la em Ajustes e voltar para a conversa. O
     valor é só a presença — a chave em si não atravessa a ponte. */
  const [temChave, setTemChave] = useState(false);
  useEffect(() => {
    void window.electronAPI?.segredo
      .resumo()
      .then((r) => setTemChave(r.presente))
      .catch(() => setTemChave(false));
  }, [estado.destino]);

  /** Resultado à espera de decisão sobre guardar no cofre. */
  const [aguardandoConsentimento, setAguardandoConsentimento] = useState<
    ProcessedFile[] | null
  >(null);

  const avisar = useCallback(
    (mensagem: string, tipo: "sucesso" | "erro" = "sucesso") =>
      despachar({ tipo: "avisar", mensagem, tipoAviso: tipo }),
    [despachar]
  );

  const { executar, cancelar } = useLote({
    despachar,
    processar,
    extractText,
    /* "unknown" e ausente querem dizer a mesma coisa — não sabemos com que
       motor este documento foi mascarado — e ter dois jeitos de dizer isso
       daria duas chances de alguém tratar só um deles. */
    modoNlp: nlpMode === "unknown" ? undefined : nlpMode,
  });
  const { salvarTodos, baixarUm } = useSalvamento({
    avisar,
    formato: prefs.formato,
    pastaDeSaida: prefs.pastaDeSaida,
  });

  /** Guarda o lote no cofre, contando o que falhou em vez de silenciar. */
  /** Caminho do arquivo → id no cofre, para o que foi guardado nesta sessão. */
  const idsNoCofre = useRef(new Map<string, string>());
  /* A gravação em andamento. Rejeitar uma detecção precisa esperá-la: a
     revisão abre antes de o cofre responder, e um clique rápido não achava id
     nenhum — a tela ficava limpa e a gravação pendente terminava guardando a
     versão com o falso positivo. */
  const gravacaoPendente = useRef<Promise<unknown> | null>(null);

  const guardarNoCofre = useCallback(
    async (arquivos: ProcessedFile[]) => {
      let guardados = 0;
      for (const arquivo of arquivos) {
        try {
          const entrada = await biblioteca.guardar(
            arquivo,
            prefs.autoArquivamento
          );
          /* O id é preciso depois: rejeitar uma detecção tem de regravar ESTE
             documento no cofre, e a revisão vinda do processamento não carrega
             id nenhum — a gravação acontece em paralelo com a tela abrindo. */
          if (entrada) idsNoCofre.current.set(arquivo.originalPath, entrada.id);
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

    /* Sai da fila o que foi processado — arquivo já anonimizado ali é convite
       para reprocessar o mesmo documento e acabar com três cópias no cofre. O
       que falhou fica, porque a fila é onde o motivo da falha está escrito, e
       porque é dali que se tenta de novo. */
    despachar({
      tipo: "tirar-da-fila",
      caminhos: resultado.processados.map((p) => p.originalPath),
    });

    if (resultado.processados.length === 0) return;

    despachar({
      tipo: "abrir-revisao",
      revisao: { arquivos: resultado.processados, origem: "processamento" },
    });

    /* Três caminhos: cofre ligado guarda direto; nunca perguntado levanta o
       consentimento; recusado antes não repete a pergunta a cada documento. */
    if (prefs.cofreLigado) {
      gravacaoPendente.current = guardarNoCofre(resultado.processados);
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

  /**
   * "Não é PII": tira o termo da anonimização agora e para sempre.
   *
   * São dois efeitos, e antes só havia o segundo. A deny-list vale dos
   * próximos documentos em diante, e o aviso mandava "processar de novo para
   * ver o efeito" — sobre um documento aberto, com a ocorrência ainda na lista
   * e a tarja ainda no texto. O revisor clicava, nada mudava, e clicava outra
   * vez.
   *
   * Reprocessar para isso custaria minutos de CPU e chegaria ao mesmo texto: a
   * detecção não muda, muda um item da lista. `/remascarar` reescreve só a
   * saída, sem NER.
   *
   * Todas as aparições do termo saem juntas, e não só a linha clicada, porque é
   * assim que a deny-list funciona — ela é por termo. Um falso positivo que o
   * motor repetiu quarenta vezes exigiria quarenta cliques para o mesmo efeito
   * que a gravação já teve.
   */
  const rejeitarDeteccao = useCallback(
    async (entidade: EntityFound, indiceArquivo: number) => {
      try {
        await adicionarNaDenyList(entidade.type, entidade.text);
      } catch (erro) {
        avisar(
          `Não foi possível gravar a exceção: ${erro instanceof Error ? erro.message : "erro desconhecido"}`,
          "erro"
        );
        return;
      }

      const arquivo = estado.revisao?.arquivos[indiceArquivo];
      if (!arquivo) {
        avisar(`"${entidade.text}" não será mais mascarado.`);
        return;
      }

      const restantes = arquivo.entitiesFound.filter(
        (e) => !(e.type === entidade.type && mesmoTermo(e.text, entidade.text))
      );
      const saindo = arquivo.entitiesFound.length - restantes.length;

      try {
        const refeito = await remascarar(
          arquivo.originalContent,
          restantes,
          /* A política com que ESTE documento foi mascarado, não a preferência
             de agora: remascarar com outra reescreveria o documento inteiro
             por efeito colateral de um clique em uma linha. */
          arquivo.politicaMascara ?? prefs.politica
        );

        const atualizado: ProcessedFile = {
          ...arquivo,
          anonymizedContent: refeito.anonymized_text,
          entitiesFound: refeito.entities_found,
        };

        despachar({
          tipo: "substituir-em-revisao",
          indice: indiceArquivo,
          arquivo: atualizado,
        });

        /* O cofre é gravado assim que o processamento termina, antes de
           qualquer revisão. Sem regravar aqui, a lista ficaria limpa na tela e
           o cofre guardaria a versão com o falso positivo — e é do cofre que a
           conversa lê. */
        await gravacaoPendente.current;
        const idNoCofre =
          estado.revisao?.idNoCofre ?? idsNoCofre.current.get(arquivo.originalPath);
        const noCofre = idNoCofre
          ? await biblioteca.atualizar(idNoCofre, atualizado)
          : false;

        avisar(
          `"${entidade.text}" saiu da lista${saindo > 1 ? ` (${saindo} ocorrências)` : ""}` +
            (noCofre ? " e do cofre." : ".")
        );
      } catch (erro) {
        /* A exceção já está gravada: vale dos próximos documentos em diante. O
           que falhou foi atualizar o que está aberto, e dizer isso é diferente
           de dizer que nada aconteceu. */
        avisar(
          `A exceção foi gravada, mas este documento não pôde ser atualizado: ${erro instanceof Error ? erro.message : "erro desconhecido"}`,
          "erro"
        );
      }
    },
    [
      adicionarNaDenyList,
      avisar,
      biblioteca,
      despachar,
      estado.revisao,
      prefs.politica,
      remascarar,
    ]
  );

  const estadoMotor =
    status === "loading" ? "carregando" : status === "error" ? "erro" : "pronto";

  useEffect(() => {
    if (estadoMotor === "pronto") recarregarClientes();
  }, [estadoMotor, recarregarClientes]);

  /* Ctrl+1…5 navegam entre os destinos, na ordem do trilho. `keydown` na
     janela, e não no trilho, porque o atalho tem de valer com o foco em
     qualquer lugar — inclusive dentro do campo da conversa. */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > DESTINOS.length) return;
      e.preventDefault();
      despachar({ tipo: "ir-para", destino: DESTINOS[n - 1].id });
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [despachar]);

  const tituloDaTela = estado.revisao
    ? "Revisão"
    : (DESTINOS.find((d) => d.id === estado.destino)?.titulo ?? "");

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
            recentes={[...biblioteca.itens]
              .sort((a, b) => b.gravadoEm.localeCompare(a.gravadoEm))
              .slice(0, 5)}
            aoAbrirRecente={abrirDaBiblioteca}
            aoVerTodos={() => despachar({ tipo: "ir-para", destino: "documentos" })}
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
            aoConversar={(ids) => despachar({ tipo: "abrir-conversa", ids })}
            aoIrParaMesa={() => despachar({ tipo: "ir-para", destino: "mesa" })}
          />
        );
      case "conversa":
        return (
          <Conversa
            ids={estado.conversaAberta}
            documentos={biblioteca.itens}
            aoEscolherDocumentos={(ids) => despachar({ tipo: "abrir-conversa", ids })}
            temChave={temChave}
            modelo={prefs.modeloDaNuvem}
            aoIrParaAjustes={() =>
              despachar({ tipo: "ir-para", destino: "ajustes" })
            }
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
    <div className="flex h-screen flex-col bg-bg">
      <BarraDeTitulo titulo={tituloDaTela} />
      <div className="flex min-h-0 flex-1">
      <TrilhoNavegacao
        destino={estado.destino}
        aoNavegar={(destino) => despachar({ tipo: "ir-para", destino })}
        estadoMotor={estadoMotor}
        modoNlp={nlpMode}
        degradado={avisoDeModo !== null}
        clientesConectados={estadoMotor === "pronto" ? clientes.length : null}
      />

      {/* `min-w-0` porque um item flex tem `min-width: auto` e não encolhe
          abaixo do próprio conteúdo. Hoje sobra espaço (o main mede 1316 e a
          tabela pede 1086), mas sem isto uma tabela mais larga — outra coluna,
          uma janela menor — empurraria o main para fora em vez de deixar o
          `overflow-x-auto` da Tabela rolar por dentro. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {conteudo()}
      </main>
      </div>

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
          if (arquivos) gravacaoPendente.current = guardarNoCofre(arquivos);
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
