import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Barreira de erro — o que aparece quando o renderer quebra.
 *
 * ## Por que existe
 *
 * Não havia nenhuma. Sem barreira, o React 19 **desmonta a árvore inteira** ao
 * receber um erro que ninguém tratou: a janela volta ao estado inicial, sem
 * mensagem, sem rastro visível. O sintoma relatado foi exatamente esse — "está
 * processando, aí de repente para e volta pra tela normal pra juntar novos
 * documentos". Um lote de seis documentos morria no meio e o aplicativo não
 * dizia uma palavra sobre o motivo.
 *
 * O pior não é a falha; é o silêncio. Quem opera não tem como saber se o
 * documento foi processado, se falhou, ou se deve tentar de novo — e quem for
 * consertar não tem por onde começar, porque o usuário só consegue relatar "ele
 * volta".
 *
 * ## O que ela promete, e o que não promete
 *
 * Ela **não** conserta o erro e não retoma o lote de onde parou. O que ela faz
 * é transformar um sumiço em uma mensagem: o que quebrou, onde, e o que fazer
 * agora. Nada é perdido em silêncio.
 *
 * O texto do erro fica à vista e copiável de propósito. Pilha de execução não é
 * dado pessoal — ela fala de código, não do processo — e é o que torna um
 * relato acionável.
 */

interface Props {
  children: ReactNode;
}

interface Estado {
  erro: Error | null;
  componente: string | null;
}

export class BarreiraDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null, componente: null };

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    /* Vai para o console do processo principal também: em desenvolvimento o
       Vite encaminha, e no app empacotado é o que sobra para diagnóstico. */
    console.error("[barreira] o renderer quebrou:", erro, info.componentStack);
    this.setState({ componente: info.componentStack ?? null });
  }

  private copiar = () => {
    const { erro, componente } = this.state;
    navigator.clipboard?.writeText(
      [
        `Erro: ${erro?.name}: ${erro?.message}`,
        "",
        erro?.stack ?? "(sem pilha)",
        "",
        "Componentes:",
        componente ?? "(sem rastro)",
      ].join("\n")
    );
  };

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-xl">
          <h1 className="font-mono text-lg font-semibold tracking-tight text-danger">
            O aplicativo encontrou um erro
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Nada foi enviado para fora da sua máquina. Os arquivos que você já
            salvou em disco não foram afetados; um lote em andamento foi
            interrompido e precisa ser refeito.
          </p>

          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-border-subtle bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-text">
            {erro.name}: {erro.message}
            {erro.stack ? `\n\n${erro.stack}` : ""}
          </pre>

          <div className="mt-4 flex gap-2">
            <button
              onClick={this.copiar}
              className="min-h-9 rounded-md border border-border bg-surface px-3.5 py-2 font-mono text-sm font-medium text-text hover:bg-surface-hover"
            >
              Copiar o erro
            </button>
            <button
              onClick={() => window.location.reload()}
              className="min-h-9 rounded-md bg-accent px-3.5 py-2 font-mono text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              Recarregar
            </button>
          </div>

          <p className="mt-4 text-xs text-text-tertiary">
            Copie o texto acima ao relatar o problema — é ele que diz onde
            procurar.
          </p>
        </div>
      </div>
    );
  }
}
