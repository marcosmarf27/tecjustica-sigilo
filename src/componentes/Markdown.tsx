import { Fragment, type ReactNode } from "react";

import { analisarBlocos, type Bloco, type Inline } from "../lib/markdown";
import { PseudonimoDesconhecido, PseudonimoReposto } from "./PseudonimoReposto";

/**
 * A resposta do modelo, formatada, com os nomes repostos no meio do texto.
 *
 * A parte difícil não é o markdown: é que os nomes **não são texto**. Onde o
 * modelo escreveu `[PESSOA_1]` entra um componente que mostra o nome real com
 * marca visual, porque a diferença entre o que o modelo escreveu e o que este
 * aplicativo repôs é a diferença entre ler uma resposta e confiar nela.
 *
 * Por isso o parser é nosso (`lib/markdown.ts`) e não uma biblioteca: onde ela
 * emitiria uma string, aqui se emite a string já com os pseudônimos trocados
 * por componentes. Encaixar isso numa lib exigiria interceptar o renderer de
 * cada nó de texto dela — mais frágil e mais código do que analisar o subconjunto
 * de markdown que um modelo de fato escreve.
 *
 * ## A tipografia diz o que é o quê
 *
 * Três degraus, e cada um usa a fonte pelo que ela significa neste sistema.
 * Título de peça e de seção em serif, porque são texto do documento. Subtítulo
 * em mono e caixa alta, porque ali vira **rótulo** — o mesmo tratamento do
 * cabeçalho da tabela de documentos. Sem isso, seis níveis de `#` viram seis
 * tamanhos de serif e o leitor conta pixels para saber o que está aninhado.
 */

/** Rótulo → nome real; `null` quando o pseudônimo não é desta conversa. */
export type MapaDeNomes = Map<string, string | null>;

const RE_ROTULO = /\[(\p{Lu}+(?:_\p{Lu}+)*)_(\d+)\]/gu;

export function Markdown({
  texto,
  nomes,
  /** Mostrado colado no fim do último bloco, enquanto a resposta chega. */
  cursor = false,
}: {
  texto: string;
  nomes: MapaDeNomes;
  cursor?: boolean;
}) {
  const blocos = analisarBlocos(texto);

  return (
    <div className="markdown space-y-3 font-serif text-sm leading-relaxed text-text">
      {blocos.map((bloco, i) => (
        <BlocoRender
          key={i}
          bloco={bloco}
          nomes={nomes}
          cursor={cursor && i === blocos.length - 1}
        />
      ))}
      {cursor && blocos.length === 0 && <Cursor />}
    </div>
  );
}

/**
 * O bloco piscando no fim do texto que ainda está chegando.
 *
 * Um retângulo, não três bolinhas: a resposta está sendo **escrita**, e o
 * cursor de bloco é o sinal que qualquer pessoa já viu significar isso. As
 * bolinhas dizem "aguarde" e não dizem onde.
 */
function Cursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1em] w-[0.45em] translate-y-[0.12em] animate-pulse bg-accent"
    />
  );
}

