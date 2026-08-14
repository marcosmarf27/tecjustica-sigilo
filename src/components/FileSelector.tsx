import { useCallback, useRef, useState } from "react";
import type { FileItem } from "../types";

const MAX_FILES = 10;
const ACCEPTED_EXTENSIONS = [".txt", ".md", ".rtf"];

interface FileSelectorProps {
  files: FileItem[];
  onFilesChange: (files: FileItem[]) => void;
}

export function FileSelector({ files, onFilesChange }: FileSelectorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [rejeitados, setRejeitados] = useState<string[]>([]);

  const addFiles = useCallback(
    async (fileList: FileList) => {
      const newFiles: FileItem[] = [];
      const recusados: string[] = [];

      for (const file of Array.from(fileList)) {
        const ext = file.name
          .substring(file.name.lastIndexOf("."))
          .toLowerCase();
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          recusados.push(file.name);
          continue;
        }
        if (files.length + newFiles.length >= MAX_FILES) break;
        if (files.some((f) => f.name === file.name)) continue;

        // Tenta UTF-8 estrito; se falhar, assume cp1252 (comum em RTF Windows)
        const buffer = await file.arrayBuffer();
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          content = new TextDecoder("windows-1252").decode(buffer);
        }
        newFiles.push({
          name: file.name,
          // File.path não existe mais no Electron; o caminho real vem do
          // preload. Sem ele, o arquivo seria salvo no diretório errado.
          path: window.electronAPI?.getPathForFile?.(file) || file.name,
          content,
          size: file.size,
        });
      }

      if (newFiles.length > 0) {
        onFilesChange([...files, ...newFiles]);
      }

      setRejeitados(recusados);

      if (files.length + newFiles.length >= MAX_FILES) {
        setMaxReached(true);
        setTimeout(() => setMaxReached(false), 3000);
      }
    },
    [files, onFilesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleRemove = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">Arquivos</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Arraste ou selecione arquivos .txt, .md e .rtf
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-2xs font-medium transition-colors ${
            maxReached
              ? "bg-warning/15 text-warning"
              : "bg-surface-raised text-text-secondary"
          }`}
        >
          {maxReached ? "Limite atingido!" : `${files.length}/${MAX_FILES}`}
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Escolher arquivos para anonimizar"
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-all duration-200 ${
          isDragging
            ? "border-accent bg-accent/5 scale-[1.01]"
            : "border-border hover:border-text-tertiary hover:bg-surface-raised/50"
        }`}
      >
        <div
          className={`mb-4 rounded-xl p-3 transition ${
            isDragging
              ? "bg-accent/15 text-accent"
              : "bg-surface-raised text-text-tertiary group-hover:text-text-secondary"
          }`}
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-sm text-text-secondary">
          Solte arquivos aqui ou{" "}
          <span className="font-medium text-accent">selecione</span>
        </p>
        <p className="mt-1 text-2xs text-text-tertiary">
          .txt, .md e .rtf — max {MAX_FILES} arquivos
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".txt,.md,.rtf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {rejeitados.length > 0 && (
        <p role="status" className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-2xs text-warning">
          Não dá para ler {rejeitados.join(", ")}. Por enquanto o aplicativo
          aceita apenas .txt, .md e .rtf — para PDF, extraia o texto antes.
        </p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="stagger-children mt-3 space-y-1.5">
          {files.map((file, i) => (
            <li
              key={file.name}
              className="group flex items-center justify-between rounded-lg bg-surface-raised/70 px-4 py-2.5 transition hover:bg-surface-raised"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="overflow-hidden">
                  <p className="truncate text-sm font-medium text-text">
                    {file.name}
                  </p>
                  <p className="text-2xs text-text-tertiary">
                    {formatSize(file.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleRemove(i)}
                aria-label={`Remover ${file.name}`}
                className="shrink-0 rounded-md p-1.5 text-text-tertiary opacity-0 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
