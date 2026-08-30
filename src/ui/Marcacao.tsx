import type { CSSProperties } from "react";
import { corDaEntidade, rotuloDaEntidade } from "../types";

/**
 * Marcação — localizar sem esconder.
 *
 * É o oposto da `Tarja`: o valor continua legível, com um fundo suave e um
 * filete embaixo na cor do tipo. Serve ao momento em que o revisor está
 * procurando o que o detector **achou**, não conferindo o que ele **cobriu**.
 *
 * `data-ativa` marca a ocorrência sob foco no painel lateral, para que saltar
 * de uma para outra tenha um alvo visível na página.
 */

interface MarcacaoProps {
  children: string;
  tipo: string;
  indice: number;
  ativa?: boolean;
  onClick?: () => void;
}

export function Marcacao({
  children,
  tipo,
  indice,
  ativa = false,
  onClick,
}: MarcacaoProps) {
  const estilo = { "--cor-entidade": corDaEntidade(tipo) } as CSSProperties;

  return (
    <button
      type="button"
      className="marcacao"
      style={estilo}
      data-ocorrencia={indice}
      data-ativa={ativa || undefined}
      aria-label={`${rotuloDaEntidade(tipo)}: ${children}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
