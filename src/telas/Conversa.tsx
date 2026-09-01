import { useEffect, useRef, useState } from "react";

import { useConversa } from "../hooks/useConversa";
import {
  PseudonimoDesconhecido,
  PseudonimoReposto,
} from "../componentes/PseudonimoReposto";
import { Botao, Cartao, Dialogo, Selo } from "../ui";

interface ConversaProps {
  ids: string[] | null;
  aoFechar: () => void;
  aoIrParaDocumentos: () => void;
  aoIrParaAjustes: () => void;
  temChave: boolean;
}

/** Os pedaços de um turno, com os nomes repostos onde havia pseudônimo. */
function Texto({ trechos }: { trechos: TrechoDaConversa[] }) {
  return (
    <>
      {trechos.map((t, i) => {
        if (t.tipo === "texto") return <span key={i}>{t.texto}</span>;
        if (t.tipo === "reposto") {
          return <PseudonimoReposto key={i} rotulo={t.rotulo} valor={t.valor} />;
        }
        return <PseudonimoDesconhecido key={i} rotulo={t.rotulo} />;
      })}
    </>
  );
}

/**
 * Copia com os **pseudônimos**, não com os nomes repostos.
 *
 * A tela mostra "João da Silva" para quem está lendo aqui, com a máquina
 * trancada e o processo aberto do lado. O que sai daqui por Ctrl+C vai para
 * lugar nenhum sabido — um e-mail, um documento, um chat — e ali o nome real
 * não deveria estar. O texto copiado é o que de fato trafegou.
 */
function textoParaCopia(trechos: TrechoDaConversa[]): string {
  return trechos
    .map((t) => (t.tipo === "texto" ? t.texto : t.rotulo))
    .join("");
}

