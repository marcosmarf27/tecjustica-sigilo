/**
 * Ícones do sistema, num lugar só.
 *
 * Antes cada SVG era colado direto no JSX de quem precisava dele: o cadeado
 * aparecia três vezes e o "X" duas, cada cópia com sua própria espessura de
 * traço e seu próprio tamanho. Um ícone duplicado não é só repetição — é a
 * garantia de que uma correção vai pegar em dois dos três lugares.
 *
 * Todos são de traço (nunca preenchidos), herdam a cor do texto por
 * `currentColor` e vêm com `aria-hidden`. Ícone aqui é decoração: quem precisa
 * de nome acessível põe no elemento que o envolve — um botão só com ícone
 * carrega `aria-label`, e o `Botao` deste diretório cobra isso por tipo.
 */

export type NomeIcone =
  | "cadeado"
  | "fechar"
  | "verificado"
  | "documento"
  | "terminal"
  | "arquivar"
  | "voltar"
  | "avancar"
  | "alerta"
  | "mais"
  | "busca"
  | "ajustes"
  | "lixeira"
  | "pasta"
  | "sol"
  | "lua"
  | "conexao"
  | "conversa"
  | "olho"
  | "baixar";

/* O `d` de cada traçado. Grade de 24×24, traço de 2, pontas arredondadas —
   a mesma métrica dos que já estavam no projeto, para que nada mude de peso
   visual ao migrar. */
const TRACADOS: Record<NomeIcone, string[]> = {
  cadeado: [
    "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  ],
  fechar: ["M6 18L18 6M6 6l12 12"],
  verificado: ["M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"],
  documento: [
    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  ],
  terminal: ["M4 17l6-6-6-6M12 19h8"],
  arquivar: [
    "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  ],
  voltar: ["M15 19l-7-7 7-7"],
  avancar: ["M9 5l7 7-7 7"],
  alerta: [
    "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  ],
  mais: ["M12 5v14M5 12h14"],
  busca: ["M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"],
  ajustes: ["M4 6h16M4 12h16M4 18h16", "M9 6v0M15 12v0M7 18v0"],
  lixeira: [
    "M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3",
  ],
  pasta: [
    "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  ],
  sol: [
    "M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4",
    "M12 16a4 4 0 100-8 4 4 0 000 8z",
  ],
  lua: ["M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"],
  conexao: [
    "M10 14a5 5 0 007.1 0l3-3a5 5 0 00-7.1-7.1L11.5 5.4",
    "M14 10a5 5 0 00-7.1 0l-3 3a5 5 0 007.1 7.1l1.4-1.4",
  ],
  conversa: ["M20 11.5a7.5 7.5 0 01-7.5 7.5H8l-5 3 1.4-4.2A7.5 7.5 0 1120 11.5z"],
  olho: [
    "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z",
    "M12 15a3 3 0 100-6 3 3 0 000 6z",
  ],
  baixar: ["M12 3v12M7 12l5 5 5-5M4 21h16"],
};

interface IconeProps {
  nome: NomeIcone;
  /** Lado do quadrado, em px. O padrão acompanha o corpo da interface. */
  tamanho?: number;
  className?: string;
}

export function Icone({ nome, tamanho = 16, className }: IconeProps) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {TRACADOS[nome].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
