import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BarreiraDeErro } from "./componentes/BarreiraDeErro";
import "./index.css";

/* A barreira fica FORA do StrictMode, e envolvendo tudo.
   Sem ela, um erro não tratado no render faz o React 19 desmontar a árvore
   inteira: a janela volta ao estado inicial, calada. Foi assim que um lote de
   seis documentos morria no meio e o aplicativo "voltava para a tela normal"
   sem dizer nada. */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BarreiraDeErro>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </BarreiraDeErro>
);
