import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Botao } from "./Botao";

/**
 * Diálogo modal.
 *
 * O aplicativo não tinha **nenhum** modal, e a partir daqui precisa de três que
 * não podem ser ignorados: o consentimento da primeira gravação no cofre, a
 * aprovação de pareamento com o código, e a confirmação de apagar. São decisões
 * que não cabem num toast, porque um toast some sozinho.
 *
 * Usa o `<dialog>` nativo com `showModal()`, e não uma `<div>` com overlay. O
 * elemento nativo entrega de graça o que uma reimplementação erra: foco preso
 * dentro do diálogo, Esc que fecha, `inert` no resto da página e a camada
 * superior do navegador (não depende de z-index). O `::backdrop` é estilizado
 * abaixo por `className`.
 */

interface DialogoProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  children: ReactNode;
  /** Botões do rodapé. Sem isto, sai só um "Fechar". */
  acoes?: ReactNode;
  /**
   * Impede fechar por Esc ou clique fora. Para decisão que precisa de resposta
   * explícita — consentimento do cofre, aprovação de pareamento.
   */
  obrigatorio?: boolean;
}

export function Dialogo({
  aberto,
  aoFechar,
  titulo,
  children,
  acoes,
  obrigatorio = false,
}: DialogoProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* `showModal()` sobre um diálogo já aberto lança InvalidStateError; a
       guarda por `el.open` é o que torna o efeito seguro em re-render. */
    if (aberto && !el.open) el.showModal();
    if (!aberto && el.open) el.close();
  }, [aberto]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const aoCancelar = (e: Event) => {
      // `cancel` dispara com Esc. Barrá-lo é o que torna o diálogo obrigatório.
      if (obrigatorio) e.preventDefault();
      else aoFechar();
    };
    el.addEventListener("cancel", aoCancelar);
    return () => el.removeEventListener("cancel", aoCancelar);
  }, [obrigatorio, aoFechar]);

  return (
    <dialog
      ref={ref}
      /* O clique fora chega no próprio <dialog> (o backdrop é dele), enquanto
         o clique no conteúdo para na <div> interna. Comparar o alvo com o
         elemento é o jeito de distinguir os dois sem uma camada extra. */
      onClick={(e) => {
        if (!obrigatorio && e.target === ref.current) aoFechar();
      }}
      className={[
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border",
        "bg-surface p-0 text-text shadow-lg",
        "backdrop:bg-[rgb(22_24_29/0.55)]",
      ].join(" ")}
      aria-labelledby="titulo-dialogo"
    >
      <div className="border-b border-border-subtle px-5 py-3.5">
        <h2
          id="titulo-dialogo"
          className="font-mono text-xs font-semibold tracking-wide text-text uppercase"
        >
          {titulo}
        </h2>
      </div>

      <div className="px-5 py-4 text-sm leading-normal text-text-secondary">
        {children}
      </div>

      <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
        {acoes ?? (
          <Botao tipo="secundario" onClick={aoFechar}>
            Fechar
          </Botao>
        )}
      </div>
    </dialog>
  );
}
