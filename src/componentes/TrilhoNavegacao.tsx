import { Icone, type NomeIcone } from "../ui";
import type { Destino } from "../estado/tipos";

/**
 * Trilho fixo de navegação — 220px, quatro destinos, rodapé de estado.
 *
 * ## Por que ele nunca desmonta
 *
 * Na versão anterior, `status === "loading"` e `status === "error"` eram
 * *early-returns* antes da barra lateral: sequestravam a tela inteira e
 * deixavam o aplicativo sem navegação nenhuma durante um carregamento que
 * chega a 180 s na primeira execução com BERT. Quem abria o programa via uma
 * tela de espera sem saída, sem poder ir aos Ajustes trocar o modo do motor ou
 * às Conexões ver o que estava acontecendo.
 *
 * Aqui carregamento e erro são estado *dentro* da casca. O trilho está sempre
 * montado; só o conteúdo à direita muda.
 *
 * ## O rodapé de estado é segurança, não enfeite
 *
 * Quando o BERT não carrega e o motor cai para spaCy, **menos nomes e locais
 * são encontrados** — o documento sai parecendo anonimizado com o mesmo aspecto
 * de sempre. Antes isso aparecia num badge de uma tela só mais um banner
 * flutuante; agora fica permanentemente à vista, ao lado do estado da API.
 */

export type EstadoMotor = "carregando" | "pronto" | "erro";

interface TrilhoNavegacaoProps {
  destino: Destino;
  aoNavegar: (destino: Destino) => void;
  estadoMotor: EstadoMotor;
  /** `"transformer"`, `"spacy"` ou `"unknown"`. */
  modoNlp: string;
  /** Motor rodando degradado: o BERT não subiu e caiu para spaCy. */
  degradado: boolean;
  /** Quantos clientes pareados estão ativos. `null` = API desligada. */
  clientesConectados: number | null;
}

const DESTINOS: { id: Destino; rotulo: string; icone: NomeIcone }[] = [
  { id: "mesa", rotulo: "Anonimizar", icone: "cadeado" },
  { id: "documentos", rotulo: "Documentos", icone: "arquivar" },
  { id: "conexoes", rotulo: "Conexões", icone: "conexao" },
  { id: "ajustes", rotulo: "Ajustes", icone: "ajustes" },
];

function rotuloDoMotor(estado: EstadoMotor, modoNlp: string): string {
  if (estado === "carregando") return "Carregando…";
  if (estado === "erro") return "Motor fora do ar";
  if (modoNlp === "transformer") return "BERT jurídico";
  if (modoNlp === "spacy") return "spaCy rápido";
  return "Motor pronto";
}

export function TrilhoNavegacao({
  destino,
  aoNavegar,
  estadoMotor,
  modoNlp,
  degradado,
  clientesConectados,
}: TrilhoNavegacaoProps) {
  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-[220px] shrink-0 flex-col border-r border-border-subtle bg-surface-sunken"
    >
      <div className="px-4 py-4">
        <span className="font-mono text-xs font-semibold tracking-[0.2em] text-text uppercase">
          Sigilo
        </span>
      </div>

      <ul className="flex-1 px-2">
        {DESTINOS.map((item) => {
          const ativo = item.id === destino;
          return (
            <li key={item.id}>
              <button
                onClick={() => aoNavegar(item.id)}
                aria-current={ativo ? "page" : undefined}
                className={[
                  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2",
                  "font-mono text-xs tracking-wide transition-colors duration-[120ms]",
                  ativo
                    ? "bg-surface text-text shadow-sm"
                    : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary",
                ].join(" ")}
              >
                <Icone nome={item.icone} tamanho={15} />
                {item.rotulo}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border-subtle px-4 py-3">
        <p className="flex items-center gap-2 font-mono text-2xs tracking-wide text-text-secondary uppercase">
          <span
            aria-hidden="true"
            className={[
              "h-1.5 w-1.5 shrink-0 rounded-full",
              estadoMotor === "pronto"
                ? degradado
                  ? "bg-warning"
                  : "bg-success"
                : estadoMotor === "erro"
                  ? "bg-danger"
                  : "bg-text-tertiary animate-pulse-soft",
            ].join(" ")}
          />
          {rotuloDoMotor(estadoMotor, modoNlp)}
        </p>

        {degradado && (
          /* `role="status"` para o leitor de tela anunciar a degradação quando
             ela surge — é informação de segurança, não decoração. */
          <p role="status" className="mt-1.5 text-2xs leading-tight text-warning">
            Modelo leve: menos nomes e locais serão encontrados. Revise com
            atenção redobrada.
          </p>
        )}

        <p className="mt-2 font-mono text-2xs tracking-wide text-text-tertiary uppercase">
          {clientesConectados === null
            ? "API · desligada"
            : `API · ${clientesConectados} cliente${clientesConectados === 1 ? "" : "s"}`}
        </p>
      </div>
    </nav>
  );
}