function BlocoRender({
  bloco,
  nomes,
  cursor,
}: {
  bloco: Bloco;
  nomes: MapaDeNomes;
  cursor: boolean;
}) {
  const fim = cursor ? <Cursor /> : null;

  switch (bloco.tipo) {
    case "titulo": {
      /* Um `#` numa resposta de chat não é título de página: é o começo de uma
         seção dentro de uma mensagem. Por isso o maior nível já entra em
         `text-base`, e não numa escala de display que competiria com o resto
         da interface. */
      if (bloco.nivel <= 2) {
        return (
          <h3
            className={[
              "mt-5 border-b border-border-subtle pb-1 font-serif font-semibold text-text first:mt-0",
              bloco.nivel === 1 ? "text-base" : "text-sm",
            ].join(" ")}
          >
            <Linha filhos={bloco.filhos} nomes={nomes} />
            {fim}
          </h3>
        );
      }
      return (
        <h4 className="mt-4 font-mono text-2xs font-medium uppercase tracking-wide text-text-tertiary first:mt-0">
          <Linha filhos={bloco.filhos} nomes={nomes} />
          {fim}
        </h4>
      );
    }

    case "lista":
      return (
        <ul className="space-y-1.5">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-2">
              {/* O marcador é conteúdo posicionado, não `list-style`: assim o
                  número fica em mono tabular e alinhado à direita, como numa
                  peça numerada, e o texto do item alinha em bloco. */}
              <span
                aria-hidden="true"
                className={[
                  "shrink-0 select-none font-mono text-2xs text-text-tertiary",
                  bloco.ordenada
                    ? "w-[1.6em] pt-[0.28em] text-right tabular-nums"
                    : "pt-[0.35em]",
                ].join(" ")}
              >
                {bloco.ordenada ? `${bloco.inicio + i}.` : "—"}
              </span>
              <span className="min-w-0 flex-1">
                <Linha filhos={item} nomes={nomes} />
                {cursor && i === bloco.itens.length - 1 ? fim : null}
              </span>
            </li>
          ))}
        </ul>
      );

    case "citacao":
      return (
        <blockquote className="border-l-2 border-border pl-3 italic text-text-secondary">
          <Linha filhos={bloco.filhos} nomes={nomes} />
          {fim}
        </blockquote>
      );

    case "codigo":
      return (
        /* Rola dentro da própria caixa. A conversa nunca rola de lado, por mais
           larga que seja a linha de código. */
        <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-text-secondary">
          <code>{bloco.texto}</code>
        </pre>
      );

    case "tabela":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                {bloco.cabecalho.map((celula, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="px-2 py-1.5 font-mono text-2xs font-medium uppercase tracking-wide text-text-tertiary"
                  >
                    <Linha filhos={celula} nomes={nomes} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((linha, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  {linha.map((celula, j) => (
                    <td key={j} className="px-2 py-1.5 align-top text-sm">
                      <Linha filhos={celula} nomes={nomes} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "regra":
      return <hr className="border-t border-border-subtle" />;

    case "paragrafo":
      return (
        /* `pre-line` porque a quebra simples é significativa aqui: o modelo põe
           um campo por linha e contava com isso. */
        <p className="whitespace-pre-line">
          <Linha filhos={bloco.filhos} nomes={nomes} />
          {fim}
        </p>
      );
  }
}

function Linha({ filhos, nomes }: { filhos: Inline[]; nomes: MapaDeNomes }) {
  return (
    <>
      {filhos.map((no, i) => (
        <Fragment key={i}>
          <NoRender no={no} nomes={nomes} />
        </Fragment>
      ))}
    </>
  );
}

function NoRender({ no, nomes }: { no: Inline; nomes: MapaDeNomes }) {
  switch (no.tipo) {
    case "texto":
      return <>{repor(no.texto, nomes)}</>;
    case "forte":
      return (
        <strong className="font-semibold text-text">
          <Linha filhos={no.filhos} nomes={nomes} />
        </strong>
      );
    case "enfase":
      return (
        <em className="italic">
          <Linha filhos={no.filhos} nomes={nomes} />
        </em>
      );
    case "riscado":
      return (
        <s className="text-text-tertiary">
          <Linha filhos={no.filhos} nomes={nomes} />
        </s>
      );
    case "codigo":
      return (
        <code className="rounded-[3px] bg-surface-sunken px-1 py-px font-mono text-2xs text-text-secondary">
          {repor(no.texto, nomes)}
        </code>
      );
    case "link":
      /* Não navega. A janela do aplicativo não abre página externa, e um link
         vivo numa resposta de modelo é convite para clicar em endereço
         inventado. O destino fica no `title`, à vista de quem quiser conferir. */
      return (
        <span
          title={no.destino}
          className="underline decoration-border-subtle underline-offset-2"
        >
          {repor(no.texto, nomes)}
        </span>
      );
  }
}

/**
 * Troca `[PESSOA_1]` pelo nome real, como componente.
 *
 * Rótulo que não está no mapa fica marcado como desconhecido em vez de sumir:
 * o modelo pode citar `[PESSOA_9]` num processo de três pessoas, e apagar em
 * silêncio esconderia a invenção.
 */
function repor(texto: string, nomes: MapaDeNomes): ReactNode {
  RE_ROTULO.lastIndex = 0;
  if (!RE_ROTULO.test(texto)) return texto;

  const saida: ReactNode[] = [];
  let cursor = 0;

  for (const achado of texto.matchAll(RE_ROTULO)) {
    const inicio = achado.index ?? 0;
    if (inicio > cursor) saida.push(texto.slice(cursor, inicio));

    const rotulo = achado[0];
    const valor = nomes.get(rotulo);
    saida.push(
      valor === undefined || valor === null ? (
        <PseudonimoDesconhecido key={inicio} rotulo={rotulo} />
      ) : (
        <PseudonimoReposto key={inicio} rotulo={rotulo} valor={valor} />
      )
    );

    cursor = inicio + rotulo.length;
  }

  if (cursor < texto.length) saida.push(texto.slice(cursor));
  return saida;
}
