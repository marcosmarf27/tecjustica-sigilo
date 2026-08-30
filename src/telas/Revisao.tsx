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
  Selo,
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
type Segmento =
  | { tipo: "texto"; conteudo: string }
  | { tipo: "entidade"; conteudo: string; entidade: EntityFound; indice: number };

/**
 * Divide o texto original nos pontos onde há detecção, para que cada ocorrência
 * possa ser tarjada, focada e auditada individualmente.
 */
function segmentar(texto: string, entidades: EntityFound[]): Segmento[] {
  const ordenadas = [...entidades]
    .filter((e) => e.start < e.end && e.end <= texto.length)
    .sort((a, b) => a.start - b.start);

  const segmentos: Segmento[] = [];
  let cursor = 0;

  ordenadas.forEach((entidade, indice) => {
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

interface RevisaoProps {
  aoSalvarTodos: () => void;
  aoBaixarArquivo: (arquivo: ProcessedFile) => void;
  aoRejeitarDeteccao: (entidade: EntityFound) => void;
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
  const [tipoFiltrado, setTipoFiltrado] = useState<string | null>(null);
  const [ocorrenciaAtiva, setOcorrenciaAtiva] = useState<number | null>(null);
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

  const contagens = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const e of arquivo?.entitiesFound ?? []) {
      mapa[e.type] = (mapa[e.type] || 0) + 1;
    }
    return mapa;
  }, [arquivo]);

  const entidadesVisiveis = useMemo(
    () =>
      (arquivo?.entitiesFound ?? []).filter(
        (e) => !tipoFiltrado || e.type === tipoFiltrado
      ),
    [arquivo, tipoFiltrado]
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

  /** O painel de auditoria, usado tanto na coluna fixa quanto na gaveta. */
  const painelOcorrencias = (
    <>
      <div className="border-b border-border-subtle px-4 py-3">
        <h2 className="font-mono text-2xs font-semibold tracking-wide text-text uppercase">
          O que foi encontrado
        </h2>
        <p className="mt-1 text-xs leading-normal text-text-tertiary">
          Confira cada item. O que não for dado pessoal pode ser liberado — e
          deixa de ser mascarado daqui em diante.
        </p>
      </div>

      <ul className="divide-y divide-border-subtle">
        {entidadesVisiveis.map((entidade, i) => {
          const indiceGlobal = arquivo.entitiesFound.indexOf(entidade);
          return (
            <li
              key={`${entidade.start}-${i}`}
              className={
                ocorrenciaAtiva === indiceGlobal ? "bg-surface-hover" : ""
              }
            >
              <div className="flex items-start justify-between gap-2 px-4 py-2.5">
                <button
                  onClick={() => irParaOcorrencia(indiceGlobal)}
                  className="min-w-0 flex-1 text-left"
                >
                  <Selo tom="entidade" cor={corDaEntidade(entidade.type)}>
                    {rotuloDaEntidade(entidade.type)}
                  </Selo>
                  <span className="mt-1 block truncate font-mono text-xs text-text">
                    {entidade.text}
                  </span>
                  <span className="font-mono text-2xs text-text-tertiary">
                    confiança {Math.round(entidade.score * 100)}%
                  </span>
                </button>
                <Botao
                  tamanho="mini"
                  tipo="discreto"
                  onClick={() => setARejeitar(entidade)}
                  title="Não é dado pessoal — nunca mascarar este termo"
                  aria-label={`Liberar "${entidade.text}" da anonimização`}
                >
                  Não é PII
                </Botao>
              </div>
            </li>
          );
        })}
        {entidadesVisiveis.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-text-tertiary">
            Nada para mostrar com este filtro.
          </li>
        )}
      </ul>
    </>
  );

  return (
    <div className="flex h-full animate-fade-in flex-col">
      {/* Barra de ações */}
      <div className="z-10 shrink-0 border-b border-border-subtle bg-surface px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Botao
              tipo="secundario"
              icone="voltar"
              onClick={() => despachar({ tipo: "fechar-revisao" })}
            >
              Voltar
            </Botao>

            {arquivos.length > 1 && (
              <div
                role="tablist"
                aria-label="Arquivos processados"
                className="flex min-w-0 gap-1 overflow-x-auto rounded-md bg-surface-sunken p-0.5"
              >
                {arquivos.map((f, i) => (
                  <button
                    key={f.originalPath || f.originalName}
                    role="tab"
                    aria-selected={i === indiceSeguro}
                    onClick={() => setIndiceArquivo(i)}
                    className={`shrink-0 rounded px-2.5 py-1 font-mono text-2xs whitespace-nowrap transition-colors ${
                      i === indiceSeguro
                        ? "bg-accent text-on-accent"
                        : "text-text-tertiary hover:text-text-secondary"
                    }`}
                  >
                    {f.originalName}
                  </button>
                ))}
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

            {/* A saída é texto — nunca o formato de entrada. Gravar markdown
                dentro de um `.pdf` produzia um arquivo que nenhum leitor abre. */}
            <GrupoSegmentado
              rotulo="Formato de saída"
              opcoes={[
                { valor: "md" as const, rotulo: "MD", descricao: "Markdown — abre em qualquer editor" },
                { valor: "docx" as const, rotulo: "DOCX", descricao: "Word, LibreOffice ou Google Docs" },
              ]}
              valor={prefs.formato}
              onChange={(f) => definirPref("formato", f)}
            />

            <Botao icone="baixar" onClick={() => aoBaixarArquivo(arquivo)}>
              Baixar cópia
            </Botao>
            <Botao tipo="primario" onClick={aoSalvarTodos}>
              Salvar {arquivos.length > 1 ? `todos · ${arquivos.length}` : ""}
            </Botao>

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

        {/* Filtro por tipo */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-2xs tracking-wide text-text-tertiary uppercase">
            {total} {total === 1 ? "ocorrência" : "ocorrências"}
          </span>
          <button
            onClick={() => setTipoFiltrado(null)}
            aria-pressed={tipoFiltrado === null}
            className={`min-h-6 rounded-full px-2.5 py-1 font-mono text-2xs transition-colors ${
              tipoFiltrado === null
                ? "bg-accent text-on-accent"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Todas
          </button>
          {Object.entries(contagens)
            .sort(([, a], [, b]) => b - a)
            .map(([tipo, contagem]) => {
              const cor = corDaEntidade(tipo);
              const ativo = tipoFiltrado === tipo;
              return (
                <button
                  key={tipo}
                  onClick={() => setTipoFiltrado(ativo ? null : tipo)}
                  aria-pressed={ativo}
                  className="inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-2xs transition-colors"
                  style={{
                    backgroundColor: ativo
                      ? cor
                      : `color-mix(in srgb, ${cor} 12%, transparent)`,
                    color: ativo ? "var(--sobre-acao)" : cor,
                  }}
                >
                  {rotuloDaEntidade(tipo)} {contagem}
                </button>
              );
            })}
          {total === 0 && (
            <span className="text-xs text-text-tertiary">
              Nenhuma entidade encontrada neste arquivo.
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Texto do documento */}
        <div ref={areaTexto} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl p-5">
            <div className="mb-3 flex items-center gap-2 font-mono text-2xs text-text-tertiary">
              <span className="text-text-secondary">{arquivo.originalName}</span>
              <span aria-hidden="true">→</span>
              <span className="text-accent">{saida}</span>
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
                if (aRejeitar) aoRejeitarDeteccao(aRejeitar);
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
