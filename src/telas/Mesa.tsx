import { useApp } from "../estado/AppEstado";
import { AreaDeSoltar } from "../componentes/AreaDeSoltar";
import { Receita } from "../componentes/Receita";
import { ProcessingView } from "../components/ProcessingView";
import { Botao, CabecalhoDeTela, Cartao, Icone } from "../ui";
import type { FileItem } from "../types";

/**
 * Mesa — a tela onde se anonimiza, e a primeira que se vê.
 *
 * Área de soltar, a receita, um botão. O caminho normal custa **duas ações**:
 * soltar o arquivo e clicar em Anonimizar. Contra os ~17 controles que a versão
 * anterior pedia a cada vez, porque nenhuma escolha sobrevivia ao fechamento.
 *
 * O que mudou de fato não foi a quantidade de opções — são as mesmas —, foi
 * quem carrega o custo delas. Antes, todas estavam abertas na tela o tempo
 * todo; agora ficam dentro da frase, e só quem quer mudar alguma paga o clique.
 *
 * Embaixo, os últimos documentos guardados. É o que transforma a Mesa de uma
 * caixa de soltar numa tela inicial: quem abre o aplicativo para continuar o
 * de ontem encontra o de ontem aqui, sem passar por Documentos.
 */

interface MesaProps {
  aoAnonimizar: () => void;
  aoCancelar: () => void;
  motorPronto: boolean;
  /** Os últimos documentos do cofre, mais recentes primeiro. */
  recentes: EntradaDoCofre[];
  aoAbrirRecente: (item: EntradaDoCofre) => void;
  aoVerTodos: () => void;
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function Mesa({
  aoAnonimizar,
  aoCancelar,
  motorPronto,
  recentes,
  aoAbrirRecente,
  aoVerTodos,
}: MesaProps) {
  const { estado, despachar, prefs } = useApp();
  const { fila, progresso } = estado;

  // Enquanto o lote roda, a mesa dá lugar ao andamento.
  if (progresso) {
    return (
      <ProcessingView
        current={progresso.atual}
        total={progresso.total}
        fileName={progresso.nomeArquivo}
        phase={progresso.etapa}
        onCancelar={aoCancelar}
      />
    );
  }

  const definirArquivos = (arquivos: FileItem[]) =>
    despachar({ tipo: "definir-fila", arquivos });

  const semArquivo = fila.length === 0;
  const semEntidade = prefs.entidades.length === 0;
  const impedido = semArquivo || semEntidade || !motorPronto;

  /* Um botão desabilitado sem motivo é um beco sem saída. O motivo fica
     escrito ao lado dele, não escondido num `title` que só aparece no hover. */
  const motivo = !motorPronto
    ? "O motor de anonimização ainda está subindo."
    : semArquivo
      ? "Solte ao menos um arquivo para começar."
      : semEntidade
        ? "Escolha ao menos um tipo de dado na receita."
        : null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <CabecalhoDeTela
          titulo="Anonimizar"
          subtitulo="Solte os autos, confira a receita, anonimize. Nada sai desta máquina."
        />

        <div className="mt-6">
          <AreaDeSoltar fila={fila} aoMudarFila={definirArquivos} />
        </div>

        <Cartao className="mt-5">
          <p className="mb-2 font-mono text-xs text-text-tertiary">Como vai ser feito</p>
          <Receita />
        </Cartao>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-xs text-text-tertiary">{motivo ?? "Pronto para anonimizar."}</p>
          <Botao
            tipo="primario"
            tamanho="grande"
            icone="cadeado"
            onClick={aoAnonimizar}
            disabled={impedido}
          >
            Anonimizar
            {fila.length > 0 && ` ${fila.length} arquivo${fila.length > 1 ? "s" : ""}`}
          </Botao>
        </div>

        {recentes.length > 0 && (
          <section aria-labelledby="recentes-titulo" className="mt-10">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="recentes-titulo" className="font-mono text-xs text-text-tertiary">
                Guardados recentemente
              </h2>
              <button
                onClick={aoVerTodos}
                className="font-mono text-xs text-accent underline-offset-2 hover:underline"
              >
                Ver todos
              </button>
            </div>
            <Cartao semPreenchimento>
              <ul className="divide-y divide-border-subtle">
                {recentes.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => aoAbrirRecente(item)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[120ms] hover:bg-surface-hover"
                    >
                      <Icone nome="documento" tamanho={15} className="shrink-0 text-text-tertiary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{item.nome}</span>
                        <span className="block truncate font-mono text-2xs text-text-tertiary">
                          {item.cnj ?? "Avulsos"} · {dataCurta(item.gravadoEm)} ·{" "}
                          {item.totalOcorrencias.toLocaleString("pt-BR")} ocorrências
                        </span>
                      </span>
                      <Icone nome="avancar" tamanho={14} className="shrink-0 text-text-tertiary" />
                    </button>
                  </li>
                ))}
              </ul>
            </Cartao>
          </section>
        )}
      </div>
    </div>
  );
}
