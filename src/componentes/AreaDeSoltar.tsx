import { useCallback, useRef, useState } from "react";
import type { FileItem } from "../types";
import type { ArquivoNaFila, EstadoArquivo } from "../estado/tipos";
import { Botao, Icone, Selo } from "../ui";

/**
 * Área de soltar e fila de arquivos.
 *
 * Sucessora do `FileSelector`, com duas mudanças de fundo: a fila mostra em que
 * estágio cada arquivo está (na fila / lendo / anonimizando / pronto / falhou)
 * e a falha de um arquivo aparece **com o motivo**, ali na linha dele.
 *
 * O que **não** mudou, porque é essencial: `getPathForFile` do preload. O
 * `File.path` não existe mais no Electron, e sem o caminho real um documento
 * binário nem poderia ser aberto pelo backend — além de o resultado ser salvo
 * no diretório errado.
 */

const MAX_ARQUIVOS = 10;

/** Texto puro: o próprio renderer lê e manda o conteúdo. */
const EXTENSOES_TEXTO = [".txt", ".md", ".rtf"];

/** Documentos que o backend abre pelo caminho, fazendo OCR quando digitalizados. */
const EXTENSOES_DOCUMENTO = [
  ".pdf", ".docx", ".xlsx", ".pptx",
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp",
];

const EXTENSOES_ACEITAS = [...EXTENSOES_TEXTO, ...EXTENSOES_DOCUMENTO];

const ROTULO_ESTADO: Record<EstadoArquivo, string> = {
  "na-fila": "na fila",
  lendo: "lendo",
  anonimizando: "anonimizando",
  pronto: "pronto",
  falhou: "falhou",
};

function tamanhoLegivel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AreaDeSoltarProps {
  fila: ArquivoNaFila[];
  aoMudarFila: (arquivos: FileItem[]) => void;
  /** Trava a área enquanto o lote roda. */
  bloqueada?: boolean;
}

