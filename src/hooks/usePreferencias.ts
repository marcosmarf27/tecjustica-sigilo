import { useCallback, useEffect, useState } from "react";
import { ALL_ENTITIES } from "../types";
import type { EntityType, PoliticaMascara } from "../types";
import type { FormatoSaida } from "../lib/nomeDeSaida";

/**
 * Preferências do operador, guardadas entre sessões.
 *
 * Até aqui **nenhuma** sobrevivia ao fechamento do aplicativo: as entidades
 * voltavam para "todas", a política para marcador e o formato para `.md` a cada
 * abertura, porque tudo morava em `useState` dentro do `App`. Quem anonimiza um
 * lote por dia com a mesma configuração reconfigurava tudo, todo dia.
 *
 * Isto é `localStorage` em claro, de propósito. São escolhas de trabalho —
 * quais tipos mascarar, onde salvar, qual tema —, não dado pessoal. O conteúdo
 * dos documentos é outra história e vive no cofre cifrado.
 */

export type Tema = "papel" | "noite" | "sistema";

export interface Preferencias {
  entidades: EntityType[];
  politica: PoliticaMascara;
  formato: FormatoSaida;
  /** `null` = gravar ao lado do arquivo original. */
  pastaDeSaida: string | null;
  tema: Tema;
  /** Arquivar por número de processo, a partir do CNJ que o detector achou. */
  autoArquivamento: boolean;
  /** O cofre nasce desligado: guardar texto em disco é opt-in explícito. */
  cofreLigado: boolean;
  /**
   * Se o consentimento já foi apresentado alguma vez.
   *
   * Separado de `cofreLigado` porque "ainda não perguntei" e "perguntei e a
   * pessoa disse não" são situações diferentes: a primeira pede o diálogo, a
   * segunda não pode repeti-lo a cada documento. Quem recusou muda de ideia
   * pelos Ajustes, no seu tempo.
   */
  cofrePerguntado: boolean;
  /** Dias até o expurgo automático do cofre. */
  diasDeExpurgo: number;
  /** Modelo da conversa, por id do catálogo. `null` = o padrão do catálogo. */
  modeloDaNuvem: string | null;
}

const CHAVE = "tecjustica-sigilo-prefs";

export const PREFERENCIAS_PADRAO: Preferencias = {
  entidades: ALL_ENTITIES.map((e) => e.id),
  politica: "placeholder",
  formato: "md",
  pastaDeSaida: null,
  tema: "sistema",
  autoArquivamento: true,
  cofreLigado: false,
  cofrePerguntado: false,
  diasDeExpurgo: 30,
  modeloDaNuvem: null,
};

/**
 * Aplica o tema no `<html>`.
 *
 * Os três valores mapeiam para dois estados do atributo, e a assimetria é
 * proposital: "sistema" **remove** `data-tema` em vez de escrever algo. É o que
 * devolve a decisão ao `@media (prefers-color-scheme)` do `tokens.css` — com um
 * valor escrito, o alternador venceria o sistema para sempre, inclusive depois
 * de o usuário pedir para seguir o sistema de novo.
 */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === "sistema") raiz.removeAttribute("data-tema");
  else raiz.setAttribute("data-tema", tema);

  /* A moldura da janela (barra de título e controles) é pintada pelo
     Electron, fora do CSS. Depois que o tema entra, lê-se do próprio `:root`
     as duas cores que ela precisa — assim a fonte da verdade continua sendo o
     `tokens.css`, e "seguir o sistema" também chega à moldura. */
  requestAnimationFrame(() => {
    const estilo = getComputedStyle(raiz);
    const fundo = estilo.getPropertyValue("--papel-fundo").trim();
    const simbolo = estilo.getPropertyValue("--toner").trim();
    if (fundo && simbolo) {
      void window.electronAPI?.janela?.pintarBarra({ fundo, simbolo }).catch(() => {});
    }
  });
}

function ler(): Preferencias {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return PREFERENCIAS_PADRAO;
    const salvo = JSON.parse(cru) as Partial<Preferencias>;

    /* Mesclar com o padrão, e não confiar no que está gravado, é o que deixa
       acrescentar uma preferência nova sem quebrar quem já tem o registro
       antigo — o campo novo simplesmente assume o padrão. */
    const prefs = { ...PREFERENCIAS_PADRAO, ...salvo };

    /* Uma lista de entidades vazia trava o botão Anonimizar sem explicar por
       quê. Se o que veio do disco for inútil, volta para o padrão. */
    if (!Array.isArray(prefs.entidades) || prefs.entidades.length === 0) {
      prefs.entidades = PREFERENCIAS_PADRAO.entidades;
    } else {
      // Descarta tipo que não existe mais, para o caso de uma entidade sair.
      const validas = new Set<string>(ALL_ENTITIES.map((e) => e.id));
      prefs.entidades = prefs.entidades.filter((e) => validas.has(e));
      if (prefs.entidades.length === 0) {
        prefs.entidades = PREFERENCIAS_PADRAO.entidades;
      }
    }
    return prefs;
  } catch {
    /* JSON corrompido não pode impedir o aplicativo de abrir. Preferência é
       conveniência: na dúvida, o padrão. */
    return PREFERENCIAS_PADRAO;
  }
}

export function usePreferencias() {
  const [prefs, setPrefs] = useState<Preferencias>(ler);

  // O tema é o único que precisa alcançar o DOM fora do React.
  useEffect(() => {
    aplicarTema(prefs.tema);
    if (prefs.tema !== "sistema") return;
    /* "Seguir o sistema" com o app aberto: o CSS acompanha sozinho pelo
       `@media`, mas a moldura da janela é pintada fora do CSS e precisa ser
       avisada de novo quando o Windows troca de tema. */
    const midia = window.matchMedia("(prefers-color-scheme: dark)");
    const aoMudar = () => aplicarTema("sistema");
    midia.addEventListener("change", aoMudar);
    return () => midia.removeEventListener("change", aoMudar);
  }, [prefs.tema]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(prefs));
    } catch {
      /* Cota estourada ou armazenamento bloqueado. A sessão continua
         funcionando com o que está na memória; só não sobrevive ao fechamento. */
    }
  }, [prefs]);

  const definir = useCallback(
    <C extends keyof Preferencias>(campo: C, valor: Preferencias[C]) =>
      setPrefs((atual) => ({ ...atual, [campo]: valor })),
    []
  );

  const restaurarPadrao = useCallback(() => setPrefs(PREFERENCIAS_PADRAO), []);

  return { prefs, definir, restaurarPadrao };
}
