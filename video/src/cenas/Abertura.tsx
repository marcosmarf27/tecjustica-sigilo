import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { Prosa, Surge } from "../comum";
import { cor, fonte } from "../tokens";

export const Abertura: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        background: cor.papel,
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
      }}
    >
      <Surge>
        <Img
          src={staticFile("logo.png")}
          style={{ width: 118, height: 118, borderRadius: 22 }}
        />
      </Surge>

      <Surge atraso={8}>
        <div style={{ fontFamily: fonte.mono, fontSize: 82, letterSpacing: -2 }}>
          <span style={{ color: cor.toner }}>TecJustiça </span>
          <span style={{ color: cor.esferografica }}>Sigilo</span>
        </div>
      </Surge>

      <Surge atraso={18}>
        <div style={{ textAlign: "center" }}>
          <Prosa tamanho={36}>
            Anonimizador de dados pessoais em peças processuais.
          </Prosa>
        </div>
      </Surge>

      <Surge atraso={30}>
        <div
          style={{
            fontFamily: fonte.mono,
            fontSize: 24,
            color: cor.toner3,
            letterSpacing: 1,
            opacity: frame > 40 ? 1 : 0,
          }}
        >
          roda inteiro na sua máquina
        </div>
      </Surge>
    </AbsoluteFill>
  );
};
