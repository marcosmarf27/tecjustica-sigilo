import { useState, useCallback, useRef } from "react";
import { usePythonBackend } from "./hooks/usePythonBackend";
import { useHistory } from "./hooks/useHistory";
import { Sidebar } from "./components/Sidebar";
import { FileSelector } from "./components/FileSelector";
import { EntityConfig } from "./components/EntityConfig";
import { ProcessingView } from "./components/ProcessingView";
import { RevisaoView } from "./components/RevisaoView";
import { CliInstaller } from "./components/CliInstaller";
import { Toast } from "./components/Toast";
import { caminhoDeSaida, nomeDeSaida } from "./lib/nomeDeSaida";
import type { FormatoSaida } from "./lib/nomeDeSaida";
import { gerarDocx } from "./lib/gerarDocx";
import type {
  FileItem,
  ProcessedFile,
  EntityType,
  HistoryItem,
  EntityFound,
  PoliticaMascara,
} from "./types";
import { ALL_ENTITIES } from "./types";
import { PoliticaSelector } from "./components/PoliticaSelector";

type AppScreen = "select" | "processing" | "preview" | "cli";

interface ToastState {
  message: string;
  type: "success" | "error";
}

export default function App() {
  const {
    status,
    nlpMode,
    avisoDeModo,
    anonymize,
    processar,
    extractText,
    reconectar,
    adicionarNaDenyList,
  } = usePythonBackend();
  const history = useHistory();
  const [screen, setScreen] = useState<AppScreen>("select");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(
    ALL_ENTITIES.map((e) => e.id)
  );
  const [politicaMascara, setPoliticaMascara] =
    useState<PoliticaMascara>("placeholder");
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string>();
  const [toast, setToast] = useState<ToastState | null>(null);
  const cancelamentoRef = useRef<AbortController | null>(null);
  const [processingProgress, setProcessingProgress] = useState({
    current: 0,
    total: 0,
    fileName: "",
    phase: "Preparando",
  });

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
    },
    []
  );

  // Flush de render: força o React a processar state updates pendentes
  const flush = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  const handleAnonymize = async () => {
    if (files.length === 0 || selectedEntities.length === 0) return;

    setScreen("processing");
    setProcessingProgress({
      current: 0,
      total: files.length,
      fileName: files[0].name,
      phase: "Preparando",
    });
    await flush();

    const results: ProcessedFile[] = [];
    // Nome e motivo: dizer só que falhou deixa quem opera sem nenhuma pista do
    // que fazer a seguir — e a causa costuma ser acionável (arquivo enorme,
    // backend fora do ar, formato recusado).
    const falhas: { nome: string; motivo: string }[] = [];
    const controller = new AbortController();
    cancelamentoRef.current = controller;

    try {
      for (let i = 0; i < files.length; i++) {
        if (controller.signal.aborted) break;
        const file = files[i];

        setProcessingProgress({
          current: i,
          total: files.length,
          fileName: file.name,
          phase: `Analisando ${i + 1} de ${files.length}`,
        });
        await flush();

        const isRtf = file.name.toLowerCase().endsWith(".rtf");

        try {
          // Documento binário (PDF, DOCX, imagem) é lido pelo backend, que faz
          // OCR quando a página é digitalizada. Texto já em mãos vai direto.
          const entrada = file.precisaExtracao
            ? { caminho: file.path, nomeArquivo: file.name }
            : {
                texto: isRtf
                  ? await extractText(file.content, "rtf")
                  : file.content,
                nomeArquivo: file.name,
              };

          const result = await processar(
            entrada,
            selectedEntities,
            politicaMascara,
            (p) =>
              setProcessingProgress({
                current: p.atual,
                total: p.total,
                fileName: file.name,
                phase:
                  files.length > 1
                    ? `${p.etapa} (${i + 1} de ${files.length})`
                    : p.etapa,
              }),
            controller.signal
          );

          results.push({
            originalName: file.name,
            originalPath: file.path,
            originalContent: result.texto_original,
            anonymizedContent: result.anonymized_text,
            entitiesFound: result.entities_found,
            ocr: result.ocr,
          });
        } catch (err) {
          if (controller.signal.aborted) break;
          // Um arquivo problemático não pode levar o lote inteiro junto.
          falhas.push({
            nome: file.name,
            motivo: err instanceof Error ? err.message : "erro desconhecido",
          });
          console.error(`Falha em ${file.name}:`, err);
        }

        setProcessingProgress({
          current: i + 1,
          total: files.length,
          fileName: file.name,
          phase:
            i + 1 === files.length
              ? "Concluído"
              : `Concluído ${i + 1} de ${files.length}`,
        });
        await flush();
      }
    } catch (err) {
      console.error("Erro na anonimização:", err);
      showToast(
        `Erro ao processar: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        "error"
      );
    } finally {
      cancelamentoRef.current = null;

      if (controller.signal.aborted) {
        showToast("Anonimização cancelada.", "error");
      } else if (falhas.length > 0) {
        // Com um arquivo só, o motivo é a informação inteira: sem ele a pessoa
        // fica olhando para "não deu" sem saber se tenta de novo, troca o
        // arquivo ou reinicia o aplicativo.
        const detalhe =
          falhas.length === 1
            ? falhas[0].motivo
            : falhas.map((f) => `${f.nome}: ${f.motivo}`).join(" · ");

        showToast(
          falhas.length === files.length
            ? `Não foi possível processar. ${detalhe}`
            : `${results.length} de ${files.length} processados. ${detalhe}`,
          "error"
        );
      }

      // SEMPRE sai da tela de processing, mesmo com erro
      if (results.length > 0) {
        setProcessedFiles(results);
        const entry = history.addEntry(results);
        setActiveHistoryId(entry.id);
        setScreen("preview");
      } else {
        setScreen("select");
      }
    }
  };

  const [formatoSaida, setFormatoSaida] = useState<FormatoSaida>("md");

  const buildSavePath = (file: ProcessedFile, formato: FormatoSaida) =>
    window.electronAPI
      ? caminhoDeSaida(file.originalPath, file.originalName, formato)
      : nomeDeSaida(file.originalName, formato);

  /** O conteúdo a gravar, no formato escolhido. DOCX vira base64. */
  const conteudoDeSaida = async (file: ProcessedFile, formato: FormatoSaida) => {
    if (formato !== "docx") {
      return { texto: file.anonymizedContent, binario: false as const };
    }
    const blob = await gerarDocx(file.anonymizedContent, {
      nomeOriginal: file.originalName,
      ocorrencias: file.entitiesFound.length,
      paginasOcr: file.ocr?.paginas_ocr,
      paginasComErro: file.ocr?.paginas_com_erro,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bruto = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      bruto += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return { texto: btoa(bruto), binario: true as const, blob };
  };

  const handleSaveAll = async () => {
    let savedCount = 0;
    const savedPaths: string[] = [];

    try {
      for (const file of processedFiles) {
        const savePath = buildSavePath(file, formatoSaida);
        const saida = await conteudoDeSaida(file, formatoSaida);

        if (window.electronAPI) {
          if (saida.binario) {
            await window.electronAPI.saveFileBinary(savePath, saida.texto);
          } else {
            await window.electronAPI.saveFile(savePath, saida.texto);
          }
          savedPaths.push(savePath);
        } else {
          const blob = new Blob([file.anonymizedContent], {
            type: "text/plain",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = savePath;
          a.click();
          URL.revokeObjectURL(url);
          savedPaths.push(savePath);
        }
        savedCount++;
      }

      if (savedCount === 1) {
        showToast(`Salvo em: ${savedPaths[0]}`, "success");
      } else {
        // Pega o diretório comum
        const sep = savedPaths[0].includes("\\") ? "\\" : "/";
        const dir = savedPaths[0].substring(
          0,
          savedPaths[0].lastIndexOf(sep)
        );
        showToast(
          `${savedCount} arquivos salvos em: ${dir || "Downloads"}`,
          "success"
        );
      }
    } catch (err) {
      showToast(
        `Erro ao salvar: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        "error"
      );
    }
  };

  const handleDownloadSingle = async (file: ProcessedFile) => {
    const newName = nomeDeSaida(file.originalName, formatoSaida);
    const saida = await conteudoDeSaida(file, formatoSaida);

    const blob =
      saida.blob ??
      new Blob([saida.texto], {
        type: newName.endsWith(".md") ? "text/markdown" : "text/plain",
      });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = newName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Download: ${newName}`, "success");
  };

  const handleRejeitarDeteccao = async (entidade: EntityFound) => {
    try {
      await adicionarNaDenyList(entidade.type, entidade.text);
      showToast(
        `"${entidade.text}" não será mais mascarado. Processe de novo para ver o efeito.`,
        "success"
      );
    } catch (err) {
      showToast(
        `Não foi possível gravar a exceção: ${err instanceof Error ? err.message : "erro desconhecido"}`,
        "error"
      );
    }
  };

  const handleCancelar = () => {
    cancelamentoRef.current?.abort();
  };

  const handleBack = () => {
    setScreen("select");
    setProcessedFiles([]);
    setActiveHistoryId(undefined);
  };

  const handleNewProcess = () => {
    setScreen("select");
    setFiles([]);
    setProcessedFiles([]);
    setActiveHistoryId(undefined);
  };

  const handleOpenHistoryEntry = (entry: HistoryItem) => {
    const resultados = history.resultadosDe(entry.id);
    if (!resultados || resultados.length === 0) {
      showToast(
        "Este processamento é de uma sessão anterior. O conteúdo não fica salvo em disco — processe o arquivo de novo.",
        "error"
      );
      return;
    }
    setProcessedFiles(resultados);
    setActiveHistoryId(entry.id);
    setScreen("preview");
  };

  // Loading screen
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="animate-fade-in text-center">
          <div className="relative mx-auto mb-6 h-16 w-16">
            <div className="absolute inset-0 rounded-2xl bg-accent/20" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                className="h-7 w-7 text-accent"
                style={{ animation: "spin 2s linear infinite" }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
          <h2 className="text-lg font-semibold text-text">
            Carregando motor de anonimização
          </h2>
          <p className="mt-2 text-sm text-text-tertiary">
            {nlpMode === "transformer"
              ? "Inicializando modelo BERT jurídico (primeira execução pode levar alguns minutos)..."
              : "O modelo de linguagem está sendo inicializado..."}
          </p>
          <div className="mx-auto mt-6 h-1 w-48 overflow-hidden rounded-full bg-border">
            <div className="h-full w-1/2 animate-pulse-soft rounded-full bg-accent" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="animate-fade-in text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10">
            <svg className="h-6 w-6 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-danger">
            O motor de anonimização não respondeu
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-tertiary">
            Ele roda como um programa local junto com o aplicativo. Tentar de
            novo costuma resolver; se persistir, feche e abra o aplicativo.
          </p>
          <button
            onClick={reconectar}
            className="mt-5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-hover"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const isProcessing = screen === "processing";

  return (
    <div className="flex h-screen bg-bg">
      {/* Sidebar */}
      <Sidebar
        history={history.items}
        onOpenEntry={handleOpenHistoryEntry}
        onDeleteEntry={history.removeEntry}
        onClearHistory={history.clearHistory}
        onNewProcess={handleNewProcess}
        onOpenCli={() => setScreen("cli")}
        activeEntryId={activeHistoryId}
      />

      {/* Aviso de motor degradado — precisa ser visível, não só no log */}
      {avisoDeModo && (
        <div
          role="status"
          className="absolute inset-x-0 top-0 z-overlay border-b border-warning/40 bg-warning/10 px-5 py-2 text-center text-xs text-warning"
        >
          Rodando com o modelo leve: o modelo jurídico completo não pôde ser
          carregado, então menos nomes e locais serão encontrados. Revise o
          resultado com atenção redobrada.
        </div>
      )}

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {screen === "select" && (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-8 py-8">
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-text">
                    Novo processamento
                  </h1>
                  <p className="mt-1 text-sm text-text-tertiary">
                    Selecione os arquivos e configure a anonimização
                  </p>
                </div>
                {nlpMode !== "unknown" && (
                  <span
                    className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-2xs font-medium text-text-tertiary"
                    title={
                      nlpMode === "transformer"
                        ? "Modelo BERT fine-tuned em jurisprudência brasileira (LeNER-Br)"
                        : "Modelo spaCy pt_core_news_lg (modo rápido)"
                    }
                  >
                    {nlpMode === "transformer" ? "BERT jurídico" : "spaCy rápido"}
                  </span>
                )}
              </div>

              <div className="space-y-8">
                <FileSelector files={files} onFilesChange={setFiles} />
                <EntityConfig
                  selected={selectedEntities}
                  onChange={setSelectedEntities}
                />

                <div className="mt-6">
                  <PoliticaSelector
                    valor={politicaMascara}
                    onChange={setPoliticaMascara}
                  />
                </div>

                <button
                  onClick={handleAnonymize}
                  disabled={
                    files.length === 0 ||
                    selectedEntities.length === 0 ||
                    isProcessing
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-on-accent shadow-sm transition-all hover:bg-accent-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Anonimizar
                  {files.length > 0 &&
                    ` (${files.length} arquivo${files.length > 1 ? "s" : ""})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "processing" && (
          <ProcessingView
            current={processingProgress.current}
            total={processingProgress.total}
            fileName={processingProgress.fileName}
            phase={processingProgress.phase}
            onCancelar={handleCancelar}
          />
        )}

        {screen === "preview" && (
          <RevisaoView
            files={processedFiles}
            onSaveAll={handleSaveAll}
            onDownloadFile={handleDownloadSingle}
            formato={formatoSaida}
            onFormatoChange={setFormatoSaida}
            onBack={handleBack}
            onRejeitarDeteccao={handleRejeitarDeteccao}
          />
        )}

        {screen === "cli" && (
          <CliInstaller
            onClose={() => setScreen("select")}
            showToast={showToast}
          />
        )}
      </main>

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
