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

export function useConversa(ids: string[] | null) {
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
    setAbrindo(true);
    setErro(null);

    api
      .abrir(ids)
      .then((aberta) => {
        if (cancelado) {
          void api.fechar(aberta.id);
          return;
        }
        idRef.current = aberta.id;
        setEstado(aberta);
      })
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : String(e))
      )
      .finally(() => !cancelado && setAbrindo(false));

    return () => {
      cancelado = true;
      const id = idRef.current;
      idRef.current = null;
      if (id) void api.fechar(id);
    };
  }, [ids]);

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
