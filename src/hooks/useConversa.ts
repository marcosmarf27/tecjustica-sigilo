import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O estado de uma conversa, acompanhado por sondagem.
 *
 * Sondar em vez de receber eventos é escolha, não preguiça. O projeto inteiro
 * fala IPC por `invoke` — o progresso do processamento também é sondado, a cada
 * segundo, contra o backend. Manter um idioma só já valeria; aqui há um motivo
 * a mais e específico.
 *
 * A resposta chega em pedaços, e um pseudônimo pode partir entre dois deles:
 * `[PESSOA_` num, `1]` no seguinte. Quem re-hidratasse pedaço a pedaço nunca
 * casaria o rótulo, e o texto cru apareceria na tela — justamente o que o
 * recurso existe para não fazer. O processo principal acumula e devolve sempre
 * o texto inteiro já resolvido, e o problema deixa de existir.
 */

const INTERVALO_MS = 120;

/**
 * A conversa aberta sobrevive à navegação.
 *
 * Ela vive no processo principal; o que esta tela guarda é só o id. Antes, sair
 * para os Ajustes (para trocar o modelo, por exemplo) e voltar fechava a
 * conversa e abria outra do zero — a pergunta e a resposta sumiam. Com os
 * atalhos Ctrl+1…5 isso acontecia a um toque de distância.
 *
 * Agora a conversa só é fechada quando a seleção de documentos (ou o modelo)
 * muda, ou quando o aplicativo fecha. Mesma seleção, mesma conversa.
 */
let viva: { chave: string; id: string } | null = null;

function chaveDe(ids: string[], modelo: string | null | undefined): string {
  return `${modelo ?? ""}|${ids.join(",")}`;
}

export function useConversa(ids: string[] | null, modelo?: string | null) {
  const [estado, setEstado] = useState<EstadoDaConversa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const idRef = useRef<string | null>(null);

  /* Abre quando a seleção muda, e fecha a anterior. A conversa vive no
     processo principal; sair da tela sem fechar deixaria o mapa de pseudônimos
     de pé na memória. */
  useEffect(() => {
    const api = window.electronAPI?.chat;
    if (!api || ids === null || ids.length === 0) {
      setEstado(null);
      return;
    }

    let cancelado = false;
    setErro(null);
    const chave = chaveDe(ids, modelo);

    /* Mesma seleção de antes: retoma em vez de reabrir. Se o processo
       principal não a conhece mais (o app reiniciou), cai para abrir. */
    const retomar = viva && viva.chave === chave ? api.estado(viva.id) : Promise.resolve(null);

    setAbrindo(true);
    retomar
      .catch(() => null)
      .then((existente) => {
        if (existente) return existente;
        if (viva) {
          void api.fechar(viva.id);
          viva = null;
        }
        return api.abrir(ids, modelo ?? undefined);
      })
      .then((aberta) => {
        if (cancelado) return;
        viva = { chave, id: aberta.id };
        idRef.current = aberta.id;
        setEstado(aberta);
      })
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : String(e))
      )
      .finally(() => !cancelado && setAbrindo(false));

    return () => {
      cancelado = true;
      /* Não fecha: a conversa fica viva no processo principal para quando
         a tela voltar. Quem fecha é a próxima seleção diferente. */
      idRef.current = null;
    };
  }, [ids, modelo]);

  /* Sonda só enquanto há resposta chegando. Parado, não custa nada. */
  useEffect(() => {
    if (!estado?.enviando) return;
    const api = window.electronAPI?.chat;
    if (!api) return;

    const timer = setInterval(() => {
      const id = idRef.current;
      if (!id) return;
      void api.estado(id).then((novo) => novo && setEstado(novo));
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [estado?.enviando]);

  const perguntar = useCallback(async (pergunta: string) => {
    const api = window.electronAPI?.chat;
    const id = idRef.current;
    if (!api || !id) return;

    setErro(null);
    try {
      await api.perguntar(id, pergunta);
      /* A primeira leitura logo em seguida marca `enviando`, o que liga a
         sondagem acima. Sem ela, o intervalo só começaria no próximo render. */
      const novo = await api.estado(id);
      if (novo) setEstado(novo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const cancelar = useCallback(() => {
    const id = idRef.current;
    if (id) void window.electronAPI?.chat.cancelar(id);
  }, []);

  const previsualizar = useCallback(async () => {
    const id = idRef.current;
    if (!id) return null;
    return (await window.electronAPI?.chat.previsualizar(id)) ?? null;
  }, []);

  const orcamento = useCallback(async () => {
    const id = idRef.current;
    if (!id) return null;
    return (await window.electronAPI?.chat.orcamento(id)) ?? null;
  }, []);

  return { estado, erro, abrindo, perguntar, cancelar, previsualizar, orcamento };
}
