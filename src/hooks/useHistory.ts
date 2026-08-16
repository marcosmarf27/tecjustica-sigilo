import { useState, useCallback, useEffect, useRef } from "react";
import type { HistoryItem, ProcessedFile } from "../types";

const STORAGE_KEY = "tecjustica-sigilo-history";
// Chave usada antes de o produto ganhar nome. Lida uma vez, na migração: sem
// isso, quem já usava o aplicativo perderia o histórico ao atualizar.
const STORAGE_KEY_ANTERIOR = "presidio-anon-history";
const MAX_HISTORY = 50;

/**
 * Histórico de processamentos.
 *
 * O que é gravado em disco é deliberadamente pobre: nome do arquivo, data e
 * contagem de entidades por tipo. O texto original, o texto anonimizado e a
 * lista literal das PII detectadas ficam apenas em memória, na sessão atual.
 *
 * O motivo é direto: `localStorage` do Electron é um banco em claro no perfil
 * do usuário. Guardar ali o documento original — e, pior, um índice de todos
 * os CPFs, nomes e endereços que ele contém — criaria exatamente o artefato
 * que este aplicativo existe para evitar. Um histórico que sobrevive ao
 * fechamento do app não vale esse risco.
 */

/** Parte do histórico que pode ser gravada em disco sem conter dado pessoal. */
type HistoryItemPersistido = Omit<HistoryItem, "results">;

function semDadosPessoais(item: HistoryItem): HistoryItemPersistido {
  const { results: _results, ...seguro } = item;
  return seguro;
}

export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  // Resultados completos da sessão: vivem só enquanto o app está aberto.
  const resultadosDaSessao = useRef<Map<string, ProcessedFile[]>>(new Map());

  useEffect(() => {
    try {
      const atual = localStorage.getItem(STORAGE_KEY);
      const anterior = atual ? null : localStorage.getItem(STORAGE_KEY_ANTERIOR);
      const stored = atual ?? anterior;
      if (stored) {
        const persistidos: HistoryItemPersistido[] = JSON.parse(stored);
        setItems(persistidos.map((p) => ({ ...p, results: [] })));
        if (anterior) {
          // Migra na primeira abertura com o nome novo e limpa o rastro antigo.
          localStorage.setItem(STORAGE_KEY, anterior);
          localStorage.removeItem(STORAGE_KEY_ANTERIOR);
        }
      }
    } catch {
      // localStorage vazio ou corrompido
    }
  }, []);

  const save = useCallback((newItems: HistoryItem[]) => {
    const trimmed = newItems.slice(0, MAX_HISTORY);
    setItems(trimmed);

    const paraDisco = trimmed.map(semDadosPessoais);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(paraDisco));
    } catch {
      // Sem espaço: mantém as entradas mais recentes em vez de perder tudo.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(paraDisco.slice(0, 10)));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const addEntry = useCallback(
    (files: ProcessedFile[]) => {
      const entityBreakdown: Record<string, number> = {};
      let totalEntities = 0;
      for (const file of files) {
        for (const e of file.entitiesFound) {
          entityBreakdown[e.type] = (entityBreakdown[e.type] || 0) + 1;
          totalEntities++;
        }
      }

      const entry: HistoryItem = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        fileNames: files.map((f) => f.originalName),
        totalEntities,
        entityBreakdown,
        results: files,
      };

      resultadosDaSessao.current.set(entry.id, files);
      save([entry, ...items]);
      return entry;
    },
    [items, save]
  );

  /**
   * Resultados de uma entrada. Só existem se ela foi criada nesta sessão —
   * entradas carregadas do disco vêm sem conteúdo, por desenho.
   */
  const resultadosDe = useCallback(
    (id: string): ProcessedFile[] | undefined => resultadosDaSessao.current.get(id),
    []
  );

  const removeEntry = useCallback(
    (id: string) => {
      resultadosDaSessao.current.delete(id);
      save(items.filter((item) => item.id !== id));
    },
    [items, save]
  );

  const clearHistory = useCallback(() => {
    resultadosDaSessao.current.clear();
    save([]);
  }, [save]);

  return { items, addEntry, removeEntry, clearHistory, resultadosDe };
}
