import type { ReactNode } from "react";

/**
 * Cabeçalho de tela — título, uma linha de contexto, ações.
 *
 * Cada destino do trilho inventava o seu: a Mesa tinha só o título, Documentos
 * punha a busca solta à direita, Conexões improvisava um bloco de estado no
 * canto. Mesmas coisas em posições diferentes ensinam ao usuário que cada tela
 * é um lugar novo. Com um cabeçalho só, o título está sempre no mesmo canto, e
 * o que a tela oferece está sempre à direita dele.
 *
 * O subtítulo é opcional e curto: uma contagem ("4 documentos"), um estado
 * ("motor pronto"), nunca um parágrafo. Explicação longa vai para o corpo.
 */

interface CabecalhoDeTelaProps {
  titulo: string;
  subtitulo?: ReactNode;
  /** Controles alinhados à direita, na linha do título. */
  acoes?: ReactNode;
  className?: string;
}

export function CabecalhoDeTela({
  titulo,
  subtitulo,
  acoes,
  className = "",
}: CabecalhoDeTelaProps) {
  return (
    <header
      className={["flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className].join(
        " "
      )}
    >
      <div className="min-w-0">
        <h1 className="font-mono text-xl font-semibold tracking-tight text-text">
          {titulo}
        </h1>
        {subtitulo && <p className="mt-1 text-sm text-text-tertiary">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}
