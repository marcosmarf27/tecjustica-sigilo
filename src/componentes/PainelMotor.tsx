import { Botao, Icone } from "../ui";

/**
 * Carregamento e falha do motor, agora como **conteúdo** da casca.
 *
 * Antes eram dois `return` antecipados no `App`, colocados acima da barra
 * lateral: sequestravam a janela inteira e deixavam o aplicativo sem navegação
 * durante um carregamento que chega a 180 s na primeira execução com BERT.
 * Aqui eles ocupam só a área à direita do trilho, que continua montado — dá
 * para ir aos Ajustes ou às Conexões enquanto o motor sobe.
 */

export function MotorCarregando({ modoNlp }: { modoNlp: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <div className="animate-fade-in text-center">
        <Icone
          nome="cadeado"
          tamanho={28}
          className="mx-auto text-accent"
          /* `animate-pulse-soft` em vez de rotação: um cadeado girando sugere
             um relógio, não um carregamento. */
        />
        <h2 className="mt-4 font-mono text-sm font-semibold tracking-wide text-text uppercase">
          Carregando motor de anonimização
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-tertiary">
          {modoNlp === "transformer"
            ? "Iniciando o modelo BERT jurídico. A primeira execução pode levar alguns minutos."
            : "O modelo de linguagem está sendo iniciado."}
        </p>
        <div
          role="progressbar"
          aria-label="Carregando o motor"
          className="mx-auto mt-6 h-1 w-48 overflow-hidden rounded-full bg-border-subtle"
        >
          <div className="h-full w-1/2 animate-pulse-soft rounded-full bg-accent" />
        </div>
        <p className="mt-4 text-xs text-text-tertiary">
          O trilho à esquerda continua disponível.
        </p>
      </div>
    </div>
  );
}

export function MotorComFalha({ aoTentarDeNovo }: { aoTentarDeNovo: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <div className="animate-fade-in text-center" role="alert">
        <Icone nome="alerta" tamanho={28} className="mx-auto text-danger" />
        <h2 className="mt-4 font-mono text-sm font-semibold tracking-wide text-danger uppercase">
          O motor de anonimização não respondeu
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-tertiary">
          Ele roda como um programa local junto com o aplicativo. Tentar de novo
          costuma resolver; se persistir, feche e abra o aplicativo.
        </p>
        <Botao tipo="primario" onClick={aoTentarDeNovo} className="mt-5">
          Tentar de novo
        </Botao>
      </div>
    </div>
  );
}
