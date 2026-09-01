import { useCallback, useEffect, useState } from "react";
import type { ProcessedFile } from "../types";

/**
 * A biblioteca, sobre o cofre cifrado.
 *
 * Substitui o `useHistory`, que era uma promessa quebrada por desenho: guardava
 * até 50 entradas de metadados em `localStorage` enquanto o conteúdo vivia num
 * `useRef` de sessão. O item continuava clicável depois de reiniciar o
 * aplicativo e respondia com um toast — "processe o arquivo de novo" — o que é
 * a definição de um histórico que não é histórico.
 *
 * Aqui, ou o documento está no cofre e reabre inteiro, ou não está listado.
 */

/** Extrai o número do processo das ocorrências que o próprio detector achou. */
function cnjDe(arquivo: ProcessedFile): string | null {
  /* O recognizer valida o dígito verificador (`processo_cnj_valid`), então um
     acerto aqui é um número de processo de verdade, não uma sequência
     parecida. Havendo mais de um, o primeiro é o do cabeçalho — é assim que
     autos são montados. */
  const achado = arquivo.entitiesFound.find(
    (e) => e.type === "NUMERO_PROCESSO_CNJ"
  );
  return achado?.text.trim() ?? null;
}

function contarPorTipo(arquivo: ProcessedFile): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const e of arquivo.entitiesFound) mapa[e.type] = (mapa[e.type] ?? 0) + 1;
  return mapa;
}

export function useBiblioteca(cofreLigado: boolean, diasDeExpurgo: number) {
  const [itens, setItens] = useState<EntradaDoCofre[]>([]);
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [expurgados, setExpurgados] = useState(0);

  const recarregar = useCallback(async () => {
    if (!window.electronAPI?.cofre) return;
    setItens(await window.electronAPI.cofre.listar());
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.cofre;
    if (!api) {
      setDisponivel(false);
      return;
    }
    (async () => {
      const ok = await api.disponivel();
      setDisponivel(ok);
      if (!ok) return;

      /* O expurgo roda na abertura, antes de listar: um item vencido não pode
         aparecer na tela nem por um instante. */
      if (cofreLigado && diasDeExpurgo > 0) {
        try {
          setExpurgados(await api.expurgar(diasDeExpurgo));
        } catch {
          // Expurgo que falha não pode impedir a biblioteca de abrir.
        }
      }
      setItens(await api.listar());
    })();
  }, [cofreLigado, diasDeExpurgo]);

  /**
   * Guarda um documento processado.
   *
   * Deixa a rejeição subir de propósito. Com o cofre indisponível, quem chama
   * precisa saber para dizer a verdade ao usuário — um `catch` silencioso aqui
   * anunciaria "guardado" sobre um cofre que recusou gravar.
   */
  const guardar = useCallback(
    async (arquivo: ProcessedFile, autoArquivamento: boolean) => {
      const api = window.electronAPI?.cofre;
      if (!api) throw new Error("O cofre só existe no aplicativo instalado.");

      const entrada = await api.gravar(
        {
          nome: arquivo.originalName,
          cnj: autoArquivamento ? cnjDe(arquivo) : null,
          totalOcorrencias: arquivo.entitiesFound.length,
          porTipo: contarPorTipo(arquivo),
          paginasComErro: arquivo.ocr?.paginas_com_erro ?? 0,
          totalPaginas: arquivo.ocr?.total_paginas ?? 0,
        },
        {
          textoOriginal: arquivo.originalContent,
          textoAnonimizado: arquivo.anonymizedContent,
          ocorrencias: arquivo.entitiesFound,
          caminhoOriginal: arquivo.originalPath,
          ocr: arquivo.ocr,
          /* A procedência vai junto porque não é recuperável depois: nem a
             política aplicada nem as entidades pedidas são dedutíveis do texto
             mascarado, e o modo do motor já mudou quando alguém for perguntar.
             Documento guardado sem estes campos não pode ser conversado — e é
             melhor assim do que conversado sob suposição. */
          politicaMascara: arquivo.politicaMascara,
          valoresDistintos: arquivo.valoresDistintos,
          modoNlp: arquivo.modoNlp,
          entidadesSolicitadas: arquivo.entidadesSolicitadas,
        }
      );

      setItens((atuais) => [entrada, ...atuais]);
      return entrada;
    },
    []
  );

  /** Reconstrói o `ProcessedFile` a partir do cofre, para a revisão reabrir. */
  const abrir = useCallback(
    async (item: EntradaDoCofre): Promise<ProcessedFile | null> => {
      const api = window.electronAPI?.cofre;
      if (!api) return null;
      const conteudo = await api.ler(item.id);
      if (!conteudo) return null;

      return {
        originalName: item.nome,
        originalPath: conteudo.caminhoOriginal,
        originalContent: conteudo.textoOriginal,
        anonymizedContent: conteudo.textoAnonimizado,
        entitiesFound: conteudo.ocorrencias as ProcessedFile["entitiesFound"],
        ocr: conteudo.ocr as ProcessedFile["ocr"],
      };
    },
    []
  );

  const apagar = useCallback(async (id: string) => {
    await window.electronAPI?.cofre.apagar(id);
    setItens((atuais) => atuais.filter((i) => i.id !== id));
  }, []);

  const esvaziar = useCallback(async () => {
    await window.electronAPI?.cofre.esvaziar();
    setItens([]);
  }, []);

  return {
    itens,
    /** `null` enquanto a checagem não voltou; `false` = não grava, nem em claro. */
    disponivel,
    /** Quantos itens o expurgo removeu na abertura desta sessão. */
    expurgados,
    guardar,
    abrir,
    apagar,
    esvaziar,
    recarregar,
  };
}

/** As pastas da biblioteca, derivadas do CNJ de cada item. */
export function pastasDe(itens: EntradaDoCofre[]): string[] {
  const comCnj = new Set(
    itens.map((i) => i.cnj).filter((c): c is string => Boolean(c))
  );
  const pastas = [...comCnj].sort();
  // "Avulsos" só aparece quando existe algo sem número de processo.
  if (itens.some((i) => !i.cnj)) pastas.push("Avulsos");
  return pastas;
}
