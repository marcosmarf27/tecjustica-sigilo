import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../estado/AppEstado";
import { corDaEntidade, rotuloDaEntidade } from "../types";
import type { EntityFound, ProcessedFile } from "../types";
import { nomeDeSaida } from "../lib/nomeDeSaida";
import {
  Botao,
  Cartao,
  Dialogo,
  GrupoSegmentado,
  Icone,
  Popover,
  Tarja,
} from "../ui";

/**
 * Revisão — conferir as tarjas antes de assinar embaixo.
 *
 * Não é destino do trilho: abre sobre o destino atual, ao terminar um
 * processamento ou ao escolher um documento na biblioteca.
 *
 * ## O que mudou em relação à `RevisaoView`
 *
 * **O painel de ocorrências deixou de sumir.** Era `hidden … lg:block`, então
 * evaporava abaixo de 1024px — e com ele a auditoria inteira, que é a tarefa
 * central de quem responde pelo sigilo. Numa janela estreita não havia como
 * conferir nada. Agora ele vira gaveta, alcançável por um botão.
 *
 * **O texto do documento é serifa 16px/1,75**, não mono 13px. Mono é a voz da
 * máquina; o texto dos autos é o que se lê, e lê-se por páginas.
 *
 * **As tarjas entram varrendo** ao terminar o processamento — 240 ms no total,
 * escalonadas pela ordem da ocorrência: o documento sendo carimbado. É o único
 * momento orquestrado do sistema; todo o resto é 120 ms de hover e foco. Quem
 * pediu menos movimento no sistema operacional não recebe nenhum, pelo bloco
 * `prefers-reduced-motion` do `tokens.css`.
 *
 * **"Não é PII" pede confirmação.** O clique grava na deny-list e o termo deixa
 * de ser mascarado em **todos** os documentos seguintes, para sempre. Uma ação
 * dessas não pode acontecer por engano num painel que se navega rápido.
 */

type Modo = "revisar" | "resultado";

/** Segmento de texto: trecho comum ou uma ocorrência detectada. */
export type Segmento =
  | { tipo: "texto"; conteudo: string }
  | { tipo: "entidade"; conteudo: string; entidade: EntityFound; indice: number };

/**
 * Divide o texto original nos pontos onde há detecção, para que cada ocorrência
 * possa ser tarjada, focada e auditada individualmente.
 *
 * ## O índice é o da lista original, e isso não é detalhe
 *
 * `indice` tem de ser a posição da ocorrência em `entitiesFound`, **não** a
 * posição no array ordenado e filtrado daqui. A lista lateral identifica cada
 * ocorrência por `entitiesFound.indexOf(entidade)`, e o texto marca cada tarja
 * com `data-ocorrencia={indice}`: se os dois numerarem diferente, clicar numa
 * ocorrência da lista leva a **outra** tarja no texto.
 *
 * Era o que acontecia. Este `forEach` numerava pela ordem de saída, que difere
 * da original em dois momentos: quando o motor não devolve as ocorrências
 * ordenadas por `start`, e sempre que alguma é descartada — a faixa inválida no
 * `filter`, ou a sobreposta no `return` abaixo. Num documento de OCR, com
 * centenas de ocorrências e sobreposição frequente, os dois acontecem.
 *
 * Num revisor de tarjas isso é grave e silencioso: quem confere clica na
 * ocorrência 12, o texto rola até outra, e a pessoa acredita ter auditado a
 * que pediu. O erro não aparece em lugar nenhum — os dois números existem, são
 * válidos, e apontam para coisas diferentes.
 */
