import { useEffect, useState } from "react";
import { Icone } from "../ui";

/**
 * Aviso flutuante — uma frase, canto inferior direito, some sozinho.
 *
 * Era o último componente desenhado fora do sistema: cantos e sombra de
 * outra escala, dois SVGs colados à mão. Agora é folha sobre a mesa, como o
 * cartão, com o ícone do sistema e a cor só no ícone — um aviso de sucesso
 * inteiro em verde grita mais do que a notícia merece.
 *
 * Mensagens longas (com caminho de arquivo) ficam mais tempo.
 */

interface ToastProps {
  message: string;
  type?: "success" | "error";
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = "success", onClose, duration }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const displayDuration = duration ?? (message.length > 40 ? 5000 : 3000);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, displayDuration);
    return () => clearTimeout(timer);
  }, [displayDuration, onClose]);

  const sucesso = type === "success";

  return (
    <div
      role={sucesso ? "status" : "alert"}
      /* z-200: acima de popover (z-100) e de qualquer painel. Um aviso que
         some atrás de outra coisa não é aviso. */
      className={[
        "fixed right-6 bottom-6 z-200 flex max-w-md items-start gap-3 rounded-lg border",
        "border-border-subtle bg-surface px-4 py-3 shadow-lg",
        "transition-[opacity,transform] duration-200",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      ].join(" ")}
    >
      <span className={sucesso ? "mt-0.5 text-success" : "mt-0.5 text-danger"}>
        <Icone nome={sucesso ? "verificado" : "alerta"} tamanho={16} />
      </span>
      <span className="text-sm leading-snug text-text">{message}</span>
    </div>
  );
}
