import type { CSSProperties, KeyboardEvent } from "react";
import { corDaEntidade, rotuloDaEntidade } from "../types";

/**
 * Tarja de redação — o elemento de assinatura do produto.
 *
 * Barra **preta** sobre o papel, com filete de 2px na cor do tipo. A versão
 * anterior pintava a tarja inteira na cor da entidade, o que fazia a página
 * parecer marcada a marca-texto em vez de censurada; o preenchimento agora é
 * sempre `--toner`, e o tipo se identifica pelo filete.
 *
 * Passar o mouse ou focar pelo teclado revela o valor original — é o gesto que
 * permite conferir se a anonimização acertou, a tarefa central de quem responde
 * pelo sigilo. Por isso cada tarja é um `<button>` de verdade: o revisor tem de
 * alcançar **todas** as ocorrências por Tab, não só as que couberem no mouse.
 *
 * O nome acessível diz o tipo e o valor ("CPF: 123.456.789-09"), porque para
 * quem usa leitor de tela a barra preta não comunica nada — e a cor do filete,
 * menos ainda.
 */

interface TarjaProps {
  /** O texto original, que a tarja esconde. */
  children: string;
  /** Tipo da entidade, como o backend devolveu (`CPF_BR`, `PERSON`…). */
  tipo: string;
  /** Posição na lista de ocorrências — liga a tarja ao painel de auditoria. */
  indice: number;
  ativa?: boolean;
  /** Deixa o valor à mostra sem depender de hover. */
  revelada?: boolean;
  /** Dispara a animação de varredura, escalonada por `indice`. */
  varrendo?: boolean;
  onClick?: () => void;
}

/* 240 ms para o documento inteiro, escalonados: uma tarja tardia não pode
   esperar mais que isso, ou a página fica se montando na frente do revisor.
   O passo encolhe conforme o índice cresce; a soma converge. */
const ATRASO_MAXIMO_MS = 240;
const atrasoDe = (indice: number) =>
  Math.min(ATRASO_MAXIMO_MS, indice * 12);

export function Tarja({
  children,
  tipo,
  indice,
  ativa = false,
  revelada = false,
  varrendo = false,
  onClick,
}: TarjaProps) {
  const estilo = {
    "--cor-entidade": corDaEntidade(tipo),
    "--atraso": `${atrasoDe(indice)}ms`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className="tarja"
      style={estilo}
      data-ocorrencia={indice}
      data-revelada={revelada || undefined}
      data-varrendo={varrendo || undefined}
      data-ativa={ativa || undefined}
      aria-label={`${rotuloDaEntidade(tipo)}: ${children}`}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {children}
    </button>
  );
}
