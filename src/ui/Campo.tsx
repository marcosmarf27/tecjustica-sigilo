import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Campo de texto com rótulo, apoio e erro.
 *
 * O `useId` do React gera o par `id`/`htmlFor` sozinho. Isso não é comodidade:
 * rótulo desamarrado do controle é a falha de acessibilidade mais comum em
 * formulário, e ela não aparece em nenhum teste que não seja de leitor de tela.
 * Amarrando por construção, não há como esquecer.
 *
 * A mensagem de erro vai em `aria-describedby` e `role="alert"`, para ser
 * anunciada quando surge, e o campo recebe `aria-invalid`.
 */

interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  rotulo: string;
  /** Explicação curta abaixo do campo. Some quando há erro. */
  apoio?: string;
  erro?: string;
  /** Elemento à direita dentro da moldura — um botão de limpar, por exemplo. */
  sufixo?: ReactNode;
}

export function Campo({
  rotulo,
  apoio,
  erro,
  sufixo,
  className = "",
  ...resto
}: CampoProps) {
  const id = useId();
  const idApoio = `${id}-apoio`;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-xs font-medium text-text-secondary"
      >
        {rotulo}
      </label>

      <div
        className={[
          "flex items-center gap-2 rounded-md border bg-surface px-3",
          "focus-within:border-accent",
          erro ? "border-danger" : "border-border",
        ].join(" ")}
      >
        <input
          id={id}
          aria-invalid={erro ? true : undefined}
          aria-describedby={apoio || erro ? idApoio : undefined}
          className="min-h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
          {...resto}
        />
        {sufixo}
      </div>

      {(erro || apoio) && (
        <p
          id={idApoio}
          role={erro ? "alert" : undefined}
          className={`mt-1.5 text-xs ${erro ? "text-danger" : "text-text-tertiary"}`}
        >
          {erro || apoio}
        </p>
      )}
    </div>
  );
}
