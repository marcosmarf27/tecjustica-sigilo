import { useMemo, useState, useRef, useCallback } from "react";
import type { EntityFound, ProcessedFile } from "../types";
import { ALL_ENTITIES } from "../types";

interface RevisaoViewProps {
  files: ProcessedFile[];
  onSaveAll: () => void;
  onDownloadFile: (file: ProcessedFile) => void;
  onBack: () => void;
  /** Marca um trecho como "não é dado pessoal" e o remove da anonimização. */
  onRejeitarDeteccao: (entidade: EntityFound) => void;
}

type Modo = "revisar" | "resultado";

/** Segmento de texto: trecho comum ou uma ocorrência detectada. */
type Segmento =
  | { tipo: "texto"; conteudo: string }
  | { tipo: "entidade"; conteudo: string; entidade: EntityFound; indice: number };

const corDaEntidade = (tipo: string) =>
  ALL_ENTITIES.find((e) => e.id === tipo)?.color ?? "#918a9b";

const rotuloDaEntidade = (tipo: string) =>
  ALL_ENTITIES.find((e) => e.id === tipo)?.label ?? tipo;

/**
 * Divide o texto original nos pontos onde há detecção, para que cada
 * ocorrência possa ser tarjada, focada e auditada individualmente.
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

export function RevisaoView({
  files,
  onSaveAll,
  onDownloadFile,
  onBack,
  onRejeitarDeteccao,
}: RevisaoViewProps) {
  const [indiceArquivo, setIndiceArquivo] = useState(0);
  const [modo, setModo] = useState<Modo>("revisar");
  const [tipoFiltrado, setTipoFiltrado] = useState<string | null>(null);
  const [ocorrenciaAtiva, setOcorrenciaAtiva] = useState<number | null>(null);
  const areaTextoRef = useRef<HTMLDivElement>(null);

  const indiceSeguro = Math.min(indiceArquivo, files.length - 1);
  const arquivo = files[indiceSeguro];

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
    const alvo = areaTextoRef.current?.querySelector(`[data-ocorrencia="${indice}"]`);
    alvo?.scrollIntoView({ block: "center", behavior: "smooth" });
    (alvo as HTMLElement | null)?.focus();
  }, []);

  if (!arquivo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
        <p className="text-sm">Nenhum arquivo processado ainda.</p>
        <button
          onClick={onBack}
          className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text"
        >
          Escolher arquivos
        </button>
      </div>
    );
  }

  const total = arquivo.entitiesFound.length;
  const nomeSaida = (() => {
    const ponto = arquivo.originalName.lastIndexOf(".");
    const base = ponto > 0 ? arquivo.originalName.slice(0, ponto) : arquivo.originalName;
    const ext = arquivo.originalName.toLowerCase().endsWith(".rtf")
      ? ".txt"
      : ponto > 0
        ? arquivo.originalName.slice(ponto)
        : ".txt";
    return `${base}_anonimizado${ext}`;
  })();

  return (
    <div className="flex h-full animate-fade-in flex-col">
      {/* Barra de ações */}
      <div className="z-sticky shrink-0 border-b border-border-subtle bg-surface px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={onBack}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 19l-7-7 7-7" />
              </svg>
              Voltar
            </button>

            {files.length > 1 && (
              <div role="tablist" aria-label="Arquivos processados" className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-surface-raised p-0.5">
                {files.map((f, i) => (
                  <button
                    key={f.originalPath || f.originalName}
                    role="tab"
                    aria-selected={i === indiceSeguro}
                    onClick={() => setIndiceArquivo(i)}
                    className={`shrink-0 rounded-md px-2.5 py-1 text-2xs font-medium whitespace-nowrap transition ${
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
            {/* Alternância entre auditar e ver o resultado */}
            <div role="group" aria-label="Modo de visualização" className="flex rounded-lg bg-surface-raised p-0.5">
              {(["revisar", "resultado"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModo(m)}
                  aria-pressed={modo === m}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    modo === m
                      ? "bg-accent text-on-accent"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {m === "revisar" ? "Revisar" : "Resultado"}
                </button>
              ))}
            </div>

            <button
              onClick={() => onDownloadFile(arquivo)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition hover:bg-surface-hover hover:text-text"
            >
              Baixar cópia
            </button>
            <button
              onClick={onSaveAll}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold whitespace-nowrap text-on-accent shadow-sm transition hover:bg-accent-hover"
            >
              Salvar {files.length > 1 ? `todos (${files.length})` : ""}
            </button>
          </div>
        </div>

        {/* Como o documento foi lido.
            Este aviso já existiu e nunca chegou a ninguém: ele vivia em
            `job.etapa`, que a etapa seguinte sobrescrevia em microssegundos —
            a interface só o veria por coincidência do intervalo de polling.
            Agora viaja no resultado e fica na tela enquanto a revisão durar. */}
        {arquivo.ocr?.houve_ocr && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-2xs ${
              arquivo.ocr.paginas_com_erro > 0
                ? "border-danger/40 bg-danger/10 text-danger"
                : "border-warning/40 bg-warning/10 text-warning"
            }`}
            role={arquivo.ocr.paginas_com_erro > 0 ? "alert" : "status"}
          >
            <svg className="mt-px h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
            </svg>
            <div className="min-w-0">
              {arquivo.ocr.paginas_com_erro > 0 ? (
                <>
                  <strong className="font-semibold">
                    {arquivo.ocr.paginas_com_erro}{" "}
                    {arquivo.ocr.paginas_com_erro === 1 ? "página não foi lida" : "páginas não foram lidas"}
                  </strong>
                  {" — o texto delas não está aqui, e o que não está aqui não foi anonimizado nem revisado."}
                </>
              ) : (
                <>
                  <strong className="font-semibold">
                    {arquivo.ocr.paginas_ocr} de {arquivo.ocr.total_paginas}{" "}
                    {arquivo.ocr.total_paginas === 1 ? "página lida" : "páginas lidas"} por reconhecimento de imagem
                  </strong>
                  {" — reconhecimento erra; confira o resultado antes de entregar."}
                </>
              )}
            </div>
          </div>
        )}

        {/* Filtro por tipo */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-2xs font-medium text-text-tertiary">
            {total} {total === 1 ? "ocorrência" : "ocorrências"}:
          </span>
          <button
            onClick={() => setTipoFiltrado(null)}
            aria-pressed={tipoFiltrado === null}
            className={`rounded-full px-2.5 py-1 text-2xs font-medium transition ${
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
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium transition"
                  style={{
                    backgroundColor: ativo ? cor : `${cor}1f`,
                    color: ativo ? "var(--color-on-accent)" : cor,
                    border: `1px solid ${cor}40`,
                  }}
                >
                  {rotuloDaEntidade(tipo)} {contagem}
                </button>
              );
            })}
          {total === 0 && (
            <span className="text-2xs text-text-tertiary">
              Nenhuma entidade encontrada neste arquivo.
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Texto */}
        <div ref={areaTextoRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-5">
            <div className="mb-3 flex items-center gap-2 text-xs text-text-tertiary">
              <span className="font-medium text-text-secondary">
                {arquivo.originalName}
              </span>
              <span aria-hidden="true">→</span>
              <span className="font-medium text-accent">{nomeSaida}</span>
            </div>

            {modo === "revisar" && (
              <p className="mb-4 text-xs text-text-tertiary">
                Cada tarja esconde um dado detectado. Passe o cursor ou navegue por
                teclado para conferir o valor original por baixo.
              </p>
            )}

            <div className="rounded-xl border border-border-subtle bg-surface p-5 shadow-sm">
              {modo === "resultado" ? (
                <pre className="font-mono text-sm leading-document whitespace-pre-wrap text-text-secondary">
                  {arquivo.anonymizedContent}
                </pre>
              ) : (
                <pre className="font-mono text-sm leading-document whitespace-pre-wrap text-text-secondary">
                  {segmentos.map((seg, i) =>
                    seg.tipo === "texto" ? (
                      <span key={i}>{seg.conteudo}</span>
                    ) : (
                      <span
                        key={i}
                        className="tarja"
                        tabIndex={0}
                        role="button"
                        data-ocorrencia={seg.indice}
                        data-revelada={ocorrenciaAtiva === seg.indice}
                        style={
                          {
                            "--cor-entidade": corDaEntidade(seg.entidade.type),
                          } as React.CSSProperties
                        }
                        title={`${rotuloDaEntidade(seg.entidade.type)} · confiança ${Math.round(seg.entidade.score * 100)}%`}
                        aria-label={`${rotuloDaEntidade(seg.entidade.type)} oculto. Ative para revelar.`}
                        onClick={() =>
                          setOcorrenciaAtiva(
                            ocorrenciaAtiva === seg.indice ? null : seg.indice
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOcorrenciaAtiva(
                              ocorrenciaAtiva === seg.indice ? null : seg.indice
                            );
                          }
                        }}
                      >
                        {seg.conteudo}
                      </span>
                    )
                  )}
                </pre>
              )}
            </div>
          </div>
        </div>

        {/* Lista de ocorrências */}
        <aside
          aria-label="Ocorrências detectadas"
          className="hidden w-80 shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-raised lg:block"
        >
          <div className="sticky top-0 border-b border-border-subtle bg-surface-raised px-4 py-3">
            <h2 className="text-xs font-semibold text-text">
              O que foi encontrado
            </h2>
            <p className="mt-0.5 text-2xs text-text-tertiary">
              Confira cada item. Se algo não for dado pessoal, marque — e ele
              deixa de ser mascarado daqui em diante.
            </p>
          </div>

          <ul className="divide-y divide-border-subtle">
            {entidadesVisiveis.map((entidade, i) => {
              const indiceGlobal = arquivo.entitiesFound.indexOf(entidade);
              const cor = corDaEntidade(entidade.type);
              return (
                <li key={`${entidade.start}-${i}`}>
                  <div
                    className={`px-4 py-2.5 transition ${
                      ocorrenciaAtiva === indiceGlobal ? "bg-surface-hover" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => irParaOcorrencia(indiceGlobal)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span
                          className="inline-block rounded-full px-1.5 py-0.5 text-2xs font-medium"
                          style={{ backgroundColor: `${cor}1f`, color: cor }}
                        >
                          {rotuloDaEntidade(entidade.type)}
                        </span>
                        <span className="mt-1 block truncate font-mono text-xs text-text">
                          {entidade.text}
                        </span>
                        <span className="text-2xs text-text-tertiary">
                          confiança {Math.round(entidade.score * 100)}%
                        </span>
                      </button>
                      <button
                        onClick={() => onRejeitarDeteccao(entidade)}
                        title="Não é dado pessoal — nunca mascarar este termo"
                        aria-label={`Marcar "${entidade.text}" como não sendo dado pessoal`}
                        className="mt-1 shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-text-tertiary transition hover:border-danger hover:text-danger"
                      >
                        Não é PII
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            {entidadesVisiveis.length === 0 && (
              <li className="px-4 py-6 text-center text-2xs text-text-tertiary">
                Nada para mostrar com este filtro.
              </li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}
