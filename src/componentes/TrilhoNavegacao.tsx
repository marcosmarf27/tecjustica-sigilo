import { Icone, Tecla, type NomeIcone } from "../ui";
import type { Destino } from "../estado/tipos";

/**
 * Trilho fixo de navegação — 240px, cinco destinos, rodapé de estado.
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
 *
 * ## Atalhos
 *
 * Ctrl+1 a Ctrl+5 levam a cada destino, na ordem em que aparecem. A tecla
 * fica escrita ao lado do rótulo, em cinza, e aparece só quando o ponteiro
 * passa: quem usa descobre; quem não usa não lê ruído.
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

export const DESTINOS: { id: Destino; rotulo: string; icone: NomeIcone; titulo: string }[] = [
  { id: "mesa", rotulo: "Anonimizar", icone: "cadeado", titulo: "Anonimizar" },
  { id: "documentos", rotulo: "Documentos", icone: "arquivar", titulo: "Documentos" },
  { id: "conversa", rotulo: "Conversar", icone: "conversa", titulo: "Conversar com os autos" },
  { id: "conexoes", rotulo: "Conexões", icone: "conexao", titulo: "Conexões" },
  { id: "ajustes", rotulo: "Ajustes", icone: "ajustes", titulo: "Ajustes" },
];

function rotuloDoMotor(estado: EstadoMotor, modoNlp: string): string {
  if (estado === "carregando") return "Motor subindo…";
  if (estado === "erro") return "Motor fora do ar";
  if (modoNlp === "transformer") return "BERT jurídico";
  if (modoNlp === "spacy") return "spaCy leve";
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
  const corDoPonto =
    estadoMotor === "pronto"
      ? degradado
        ? "bg-warning"
        : "bg-success"
      : estadoMotor === "erro"
        ? "bg-danger"
        : "bg-text-tertiary animate-pulse-soft";

  return (
    <nav
      aria-label="Navegação principal"
      className="flex w-[240px] shrink-0 flex-col border-r border-border-subtle bg-surface-sunken"
    >
      <ul className="flex-1 space-y-0.5 px-3 pt-3">
        {DESTINOS.map((item, i) => {
          const ativo = item.id === destino;
          return (
            <li key={item.id}>
              <button
                onClick={() => aoNavegar(item.id)}
                aria-current={ativo ? "page" : undefined}
                className={[
                  "group relative flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-2",
                  "font-mono text-sm transition-colors duration-[120ms]",
                  ativo
                    ? "bg-surface text-text shadow-sm"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text",
                ].join(" ")}
              >
                {/* A barra à esquerda marca o ativo mesmo para quem não
                    percebe a diferença de fundo entre folha e trilho — que é
                    sutil de propósito no resto da interface. */}
                <span
                  aria-hidden="true"
                  className={[
                    "absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent",
                    "transition-opacity duration-[120ms]",
                    ativo ? "opacity-100" : "opacity-0",
                  ].join(" ")}
                />
                <Icone
                  nome={item.icone}
                  tamanho={16}
                  className={ativo ? "text-accent" : "text-text-tertiary group-hover:text-text-secondary"}
                />
                <span className="flex-1 text-left">{item.rotulo}</span>
                <Tecla className="opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100">
                  {`Ctrl+${i + 1}`}
                </Tecla>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="m-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
        <p className="flex items-center gap-2 font-mono text-xs text-text">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${corDoPonto}`} />
          {rotuloDoMotor(estadoMotor, modoNlp)}
        </p>

        {degradado && (
          /* `role="status"` para o leitor de tela anunciar a degradação quando
             ela surge — é informação de segurança, não decoração. */
          <p role="status" className="mt-1.5 text-xs leading-snug text-warning">
            Modelo leve: menos nomes e locais serão encontrados. Revise com
            atenção redobrada.
          </p>
        )}

        <p className="mt-1 font-mono text-2xs text-text-tertiary">
          {clientesConectados === null
            ? "API local desligada"
            : `API local · ${clientesConectados} cliente${clientesConectados === 1 ? "" : "s"}`}
        </p>
      </div>
    </nav>
  );
}
