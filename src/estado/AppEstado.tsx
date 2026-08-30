import { createContext, useContext, useMemo, useReducer } from "react";
import type { Dispatch, ReactNode } from "react";
import { reducer } from "./reducer";
import { ESTADO_INICIAL } from "./tipos";
import type { AcaoApp, EstadoApp } from "./tipos";
import { usePreferencias } from "../hooks/usePreferencias";
import type { Preferencias } from "../hooks/usePreferencias";

/**
 * Contexto único do aplicativo: estado de sessão mais preferências.
 *
 * Os dois andam juntos para o consumidor porque quase toda tela precisa dos
 * dois — a Mesa lê a fila (sessão) e a política escolhida (preferência) na
 * mesma renderização. Guardá-los em dois contextos separados só multiplicaria
 * os `useContext` sem separar nada de verdade: a fronteira que importa é a de
 * *persistência*, e essa está garantida pelos módulos, não pelo contexto.
 */

interface ValorContexto {
  estado: EstadoApp;
  despachar: Dispatch<AcaoApp>;
  prefs: Preferencias;
  definirPref: <C extends keyof Preferencias>(
    campo: C,
    valor: Preferencias[C]
  ) => void;
  restaurarPreferencias: () => void;
}

const Contexto = createContext<ValorContexto | null>(null);

export function ProvedorEstado({ children }: { children: ReactNode }) {
  const [estado, despachar] = useReducer(reducer, ESTADO_INICIAL);
  const { prefs, definir, restaurarPadrao } = usePreferencias();

  const valor = useMemo(
    () => ({
      estado,
      despachar,
      prefs,
      definirPref: definir,
      restaurarPreferencias: restaurarPadrao,
    }),
    [estado, prefs, definir, restaurarPadrao]
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useApp(): ValorContexto {
  const valor = useContext(Contexto);
  /* Erro em vez de um valor vazio: um componente fora do provedor renderizaria
     com a fila vazia e as preferências no padrão, parecendo funcionar. Falhar
     alto na montagem é mais barato que caçar isso depois. */
  if (!valor) throw new Error("useApp() precisa estar dentro de <ProvedorEstado>");
  return valor;
}