export function Conversa({
  ids,
  aoFechar,
  aoIrParaDocumentos,
  aoIrParaAjustes,
  temChave,
}: ConversaProps) {
  const { estado, erro, abrindo, perguntar, cancelar, previsualizar, orcamento } =
    useConversa(ids);
  const [pergunta, setPergunta] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);
  const [custo, setCusto] = useState<Awaited<
    ReturnType<typeof orcamento>
  > | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void orcamento().then(setCusto);
  }, [orcamento, estado?.id]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [estado?.turnos.length, estado?.parcial.length]);

  if (ids === null || ids.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Cartao
          titulo="Conversar com os autos"
          descricao="Escolha documentos na biblioteca para começar."
        >
          <p className="font-serif text-sm leading-relaxed text-text-secondary">
            A conversa acontece sobre o <strong>texto anonimizado</strong>: os
            nomes, CPFs e endereços já foram substituídos por pseudônimos antes
            de sair desta máquina. Os nomes reais aparecem de volta aqui na
            tela, repostos localmente — o mapa que liga um ao outro nunca é
            enviado.
          </p>
          <div className="mt-4">
            <Botao tipo="primario" onClick={aoIrParaDocumentos}>
              Escolher documentos
            </Botao>
          </div>
        </Cartao>
      </div>
    );
  }

  if (!temChave) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Cartao
          titulo="Falta a chave da API"
          descricao="A conversa usa o OpenRouter, e ele precisa de uma credencial sua."
        >
          <p className="font-serif text-sm leading-relaxed text-text-secondary">
            A chave fica cifrada nesta máquina, com a mesma proteção do cofre.
            Vale usar uma chave dedicada, com limite de crédito no painel do
            OpenRouter.
          </p>
          <div className="mt-4">
            <Botao tipo="primario" onClick={aoIrParaAjustes}>
              Ir para Ajustes
            </Botao>
          </div>
        </Cartao>
      </div>
    );
  }

  const enviando = estado?.enviando ?? false;
  const bloqueada = estado?.comprometida ?? false;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle px-6 py-3">
        <Botao tipo="discreto" tamanho="mini" icone="voltar" onClick={aoFechar}>
          Documentos
        </Botao>
        <span className="font-mono text-2xs text-text-tertiary">
          {estado?.documentos.length ?? ids.length} documento
          {(estado?.documentos.length ?? ids.length) > 1 ? "s" : ""}
          {custo &&
            ` · ~${custo.tokensEntrada.toLocaleString("pt-BR")} tokens · ~US$ ${custo.dolares.toFixed(3)} por pergunta`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {estado?.provedor && (
            <Selo tom={bloqueada ? "perigo" : "neutro"}>
              {estado.provedor}
            </Selo>
          )}
          <Botao
            tipo="discreto"
            tamanho="mini"
            onClick={() => void previsualizar().then(setPrevia)}
          >
            Ver o que sai
          </Botao>
        </div>
      </header>

      {abrindo && (
        <p className="px-6 py-4 font-mono text-xs text-text-tertiary">
          Preparando os documentos…
        </p>
      )}

      {(erro || estado?.erro) && (
        <p
          role="alert"
          className="mx-6 mt-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-serif text-sm text-danger"
        >
          {erro ?? estado?.erro}
        </p>
      )}

      {estado?.avisos.map((a, i) => (
        <p
          key={i}
          className={[
            "mx-6 mt-3 rounded-md px-3 py-2 font-serif text-sm",
            a.grave
              ? "border border-danger/40 bg-danger/5 text-danger"
              : "border border-border-subtle bg-surface text-text-secondary",
          ].join(" ")}
        >
          {a.grave && <strong>Atenção: </strong>}
          {a.texto}
        </p>
      ))}

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {estado?.turnos.map((turno, i) => (
          <article
            key={i}
            className={
              turno.papel === "usuario"
                ? "ml-auto max-w-[75%] rounded-lg bg-surface px-4 py-3"
                : "max-w-[85%]"
            }
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                {turno.papel === "usuario" ? "Você" : "Resposta"}
              </span>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(
                    textoParaCopia(turno.trechos)
                  )
                }
                title="copia com os pseudônimos, como trafegou"
                className="font-mono text-2xs text-text-tertiary hover:text-text-secondary"
              >
                copiar
              </button>
            </div>
            <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-text">
              <Texto trechos={turno.trechos} />
            </p>
            {turno.trocas && turno.trocas.length > 0 && (
              <p className="mt-2 border-t border-border-subtle pt-2 font-mono text-2xs text-text-tertiary">
                Antes de enviar, troquei:{" "}
                {turno.trocas
                  .map((t) => `"${t.valor}" → ${t.rotulo}`)
                  .join(" · ")}
              </p>
            )}
          </article>
        ))}

        {estado && estado.parcial.length > 0 && (
          <article className="max-w-[85%]">
            <span className="mb-1 block font-mono text-2xs uppercase tracking-wide text-text-tertiary">
              Respondendo…
            </span>
            <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-text">
              <Texto trechos={estado.parcial} />
            </p>
          </article>
        )}
        <div ref={fim} />
      </div>

      <footer className="border-t border-border-subtle px-6 py-4">
        {bloqueada && (
          <p className="mb-2 font-serif text-sm text-danger">
            Esta conversa foi marcada como comprometida e não aceita novos
            envios.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const texto = pergunta.trim();
            if (!texto || enviando || bloqueada) return;
            setPergunta("");
            void perguntar(texto);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.currentTarget.form?.requestSubmit();
                e.preventDefault();
              }
            }}
            rows={2}
            disabled={enviando || bloqueada}
            placeholder="Pergunte sobre os documentos…"
            aria-label="Pergunta"
            className="flex-1 resize-none rounded-md border border-border-subtle bg-surface px-3 py-2 font-serif text-sm text-text placeholder:text-text-tertiary focus:border-border focus:outline-none disabled:opacity-50"
          />
          {enviando ? (
            <Botao tipo="secundario" onClick={cancelar}>
              Parar
            </Botao>
          ) : (
            <Botao tipo="primario" type="submit" disabled={bloqueada}>
              Enviar
            </Botao>
          )}
        </form>
        <p className="mt-2 font-mono text-2xs text-text-tertiary">
          Se você digitar um nome ou CPF real, ele é substituído pelo pseudônimo
          antes de sair — e a troca aparece na mensagem.
        </p>
      </footer>

      <Dialogo
        aberto={previa !== null}
        aoFechar={() => setPrevia(null)}
        titulo="O que sai desta máquina"
      >
        <p className="mb-3 font-serif text-sm text-text-secondary">
          É este o conteúdo que seria enviado ao modelo. Os dados pessoais já
          estão substituídos por pseudônimos. A anonimização mede{" "}
          <strong>99,94% por ocorrência</strong> no gate do produto — alta, e não
          100%.
        </p>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-surface p-3 font-mono text-2xs leading-relaxed text-text-secondary">
          {previa}
        </pre>
      </Dialogo>
    </div>
  );
}
