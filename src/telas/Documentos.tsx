import { useMemo, useState } from "react";
import { pastasDe } from "../hooks/useBiblioteca";
import {
  Botao,
  CabecalhoDeTela,
  Cartao,
  Carimbo,
  Campo,
  Marcador,
  Selo,
  Tabela,
  Dialogo,
  Vazio,
} from "../ui";
import type { ColunaTabela } from "../ui";
import { POLITICAS_MASCARA, rotuloDaEntidade, corDaEntidade } from "../types";

/**
 * Documentos — a biblioteca.
 *
 * **Tabela, não grade de cartões.** A tarefa aqui é varrer: achar um processo
 * por nome, data e contagem de ocorrências. Cartão mostra bem um item; tabela
 * compara trinta. E um índice de cartório é uma tabela.
 *
 * A numeração fala o vocabulário dos autos — "fls. 1–14", não "01 / 02 / 03".
 * Número só onde a ordem carrega informação.
 *
 * A linha de metadado é **uma linha**, truncada. Ela quebrava em duas em todo
 * documento com nome comprido, e uma tabela em que cada linha tem altura
 * diferente deixa de ser varrível.
 */

/* Sentinela do filtro "todos". Nomeado, e nao um espaco inicial:
   um separador invisivel se perde em edicao (esta constante chegou a
   guardar um byte NUL por causa disso, e um NUL no fonte deixa o
   parser do bundler em comportamento indefinido). O prefixo garante
   que nunca colida com um numero CNJ de verdade. */
const PASTA_TODAS = "@todas";

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * Como o documento foi mascarado, dito na linguagem da tela.
 *
 * "Marcador" é o rótulo que a receita usa em `POLITICAS_MASCARA`, e repeti-lo
 * aqui é de propósito: quem escolheu "com marcador" na Mesa reconhece a mesma
 * palavra na biblioteca.
 *
 * Ausente significa ausente, nunca "provavelmente marcador": o documento foi
 * guardado antes de o campo existir, e supor a política é o que a conversa
 * recusa fazer.
 */
function politicaDe(item: EntradaDoCofre): { texto: string; atencao: boolean } {
  const opcao = POLITICAS_MASCARA.find((p) => p.id === item.politicaMascara);
  if (opcao) return { texto: opcao.titulo, atencao: opcao.id !== "placeholder" };
  return { texto: "máscara não registrada", atencao: true };
}

interface DocumentosProps {
  itens: EntradaDoCofre[];
  cofreDisponivel: boolean | null;
  cofreLigado: boolean;
  expurgados: number;
  aoAbrir: (item: EntradaDoCofre) => void;
  aoApagar: (id: string) => void;
  /** Abre a conversa sobre os documentos marcados. */
  aoConversar: (ids: string[]) => void;
  aoIrParaMesa: () => void;
}