export function segmentar(texto: string, entidades: EntityFound[]): Segmento[] {
  const ordenadas = entidades
    // O índice original viaja junto, antes de qualquer filtro ou ordenação.
    .map((entidade, indice) => ({ entidade, indice }))
    .filter(({ entidade: e }) => e.start < e.end && e.end <= texto.length)
    .sort((a, b) => a.entidade.start - b.entidade.start);

  const segmentos: Segmento[] = [];
  let cursor = 0;

  ordenadas.forEach(({ entidade, indice }) => {
    if (entidade.start < cursor) return; // sobreposta com a anterior
    if (entidade.start > cursor) {
      segmentos.push({ tipo: "texto", conteudo: texto.slice(cursor, entidade.start) });
    }
    segmentos.push({
      tipo: "entidade",
      conteudo: texto.slice(entidade.start, entidade.end),
      entidade,
      indice,
    });
    cursor = entidade.end;
  });

  if (cursor < texto.length) {
    segmentos.push({ tipo: "texto", conteudo: texto.slice(cursor) });
  }
  return segmentos;
}

/** Uma ocorrência e a sua posição na lista original — o par que não pode se separar. */
export interface OcorrenciaIndexada {
  entidade: EntityFound;
  indice: number;
}

/**
 * Agrupa as ocorrências por tipo, na ordem em que os chips de filtro
 * apareciam: o tipo mais numeroso primeiro.
 *
 * ## O índice é capturado aqui, e é o mesmo invariante do `segmentar`
 *
 * `indice` é a posição em `entitiesFound`, capturada no `forEach` antes de
 * qualquer agrupamento ou reordenação. É o número que a tarja carrega em
 * `data-ocorrencia`, e é por ele que o clique na lista acha o trecho no texto.
 *
 * O painel obtinha esse número com `entitiesFound.indexOf(entidade)` a cada
 * linha. Funcionava — `indexOf` compara por referência —, mas é uma varredura
 * por item e depende de a lista nunca guardar o mesmo objeto duas vezes.
 * Capturar na origem não depende disso.
 *
 * A ordenação por confiança torna a garantia mais necessária, não menos: com
 * ela a posição na lista deixa de ter qualquer relação com a posição no texto,
 * e um índice deduzido da ordem de exibição apontaria para outra tarja. É o
 * defeito que o `segmentar` documenta — os dois números existem, os dois são
 * válidos, e o revisor acredita ter conferido a ocorrência que pediu.
 *
 * @param fracasPrimeiro ordena cada grupo do menor score para o maior — a
 *   pergunta "o que tem mais chance de estar errado?". Só passou a ter
 *   resposta honesta quando o score deixou de ser o máximo do tipo no
 *   documento e passou a ser o da ocorrência.
 */
export function agruparPorTipo(
  entidades: EntityFound[],
  fracasPrimeiro = false
): { tipo: string; itens: OcorrenciaIndexada[] }[] {
  const porTipo = new Map<string, OcorrenciaIndexada[]>();
  entidades.forEach((entidade, indice) => {
    const lista = porTipo.get(entidade.type);
    if (lista) lista.push({ entidade, indice });
    else porTipo.set(entidade.type, [{ entidade, indice }]);
  });

  return [...porTipo.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([tipo, itens]) => ({
      tipo,
      itens: fracasPrimeiro
        ? [...itens].sort((a, b) => a.entidade.score - b.entidade.score)
        : itens,
    }));
}

interface RevisaoProps {
  aoSalvarTodos: () => void;
  aoBaixarArquivo: (arquivo: ProcessedFile) => void;
  /* Recebe o índice porque a rejeição reescreve ESTE documento; sem ele o
     App teria de adivinhar qual dos arquivos do lote está aberto. */
  aoRejeitarDeteccao: (entidade: EntityFound, indiceArquivo: number) => void;
}