export function AreaDeSoltar({
  fila,
  aoMudarFila,
  bloqueada = false,
}: AreaDeSoltarProps) {
  const refInput = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [recusados, setRecusados] = useState<string[]>([]);
  const [noLimite, setNoLimite] = useState(false);

  const acrescentar = useCallback(
    async (lista: FileList) => {
      const novos: FileItem[] = [];
      const naoAceitos: string[] = [];

      for (const arquivo of Array.from(lista)) {
        const ext = arquivo.name
          .substring(arquivo.name.lastIndexOf("."))
          .toLowerCase();

        if (!EXTENSOES_ACEITAS.includes(ext)) {
          naoAceitos.push(arquivo.name);
          continue;
        }
        if (fila.length + novos.length >= MAX_ARQUIVOS) break;
        if (fila.some((f) => f.name === arquivo.name)) continue;

        const caminho =
          window.electronAPI?.getPathForFile?.(arquivo) || arquivo.name;
        const precisaExtracao = EXTENSOES_DOCUMENTO.includes(ext);

        if (precisaExtracao && !window.electronAPI?.getPathForFile) {
          // Fora do Electron não há caminho de disco para entregar ao backend.
          naoAceitos.push(arquivo.name);
          continue;
        }

        let conteudo = "";
        if (!precisaExtracao) {
          /* UTF-8 estrito primeiro; caindo, assume cp1252 — comum em RTF
             gerado no Windows, e decodificar errado corromperia acentuação
             justamente nos nomes próprios que precisam ser detectados. */
          const buffer = await arquivo.arrayBuffer();
          try {
            conteudo = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          } catch {
            conteudo = new TextDecoder("windows-1252").decode(buffer);
          }
        }

        novos.push({
          name: arquivo.name,
          path: caminho,
          content: conteudo,
          size: arquivo.size,
          precisaExtracao,
        });
      }

      if (novos.length > 0) aoMudarFila([...fila, ...novos]);
      setRecusados(naoAceitos);

      if (fila.length + novos.length >= MAX_ARQUIVOS) {
        setNoLimite(true);
        setTimeout(() => setNoLimite(false), 3000);
      }
    },
    [fila, aoMudarFila]
  );

  const abrirDialogo = async () => {
    /* No Electron, o diálogo nativo é o caminho bom: ele traz o caminho de
       disco de graça e agora oferece PDF e Office no filtro. O `<input>` só
       entra fora do Electron. */
    if (window.electronAPI?.selectFiles) {
      const escolhidos = await window.electronAPI.selectFiles();
      if (escolhidos.length === 0) return;

      /* O diálogo nativo devolve caminho, não um `File`. Para PDF e Office isso
         basta: o backend abre pelo caminho. Para texto puro, **não** — a rota
         `/processar` recusa `.txt`, `.md` e `.rtf` por caminho (415), porque
         ler arquivo arbitrário do disco é justamente o que ela evita.

         Marcar tudo como `precisaExtracao` fazia o `.txt` escolhido pelo botão
         falhar sempre, enquanto o MESMO arquivo arrastado funcionava — o
         diálogo até oferece o filtro "Texto". O conserto é o renderer ler o
         conteúdo pelo IPC, exatamente como faz com um arquivo arrastado. */
      const lidos = await Promise.all(
        escolhidos
          .filter((e) => !fila.some((f) => f.name === e.name))
          .slice(0, MAX_ARQUIVOS - fila.length)
          .map(async (e) => {
            const ehTexto = EXTENSOES_TEXTO.some((ext) =>
              e.name.toLowerCase().endsWith(ext)
            );
            if (!ehTexto) {
              return {
                name: e.name,
                path: e.path,
                content: "",
                size: 0,
                precisaExtracao: true,
              };
            }
            try {
              const content = await window.electronAPI!.readFile(e.path);
              return {
                name: e.name,
                path: e.path,
                content,
                size: content.length,
                precisaExtracao: false,
              };
            } catch {
              /* Ilegível como texto: deixa o backend tentar, que sabe dizer o
                 motivo na linha do arquivo em vez de sumir com ele. */
              return {
                name: e.name,
                path: e.path,
                content: "",
                size: 0,
                precisaExtracao: true,
              };
            }
          })
      );
      const novos: FileItem[] = lidos;

      if (novos.length > 0) aoMudarFila([...fila, ...novos]);
      return;
    }
    refInput.current?.click();
  };

  return (
    <div>
      <div
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (!bloqueada && e.dataTransfer.files.length > 0) {
            acrescentar(e.dataTransfer.files);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!bloqueada) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        className={[
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10",
          "transition-colors duration-[120ms]",
          arrastando
            ? "border-accent bg-accent-muted"
            : "border-border bg-surface",
          bloqueada ? "pointer-events-none opacity-50" : "",
        ].join(" ")}
      >
        <Icone
          nome="documento"
          tamanho={24}
          className={arrastando ? "text-accent" : "text-text-tertiary"}
        />
        <p className="text-base text-text-secondary">
          Arraste os autos como saem do PJe
        </p>
        <p className="font-mono text-2xs tracking-wide text-text-tertiary uppercase">
          PDF · DOCX · XLSX · imagem · TXT — até {MAX_ARQUIVOS} arquivos
        </p>
        <Botao tipo="secundario" onClick={abrirDialogo} disabled={bloqueada}>
          Escolher arquivos
        </Botao>
      </div>

      <input
        ref={refInput}
        type="file"
        multiple
        accept={EXTENSOES_ACEITAS.join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) acrescentar(e.target.files);
          e.target.value = "";
        }}
      />

      {noLimite && (
        <p role="status" className="mt-3 text-xs text-warning">
          Limite de {MAX_ARQUIVOS} arquivos por lote atingido.
        </p>
      )}

      {recusados.length > 0 && (
        <p role="status" className="mt-3 text-xs text-warning">
          Não dá para ler {recusados.join(", ")}. São aceitos PDF, DOCX, XLSX,
          PPTX, imagens digitalizadas, TXT, MD e RTF.
        </p>
      )}

      {fila.some((f) => f.precisaExtracao) && (
        <p className="mt-3 text-xs text-text-tertiary">
          Documentos digitalizados passam por reconhecimento de texto antes da
          anonimização — alguns segundos por página, inteiramente nesta máquina.
        </p>
      )}

      {fila.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface">
          {fila.map((arquivo, i) => (
            <li
              key={arquivo.path || arquivo.name}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Icone
                  nome="documento"
                  tamanho={15}
                  className="shrink-0 text-text-tertiary"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{arquivo.name}</p>
                  {arquivo.estado === "falhou" && arquivo.motivoDaFalha ? (
                    /* O motivo fica na linha do arquivo, não num toast que
                       some: com um lote de dez, saber *qual* falhou e *por quê*
                       é a informação inteira. */
                    <p className="mt-0.5 text-2xs text-danger">
                      {arquivo.motivoDaFalha}
                    </p>
                  ) : (
                    arquivo.size > 0 && (
                      <p className="mt-0.5 font-mono text-2xs text-text-tertiary">
                        {tamanhoLegivel(arquivo.size)}
                      </p>
                    )
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Selo
                  tom={
                    arquivo.estado === "falhou"
                      ? "perigo"
                      : arquivo.estado === "pronto"
                        ? "deferido"
                        : arquivo.estado === "na-fila"
                          ? "neutro"
                          : "acao"
                  }
                  comPonto={arquivo.estado !== "na-fila"}
                >
                  {ROTULO_ESTADO[arquivo.estado]}
                </Selo>

                {!bloqueada && (
                  <button
                    onClick={() =>
                      aoMudarFila(fila.filter((_, n) => n !== i))
                    }
                    aria-label={`Remover ${arquivo.name}`}
                    className="rounded p-1 text-text-tertiary transition-colors hover:text-danger"
                  >
                    <Icone nome="fechar" tamanho={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