export function Documentos({
  itens,
  cofreDisponivel,
  cofreLigado,
  expurgados,
  aoAbrir,
  aoApagar,
  aoConversar,
  aoIrParaMesa,
}: DocumentosProps) {
  const [pasta, setPasta] = useState<string>(PASTA_TODAS);
  const [busca, setBusca] = useState("");
  const [paraApagar, setParaApagar] = useState<EntradaDoCofre | null>(null);
  const [apagarMarcados, setApagarMarcados] = useState(false);
  /* Marcados para conversar. Por id, e não por índice: a lista muda com o
     filtro de pasta e com a busca, e um índice apontaria para outro documento
     depois de qualquer uma das duas. */
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const alternar = (id: string) =>
    setMarcados((atuais) => {
      const novo = new Set(atuais);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const pastas = useMemo(() => pastasDe(itens), [itens]);

  /* Nomes que aparecem mais de uma vez. Processar o mesmo arquivo duas vezes é
     comum e legítimo — o que não é aceitável é a biblioteca mostrar duas linhas
     idênticas sem dizer que são homônimas. */
  const homonimos = useMemo(() => {
    const conta = new Map<string, number>();
    for (const i of itens) conta.set(i.nome, (conta.get(i.nome) ?? 0) + 1);
    return new Map([...conta].filter(([, n]) => n > 1));
  }, [itens]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (pasta === "Avulsos" && i.cnj) return false;
      if (pasta !== PASTA_TODAS && pasta !== "Avulsos" && i.cnj !== pasta) return false;
      if (!termo) return true;
      return (
        i.nome.toLowerCase().includes(termo) ||
        (i.cnj?.toLowerCase().includes(termo) ?? false)
      );
    });
  }, [itens, pasta, busca]);

  const colunas: ColunaTabela<EntradaDoCofre>[] = [
    {
      chave: "marcar",
      cabecalho: (
        <Marcador
          marcado={visiveis.length > 0 && visiveis.every((i) => marcados.has(i.id))}
          parcial={
            visiveis.some((i) => marcados.has(i.id)) &&
            !visiveis.every((i) => marcados.has(i.id))
          }
          aoAlternar={() =>
            setMarcados((atuais) =>
              visiveis.every((i) => atuais.has(i.id))
                ? new Set()
                : new Set(visiveis.map((i) => i.id))
            )
          }
          rotulo="Marcar todos os documentos visíveis"
        />
      ),
      estreita: true,
      render: (i) => (
        /* A célula inteira é o alvo, não só os 17 px do quadrado. Com a linha
           clicável para abrir, um alvo pequeno faz a pessoa abrir o documento
           quando queria marcá-lo. */
        <div
          className="-m-3 cursor-pointer p-3"
          onClick={(e) => {
            e.stopPropagation();
            alternar(i.id);
          }}
        >
          <Marcador
            marcado={marcados.has(i.id)}
            aoAlternar={() => alternar(i.id)}
            rotulo={`Marcar ${i.nome}`}
          />
        </div>
      ),
    },
    {
      chave: "documento",
      cabecalho: "Documento",
      render: (i) => {
        const politica = politicaDe(i);
        return (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {i.paginasComErro > 0 && (
                /* Página que precisava de OCR e não voltou. O texto dela não
                   está no resultado — quem revisa precisa saber antes de
                   assinar. O carimbo marca a exceção, nunca a regra. */
                <Carimbo tom="perigo">
                  {`${i.paginasComErro} falha${i.paginasComErro > 1 ? "s" : ""}`}
                </Carimbo>
              )}
              <span className="truncate text-sm text-text">{i.nome}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-2xs text-text-tertiary">
                {i.cnj ?? "Avulsos"} · {dataCurta(i.gravadoEm)}
                {i.totalPaginas > 0 && ` · fls. 1–${i.totalPaginas}`}
              </span>
              {/* Só "Marcador" conversa; o que destoa fica em cor de atenção.
                  Descobrir isso ao abrir a conversa é tarde, então a lista diz
                  antes. */}
              {politica.atencao && <Selo tom="atencao">{politica.texto}</Selo>}
              {homonimos.has(i.nome) && (
                <Selo tom="acao">{homonimos.get(i.nome)} com este nome</Selo>
              )}
            </div>
          </div>
        );
      },
    },
    {
      chave: "tipos",
      cabecalho: "Encontrado",
      render: (i) => (
        <div className="flex flex-wrap gap-1">
          {Object.entries(i.porTipo)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tipo, n]) => (
              <Selo key={tipo} tom="entidade" cor={corDaEntidade(tipo)}>
                {rotuloDaEntidade(tipo)} {n}
              </Selo>
            ))}
        </div>
      ),
    },
    {
      chave: "total",
      cabecalho: "Ocorrências",
      numerica: true,
      render: (i) => i.totalOcorrencias.toLocaleString("pt-BR"),
    },
    {
      chave: "acoes",
      cabecalho: "",
      estreita: true,
      /* A linha inteira abre o documento — é o gesto que as pessoas tentam
         antes de procurar o botão. O botão fica assim mesmo: linha clicável é
         atalho para quem descobre, não substituto de um alvo visível. */
      render: (i) => (
        <div className="flex gap-1.5">
          <Botao
            tamanho="mini"
            onClick={(e) => {
              e.stopPropagation();
              aoAbrir(i);
            }}
          >
            Abrir
          </Botao>
          <Botao
            tamanho="mini"
            tipo="discreto"
            icone="lixeira"
            aria-label={`Apagar ${i.nome}`}
            onClick={(e) => {
              e.stopPropagation();
              setParaApagar(i);
            }}
          />
        </div>
      ),
    },
  ];

  const filtro = (id: string, rotulo: string, quantidade: number) => {
    const ativo = pasta === id;
    return (
      <button
        key={id}
        onClick={() => setPasta(id)}
        aria-pressed={ativo}
        className={[
          "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-3 font-mono text-xs",
          "transition-colors duration-[120ms]",
          ativo
            ? "border-border bg-surface text-text shadow-sm"
            : "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text",
        ].join(" ")}
      >
        {rotulo}
        <span className="text-text-tertiary">{quantidade}</span>
      </button>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Mais larga que as telas de leitura, de propósito: esta é de
          varredura, com cinco colunas para comparar. */}
      <div className="mx-auto max-w-6xl px-8 py-8">
        <CabecalhoDeTela
          titulo="Documentos"
          subtitulo={
            itens.length === 0
              ? "Nada guardado ainda."
              : `${itens.length} documento${itens.length === 1 ? "" : "s"} no cofre, cifrado${itens.length === 1 ? "" : "s"}.`
          }
          acoes={
            itens.length > 0 && (
              <Campo
                rotulo="Buscar"
                placeholder="nome ou número do processo"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-72"
              />
            )
          }
        />

        {cofreDisponivel === false && (
          <Cartao className="mt-6" titulo="Cofre indisponível">
            <p className="text-sm text-text-secondary">
              O sistema não oferece cifragem para esta conta, e o cofre não grava em claro.
              Documentos anonimizados continuam podendo ser salvos onde você escolher — só não
              ficam guardados aqui para reabrir.
            </p>
          </Cartao>
        )}

        {expurgados > 0 && (
          <p role="status" className="mt-4 text-xs text-text-tertiary">
            {expurgados} documento{expurgados > 1 ? "s" : ""} saíram do cofre por terem passado
            do prazo de guarda.
          </p>
        )}

        {itens.length === 0 && cofreDisponivel !== false && (
          <Vazio
            icone="arquivar"
            titulo={cofreLigado ? "O cofre está vazio" : "O cofre está desligado"}
            acao={
              <Botao tipo="primario" icone="cadeado" onClick={aoIrParaMesa}>
                Anonimizar um documento
              </Botao>
            }
          >
            {cofreLigado
              ? "Cada documento anonimizado fica guardado aqui, cifrado, para reabrir a revisão e conversar sobre ele."
              : "Nada é guardado em disco. Ao anonimizar um documento, o aplicativo pergunta se você quer guardá-lo aqui — e explica exatamente o que passa a ficar gravado."}
          </Vazio>
        )}

        {itens.length > 0 && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-1">
              {filtro(PASTA_TODAS, "Todos", itens.length)}
              {pastas.map((p) =>
                filtro(
                  p,
                  p,
                  p === "Avulsos"
                    ? itens.filter((i) => !i.cnj).length
                    : itens.filter((i) => i.cnj === p).length
                )
              )}
            </div>

            <Cartao semPreenchimento className="mt-3">
              <Tabela
                rotulo="Documentos guardados"
                colunas={colunas}
                linhas={visiveis}
                chaveDaLinha={(i) => i.id}
                aoAbrir={aoAbrir}
                vazio={
                  busca ? "Nenhum documento com esse termo." : "Nenhum documento nesta pasta."
                }
              />
            </Cartao>
          </>
        )}

        {/* Presa ao rodapé da área rolável: com trinta documentos na lista,
            quem marca o vigésimo não deveria ter de subir até o topo para
            agir. Só existe quando há seleção. */}
        {marcados.size > 0 && (
          <div className="sticky bottom-0 -mx-8 mt-2 border-t border-border-subtle bg-surface/95 px-8 py-3 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-3">
              <span className="font-mono text-xs text-text-secondary">
                {marcados.size} marcado{marcados.size > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setMarcados(new Set())}
                className="font-mono text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
              >
                desmarcar
              </button>
              <div className="ml-auto flex items-center gap-2">
                {/* Apagar fica à esquerda do primário e em `secundario`: é a
                    ação destrutiva, não pode disputar o clique com a que se
                    quer. */}
                <Botao tipo="secundario" icone="lixeira" onClick={() => setApagarMarcados(true)}>
                  Apagar
                </Botao>
                <Botao tipo="primario" icone="conversa" onClick={() => aoConversar([...marcados])}>
                  Conversar
                </Botao>
              </div>
            </div>
          </div>
        )}

        <Dialogo
          aberto={apagarMarcados}
          aoFechar={() => setApagarMarcados(false)}
          titulo={`Apagar ${marcados.size} documento${marcados.size > 1 ? "s" : ""} do cofre`}
          acoes={
            <>
              <Botao tipo="secundario" onClick={() => setApagarMarcados(false)}>
                Cancelar
              </Botao>
              <Botao
                tipo="perigo"
                onClick={() => {
                  for (const id of marcados) aoApagar(id);
                  setMarcados(new Set());
                  setApagarMarcados(false);
                }}
              >
                Apagar {marcados.size}
              </Botao>
            </>
          }
        >
          <p>
            {marcados.size === 1 ? "O documento sai" : "Os documentos saem"} do cofre e não{" "}
            {marcados.size === 1 ? "poderá" : "poderão"} ser
            {marcados.size === 1 ? " reaberto" : " reabertos"}. Os arquivos que você já salvou em
            disco não são afetados.
          </p>
        </Dialogo>

        <Dialogo
          aberto={paraApagar !== null}
          aoFechar={() => setParaApagar(null)}
          titulo="Apagar do cofre"
          acoes={
            <>
              <Botao tipo="secundario" onClick={() => setParaApagar(null)}>
                Cancelar
              </Botao>
              <Botao
                tipo="perigo"
                onClick={() => {
                  if (paraApagar) aoApagar(paraApagar.id);
                  setParaApagar(null);
                }}
              >
                Apagar
              </Botao>
            </>
          }
        >
          <p>
            <strong className="text-text">{paraApagar?.nome}</strong> sai do cofre e não poderá
            ser reaberto. Os arquivos que você já salvou em disco não são afetados.
          </p>
        </Dialogo>
      </div>
    </div>
  );
}