export function Revisao({
  aoSalvarTodos,
  aoBaixarArquivo,
  aoRejeitarDeteccao,
}: RevisaoProps) {
  const { estado, despachar, prefs, definirPref } = useApp();
  const revisao = estado.revisao;

  const [indiceArquivo, setIndiceArquivo] = useState(0);
  const [modo, setModo] = useState<Modo>("revisar");
  const [ocorrenciaAtiva, setOcorrenciaAtiva] = useState<number | null>(null);
  /* Recolher um tipo é o que os chips de filtro faziam, sem a faixa de chips:
     o agrupamento já mostra os tipos e a contagem, e recolher é o filtro. */
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  /* Ordem do documento é o padrão porque se revisa de cima para baixo. A
     alternativa serve à pergunta que o revisor faz quando o lote é grande:
     "o que tem mais chance de estar errado?" — e ela só passou a ter resposta
     honesta em 02/09/2026, quando o score deixou de ser o máximo do tipo no
     documento inteiro e passou a ser o da ocorrência. */
  const [fracasPrimeiro, setFracasPrimeiro] = useState(false);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [aRejeitar, setARejeitar] = useState<EntityFound | null>(null);
  const areaTexto = useRef<HTMLDivElement>(null);

  const arquivos = revisao?.arquivos ?? [];
  const indiceSeguro = Math.min(indiceArquivo, Math.max(0, arquivos.length - 1));
  const arquivo = arquivos[indiceSeguro];

  /* A varredura roda uma vez, ao abrir vindo do processamento. Abrir da
     biblioteca não anima: o documento não está sendo carimbado agora, já foi. */
  const [varrendo, setVarrendo] = useState(revisao?.origem === "processamento");
  useEffect(() => {
    if (!varrendo) return;
    const t = setTimeout(() => setVarrendo(false), 700);
    return () => clearTimeout(t);
  }, [varrendo]);

  const grupos = useMemo(
    () => agruparPorTipo(arquivo?.entitiesFound ?? [], fracasPrimeiro),
    [arquivo, fracasPrimeiro]
  );

  const segmentos = useMemo(
    () => segmentar(arquivo?.originalContent ?? "", arquivo?.entitiesFound ?? []),
    [arquivo]
  );

  const irParaOcorrencia = useCallback((indice: number) => {
    setOcorrenciaAtiva(indice);
    const alvo = areaTexto.current?.querySelector(`[data-ocorrencia="${indice}"]`);
    alvo?.scrollIntoView({ block: "center", behavior: "smooth" });
    (alvo as HTMLElement | null)?.focus();
  }, []);

  if (!revisao || !arquivo) return null;

  const total = arquivo.entitiesFound.length;
  const saida = nomeDeSaida(arquivo.originalName, prefs.formato);
  const ocr = arquivo.ocr;

  /**
   * O painel de auditoria, usado tanto na coluna fixa quanto na gaveta.
   *
   * O agrupamento por tipo substituiu a faixa de chips coloridos que ficava
   * sob a barra de ações: ela repetia a informação que os cabeçalhos de grupo
   * já dão (quais tipos existem e quantos), numa faixa de cor forte que
   * competia com o documento — e o documento é o que se veio ler. Recolher um
   * grupo faz o que o chip fazia.
   *
   * "Não é PII" só aparece na linha sob o cursor, focada ou ativa. Repetido em
   * toda linha, ele dobrava a contagem de botões do painel e dava a uma ação
   * permanente (grava na deny-list, vale para todos os documentos seguintes) a
   * mesma presença visual do valor que se está conferindo. Continua no DOM em
   * todas as linhas, alcançável por Tab — `opacity-0` não tira do foco.
   */
  const painelOcorrencias = (
    <>
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-sm font-semibold text-text">
            {total} {total === 1 ? "ocorrência" : "ocorrências"}
          </h2>
          {total > 1 && (
            <Botao
              tamanho="mini"
              tipo="discreto"
              aria-pressed={fracasPrimeiro}
              onClick={() => setFracasPrimeiro((v) => !v)}
              title={
                fracasPrimeiro
                  ? "Ordenado pela confiança, do mais duvidoso ao mais certo"
                  : "Ordenado pela posição no documento"
              }
            >
              {fracasPrimeiro ? "menos certas" : "ordem do texto"}
            </Botao>
          )}
        </div>
        <p className="mt-1 text-xs leading-normal text-text-tertiary">
          Confira cada item. O que não for dado pessoal pode ser liberado — e
          deixa de ser mascarado daqui em diante.
        </p>
      </div>

      {grupos.map(({ tipo, itens }) => {
        const recolhido = recolhidos.has(tipo);
        const cor = corDaEntidade(tipo);
        return (
          <section key={tipo}>
            <h3>
              <button
                onClick={() =>
                  setRecolhidos((atual) => {
                    const proximo = new Set(atual);
                    if (proximo.has(tipo)) proximo.delete(tipo);
                    else proximo.add(tipo);
                    return proximo;
                  })
                }
                aria-expanded={!recolhido}
                className="flex min-h-8 w-full items-center gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-1.5 text-left font-mono text-xs text-text-secondary transition-colors duration-[120ms] hover:text-text"
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: cor }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {rotuloDaEntidade(tipo)}
                </span>
                <span className="text-text-tertiary">{itens.length}</span>
                <Icone
                  nome="avancar"
                  tamanho={12}
                  className={`shrink-0 text-text-tertiary transition-transform duration-[120ms] ${
                    recolhido ? "" : "rotate-90"
                  }`}
                />
              </button>
            </h3>

            {!recolhido && (
              <ul className="divide-y divide-border-subtle">
                {itens.map(({ entidade, indice }) => (
                  <li
                    key={indice}
                    className={`group flex items-center gap-2 px-4 py-2 ${
                      ocorrenciaAtiva === indice ? "bg-surface-hover" : ""
                    }`}
                  >
                    <button
                      onClick={() => irParaOcorrencia(indice)}
                      className="min-w-0 flex-1 rounded-md text-left"
                    >
                      <span className="block truncate font-mono text-xs text-text">
                        {entidade.text}
                      </span>
                    </button>
                    <span className="shrink-0 font-mono text-2xs text-text-tertiary tabular-nums">
                      {Math.round(entidade.score * 100)}%
                    </span>
                    <Botao
                      tamanho="mini"
                      tipo="discreto"
                      className={`shrink-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100 ${
                        ocorrenciaAtiva === indice ? "opacity-100" : "opacity-0"
                      }`}
                      onClick={() => setARejeitar(entidade)}
                      title="Não é dado pessoal — nunca mascarar este termo"
                      aria-label={`Liberar "${entidade.text}" da anonimização`}
                    >
                      liberar
                    </Botao>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {total === 0 && (
        <p className="px-4 py-6 text-center text-xs text-text-tertiary">
          Nenhuma entidade encontrada neste arquivo.
        </p>
      )}
    </>
  );

  return (
    <div className="flex h-full animate-fade-in flex-col">
      {/*
        Barra de ações — uma linha, três zonas: onde estou (esquerda), o que
        estou vendo (centro-direita), o que faço com isso (direita).

        Antes eram três grupos disputando a mesma linha, mais uma faixa de
        chips embaixo. Duas coisas saíram:

        - **As abas por arquivo.** Nomes do PJe têm prefixo numérico e sufixo
          de id ("036_Decisao_221675339.txt"), então todas as abas começam e
          terminam iguais e o meio é o que distingue — exatamente o que a
          truncagem come. Um paginador mostra o nome inteiro de um documento
          por vez e não cresce com o tamanho do lote.
        - **O par MD/DOCX.** É preferência de saída, não ato de revisão, e já
          existe em Ajustes → "Formato do arquivo salvo". Duas fontes para a
          mesma verdade na tela mais crítica do produto. Ficou no menu, ao
          lado de "Baixar cópia", perto de onde o formato importa.
      */}
      {/* `relative` não é decoração: sem `position`, o `z-10` que estava
          aqui não fazia nada — e o popover de ações, que nasce dentro
          desta faixa, era coberto pelo painel de ocorrências. */}
      <div className="relative z-100 shrink-0 border-b border-border-subtle bg-surface px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Botao
              tipo="secundario"
              icone="voltar"
              onClick={() => despachar({ tipo: "fechar-revisao" })}
            >
              Voltar
            </Botao>

            <span className="min-w-0 truncate font-mono text-sm text-text">
              {arquivo.originalName}
            </span>

            {arquivos.length > 1 && (
              <div className="flex shrink-0 items-center gap-1">
                <Botao
                  tamanho="mini"
                  tipo="discreto"
                  icone="voltar"
                  disabled={indiceSeguro === 0}
                  onClick={() => setIndiceArquivo(indiceSeguro - 1)}
                  aria-label="Documento anterior"
                />
                <span
                  aria-live="polite"
                  className="font-mono text-xs text-text-tertiary tabular-nums"
                >
                  {indiceSeguro + 1} de {arquivos.length}
                </span>
                <Botao
                  tamanho="mini"
                  tipo="discreto"
                  icone="avancar"
                  disabled={indiceSeguro === arquivos.length - 1}
                  onClick={() => setIndiceArquivo(indiceSeguro + 1)}
                  aria-label="Próximo documento"
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <GrupoSegmentado
              rotulo="Modo de visualização"
              opcoes={[
                { valor: "revisar" as const, rotulo: "Revisar", descricao: "Texto original com as tarjas" },
                { valor: "resultado" as const, rotulo: "Resultado", descricao: "O texto que vai ser salvo" },
              ]}
              valor={modo}
              onChange={setModo}
            />

            <Botao tipo="primario" onClick={aoSalvarTodos}>
              Salvar {arquivos.length > 1 ? `todos · ${arquivos.length}` : ""}
            </Botao>

            <Popover
              rotulo="Mais ações"
              alinhamento="fim"
              larguraMinima={280}
              gatilho={(props) => (
                <Botao
                  {...props}
                  tipo="discreto"
                  icone="reticencias"
                  aria-label="Mais ações"
                />
              )}
            >
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1.5 font-mono text-xs text-text-secondary">
                    Formato do arquivo salvo
                  </p>
                  {/* A saída é texto — nunca o formato de entrada. Gravar
                      markdown dentro de um `.pdf` produzia um arquivo que
                      nenhum leitor abre. */}
                  <GrupoSegmentado
                    rotulo="Formato de saída"
                    opcoes={[
                      { valor: "md" as const, rotulo: "MD", descricao: "Markdown — abre em qualquer editor" },
                      { valor: "docx" as const, rotulo: "DOCX", descricao: "Word, LibreOffice ou Google Docs" },
                    ]}
                    valor={prefs.formato}
                    onChange={(f) => definirPref("formato", f)}
                  />
                  <p className="mt-1.5 truncate font-mono text-2xs text-text-tertiary">
                    {saida}
                  </p>
                </div>
                <Botao icone="baixar" onClick={() => aoBaixarArquivo(arquivo)}>
                  Baixar cópia deste
                </Botao>
              </div>
            </Popover>

            {/* Abaixo de 1024px o painel vira gaveta; o botão só existe aí. */}
            <Botao
              className="lg:hidden"
              icone="olho"
              onClick={() => setGavetaAberta(true)}
              aria-label="Abrir a lista de ocorrências"
            >
              {total}
            </Botao>
          </div>
        </div>

        {/* Como o documento foi lido. `paginas_com_erro` não pode ser escondido:
            são páginas que precisavam de OCR e não voltaram. O texto delas não
            está no resultado, e quem revisa precisa saber antes de assinar. */}
        {ocr?.houve_ocr && (
          <div
            role={ocr.paginas_com_erro > 0 ? "alert" : "status"}
            className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
              ocr.paginas_com_erro > 0
                ? "border-danger text-danger"
                : "border-warning text-warning"
            }`}
          >
            <Icone nome="alerta" tamanho={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              {ocr.paginas_com_erro > 0 ? (
                <>
                  <strong>
                    {ocr.paginas_com_erro}{" "}
                    {ocr.paginas_com_erro === 1
                      ? "página não foi lida"
                      : "páginas não foram lidas"}
                  </strong>
                  {" — o texto delas não está aqui, e o que não está aqui não foi anonimizado nem revisado."}
                </>
              ) : (
                <>
                  <strong>
                    {ocr.paginas_ocr} de {ocr.total_paginas}{" "}
                    {ocr.total_paginas === 1 ? "página lida" : "páginas lidas"} por
                    reconhecimento de imagem
                  </strong>
                  {" — reconhecimento erra; confira o resultado antes de entregar."}
                </>
              )}
            </div>
          </div>
        )}

      </div>

      <div className="flex min-h-0 flex-1">
        {/* Texto do documento */}
        <div ref={areaTexto} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl p-5">
            {/* Só o destino: o nome de origem já está na barra, três
                centímetros acima, e repeti-lo aqui gastava a linha inteira
                para dizer de novo onde estamos. */}
            <div className="mb-3 flex items-center gap-1.5 font-mono text-2xs text-text-tertiary">
              <span aria-hidden="true">→</span>
              <span className="truncate text-accent">{saida}</span>
            </div>

            {modo === "revisar" && (
              <p className="mb-4 text-xs text-text-tertiary">
                Cada tarja esconde um dado detectado. Passe o cursor ou navegue
                por teclado para conferir o valor original por baixo.
              </p>
            )}

            <Cartao>
              <div className="texto-documento whitespace-pre-wrap text-text">
                {modo === "resultado"
                  ? arquivo.anonymizedContent
                  : segmentos.map((seg, i) =>
                      seg.tipo === "texto" ? (
                        <span key={i}>{seg.conteudo}</span>
                      ) : (
                        <Tarja
                          key={i}
                          tipo={seg.entidade.type}
                          indice={seg.indice}
                          revelada={ocorrenciaAtiva === seg.indice}
                          varrendo={varrendo}
                          onClick={() =>
                            setOcorrenciaAtiva(
                              ocorrenciaAtiva === seg.indice ? null : seg.indice
                            )
                          }
                        >
                          {seg.conteudo}
                        </Tarja>
                      )
                    )}
              </div>
            </Cartao>
          </div>
        </div>

        {/* Painel de ocorrências: coluna fixa a partir de 1024px. */}
        <aside
          aria-label="Ocorrências detectadas"
          className="hidden w-80 shrink-0 overflow-y-auto border-l border-border-subtle bg-surface lg:block"
        >
          {painelOcorrencias}
        </aside>
      </div>

      {/* …e gaveta abaixo disso, para a auditoria nunca ficar inalcançável. */}
      {gavetaAberta && (
        <div
          className="fixed inset-0 z-100 flex justify-end bg-[rgb(22_24_29/0.55)] lg:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGavetaAberta(false);
          }}
        >
          <div
            role="dialog"
            aria-label="Ocorrências detectadas"
            className="flex w-[min(20rem,90vw)] flex-col overflow-y-auto border-l border-border bg-surface"
          >
            <div className="flex justify-end p-2">
              <Botao
                tamanho="mini"
                tipo="discreto"
                icone="fechar"
                onClick={() => setGavetaAberta(false)}
                aria-label="Fechar a lista de ocorrências"
              />
            </div>
            {painelOcorrencias}
          </div>
        </div>
      )}

      <Dialogo
        aberto={aRejeitar !== null}
        aoFechar={() => setARejeitar(null)}
        titulo="Liberar da anonimização"
        acoes={
          <>
            <Botao tipo="secundario" onClick={() => setARejeitar(null)}>
              Cancelar
            </Botao>
            <Botao
              tipo="perigo"
              onClick={() => {
                if (aRejeitar) aoRejeitarDeteccao(aRejeitar, indiceArquivo);
                setARejeitar(null);
              }}
            >
              Liberar o termo
            </Botao>
          </>
        }
      >
        <p>
          <strong className="text-text">“{aRejeitar?.text}”</strong> deixa de ser
          mascarado — neste e em <strong className="text-text">todos</strong> os
          documentos seguintes, até você removê-lo nos Ajustes.
        </p>
        <p className="mt-2 text-text-tertiary">
          Use quando for mesmo um falso positivo: um nome de vara, um termo
          técnico, um nome de instituição. Se for dado de uma pessoa, mantenha a
          tarja.
        </p>
      </Dialogo>
    </div>
  );
}
