import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Popover ancorado — a peça que faz a receita da Mesa funcionar.
 *
 * Na tela Anonimizar a configuração é uma frase ("mascarar as 14 entidades com
 * marcador, salvar em .md na pasta do original"), e cada trecho sublinhado abre
 * um destes. É o que troca ~17 controles empilhados por um clique quando se
 * quer mudar algo — e por nenhum quando não se quer.
 *
 * Diferente do `Dialogo`, aqui **não** se usa `showModal()`: o popover não
 * bloqueia a página, fecha ao clicar fora e devolve o foco ao gatilho quando
 * fecha por Esc. Devolver o foco não é detalhe: sem isso, quem navega por
 * teclado é jogado para o começo do documento a cada fechamento.
 */

interface PopoverProps {
  /** O trecho clicável da frase. Recebe os atributos de acessibilidade. */
  gatilho: (props: {
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
    "aria-controls": string;
    onClick: () => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => ReactNode;
  children: ReactNode;
  /** Nome do painel para leitor de tela. */
  rotulo: string;
  /** Alinhamento em relação ao gatilho. */
  alinhamento?: "inicio" | "fim";
  larguraMinima?: number;
}

export function Popover({
  gatilho,
  children,
  rotulo,
  alinhamento = "inicio",
  larguraMinima = 260,
}: PopoverProps) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const refGatilho = useRef<HTMLButtonElement>(null);
  const refPainel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (refPainel.current?.contains(alvo)) return;
      if (refGatilho.current?.contains(alvo)) return;
      setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberto(false);
      refGatilho.current?.focus();
    };

    /* `mousedown`, não `click`: fechar só no click deixaria o painel aberto
       durante um arrasto iniciado fora dele. */
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <span className="relative inline-block">
      {gatilho({
        "aria-expanded": aberto,
        "aria-haspopup": "dialog",
        "aria-controls": id,
        onClick: () => setAberto((v) => !v),
        ref: refGatilho,
      })}

      {aberto && (
        <div
          ref={refPainel}
          id={id}
          role="dialog"
          aria-label={rotulo}
          style={{ minWidth: larguraMinima }}
          className={[
            "absolute top-[calc(100%+6px)] z-100",
            alinhamento === "fim" ? "right-0" : "left-0",
            "rounded-lg border border-border bg-surface p-3 text-left shadow-md",
          ].join(" ")}
        >
          {children}
        </div>
      )}
    </span>
  );
}
