import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  type?: "success" | "error";
  onClose: () => void;
  duration?: number;
}

export function Toast({
  message,
  type = "success",
  onClose,
  duration,
}: ToastProps) {
  const [visible, setVisible] = useState(false);
  // Mensagens longas (com caminhos de arquivo) ficam mais tempo
  const displayDuration = duration ?? (message.length > 40 ? 5000 : 3000);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, displayDuration);
    return () => clearTimeout(timer);
  }, [displayDuration, onClose]);

  const isSuccess = type === "success";

  return (
    <div
      /* z-200: o aviso fica acima de popover (z-100) e de qualquer painel. Era
         z-50, que o deixaria por baixo de um popover aberto — e um aviso que
         some atrás de outra coisa não é aviso. */
      className={`fixed bottom-6 right-6 z-200 flex items-center gap-3 rounded-xl border px-5 py-3 shadow-2xl transition-all duration-200 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0"
      } ${
        isSuccess
          ? "border-success/20 bg-surface-raised text-success"
          : "border-danger/20 bg-surface-raised text-danger"
      }`}
    >
      {isSuccess ? (
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )}
      <span className="text-sm font-medium text-text">{message}</span>
    </div>
  );
}
