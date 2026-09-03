/**
 * O fecho: os números que sustentam as afirmações, e onde conferi-los.
 *
 * O 99,97% aparece com o denominador ao lado de propósito. Percentual sozinho
 * é retórica; "3.614 de 3.615, em 819 páginas" é uma medição que alguém pode
 * pedir para repetir — e é justamente esse o convite da última linha.
 */
import React from "react";
import { AbsoluteFill } from "remotion";

import { Rotulo, Surge, Titulo } from "../comum";
import { cor, fonte } from "../tokens";

const NUMEROS = [
  {
    valor: "99,97%",
    rotulo: "das ocorrências encontradas",
    nota: "3.614 de 3.615, em 819 páginas de processos reais",
  },
  {
    valor: "322",
    rotulo: "testes automatizados",
    nota: "motor de detecção, processo principal e interface",
  },
  {
    valor: "MIT",
    rotulo: "software livre",
    nota: "sem custo de licença, de nuvem ou de contrato",
  },
];

export const Numeros: React.FC = () => (
  <AbsoluteFill
    style={{
      background: cor.papel,
      padding: 110,
      justifyContent: "center",
      gap: 54,
    }}
  >
    <Surge>
      <Rotulo>medido, não prometido</Rotulo>
    </Surge>

    <div style={{ display: "flex", gap: 30 }}>
      {NUMEROS.map((n, i) => (
        <Surge key={n.valor} atraso={3 + i * 11} style={{ flex: 1 }}>
          <div
            style={{
              borderTop: `3px solid ${cor.esferografica}`,
              paddingTop: 26,
            }}
          >
            <div
              style={{
                fontFamily: fonte.mono,
                fontSize: 76,
                color: cor.toner,
                letterSpacing: -2,
              }}
            >
              {n.valor}
            </div>
            <div
              style={{
                fontFamily: fonte.mono,
                fontSize: 24,
                color: cor.toner2,
                marginTop: 10,
              }}
            >
              {n.rotulo}
            </div>
            <div
              style={{
                fontFamily: fonte.serifa,
                fontSize: 24,
                color: cor.toner3,
                marginTop: 14,
                lineHeight: 1.4,
              }}
            >
              {n.nota}
            </div>
          </div>
        </Surge>
      ))}
    </div>

    <Surge atraso={72}>
      <Titulo tamanho={44}>
        Nenhum desses números precisa ser aceito por confiança.
      </Titulo>
    </Surge>

    <Surge atraso={88}>
      <div
        style={{
          fontFamily: fonte.serifa,
          fontSize: 32,
          color: cor.toner2,
          lineHeight: 1.5,
        }}
      >
        O código é aberto, os testes rodam na sua máquina, e a medição de
        acurácia pode ser refeita sobre o corpus do seu órgão.
      </div>
    </Surge>

    <Surge atraso={104}>
      <div
        style={{
          fontFamily: fonte.mono,
          fontSize: 27,
          color: cor.esferografica,
          letterSpacing: 0.5,
        }}
      >
        github.com/marcosmarf27/tecjustica-sigilo
      </div>
    </Surge>

    {/* A ressalva fica na mesma tela do número, e não numa nota que ninguém
        lê: a medição é do código atual, e o instalador publicado é anterior à
        troca de modelo. Um vídeo que exibe 99,97% sem isso promete sobre um
        pacote que não entrega esse número. */}
    <Surge atraso={118}>
      <div
        style={{
          fontFamily: fonte.mono,
          fontSize: 20,
          color: cor.toner3,
          lineHeight: 1.5,
        }}
      >
        medição sobre o código atual — o instalador publicado (1.4.0) é anterior
        à troca de modelo
      </div>
    </Surge>
  </AbsoluteFill>
);
