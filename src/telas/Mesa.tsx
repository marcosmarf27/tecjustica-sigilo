import { useApp } from "../estado/AppEstado";
import { AreaDeSoltar } from "../componentes/AreaDeSoltar";
import { Receita } from "../componentes/Receita";
import { ProcessingView } from "../components/ProcessingView";
import { Botao } from "../ui";
import type { FileItem } from "../types";

/**
 * Mesa — a tela onde se anonimiza.
 *
 * Área de soltar, a receita, um botão. O caminho normal custa **duas ações**:
 * soltar o arquivo e clicar em Anonimizar. Contra os ~17 controles que a versão
 * anterior pedia a cada vez, porque nenhuma escolha sobrevivia ao fechamento.
 *
 * O que mudou de fato não foi a quantidade de opções — são as mesmas —, foi
 * quem carrega o custo delas. Antes, todas estavam abertas na tela o tempo
 * todo; agora ficam dentro da frase, e só quem quer mudar alguma paga o clique.
 */

interface MesaProps {
  aoAnonimizar: () => void;
  aoCancelar: () => void;
  motorPronto: boolean;
}

export function Mesa({ aoAnonimizar, aoCancelar, motorPronto }: MesaProps) {
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="font-mono text-xl font-semibold tracking-tight text-text">
          Anonimizar
        </h1>

        <div className="mt-6">
          <AreaDeSoltar fila={fila} aoMudarFila={definirArquivos} />
        </div>

        <div className="mt-6">
          <Receita />
        </div>

        <Botao
          tipo="primario"
          icone="cadeado"
          onClick={aoAnonimizar}
          disabled={impedido}
          className="mt-6 w-full py-3.5"
          /* Um botão desabilitado sem motivo é um beco sem saída: a pessoa não
             sabe se falta escolher arquivo, escolher um tipo de dado, ou apenas
             esperar o motor terminar de subir. */
          title={
            !motorPronto
              ? "O motor de anonimização ainda está subindo"
              : semArquivo
                ? "Solte ao menos um arquivo"
                : semEntidade
                  ? "Escolha ao menos um tipo de dado na receita"
                  : undefined
          }
        >
          Anonimizar
          {fila.length > 0 &&
            ` · ${fila.length} arquivo${fila.length > 1 ? "s" : ""}`}
        </Botao>
      </div>
    </div>
  );
}
