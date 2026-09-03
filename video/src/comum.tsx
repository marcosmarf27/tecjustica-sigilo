/**
 * Peças reaproveitadas pelas cenas.
 *
 * Duas convenções valem para o vídeo inteiro e estão aqui para não se
 * dispersarem: toda entrada é uma mola (`spring`), nunca um corte seco, porque
 * corte a cada 300 ms cansa em 60 segundos; e todo texto de máquina é mono,
 * todo texto de leitura é serifa.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { cor, fonte } from "./tokens";

/** Entrada suave: opacidade e um deslocamento curto para cima. */
export const Surge: React.FC<{
  atraso?: number;
  desloca?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ atraso = 0, desloca = 18, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - atraso,
    fps,
    config: { damping: 200, mass: 0.6 },
  });

  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * desloca}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Rótulo de seção: caixa alta com entreletra, reservada a 12px ou menos. */
export const Rotulo: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div
    style={{
      fontFamily: fonte.mono,
      fontSize: 20,
      letterSpacing: 3,
      textTransform: "uppercase",
      color: cor.toner3,
    }}
  >
    {children}
  </div>
);

export const Titulo: React.FC<{
  children: React.ReactNode;
  tamanho?: number;
}> = ({ children, tamanho = 68 }) => (
  <div
    style={{
      fontFamily: fonte.mono,
      fontSize: tamanho,
      fontWeight: 500,
      color: cor.toner,
      lineHeight: 1.15,
      letterSpacing: -1,
    }}
  >
    {children}
  </div>
);

export const Prosa: React.FC<{
  children: React.ReactNode;
  tamanho?: number;
}> = ({ children, tamanho = 32 }) => (
  <div
    style={{
      fontFamily: fonte.serifa,
      fontSize: tamanho,
      color: cor.toner2,
      lineHeight: 1.5,
      maxWidth: 1150,
    }}
  >
    {children}
  </div>
);

/** A folha branca sobre a mesa — mais clara que o fundo, como no aplicativo. */
export const Folha: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: cor.folha,
      border: `1px solid ${cor.pauta}`,
      borderRadius: 10,
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * A tarja de redação.
 *
 * No produto ela é sempre `--toner` preto com um filete colorido de 2px que
 * diz o tipo; a cor nunca preenche a tarja. Aqui vale a mesma regra — trocar o
 * preenchimento por cor cheia mudaria a leitura da imagem inteira.
 */
export const Tarja: React.FC<{
  largura: number;
  cor: string;
  progresso: number;
}> = ({ largura, cor: filete, progresso }) => (
  <span
    style={{
      display: "inline-block",
      width: largura * progresso,
      height: 30,
      background: cor.toner,
      borderBottom: `3px solid ${filete}`,
      borderRadius: 2,
      verticalAlign: "middle",
      overflow: "hidden",
    }}
  />
);

/** Barra de progresso fina no rodapé — dá noção de duração sem contar tempo. */
export const Trilho: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const avanco = interpolate(frame, [0, durationInFrames], [0, 1]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        background: cor.papelFundo,
      }}
    >
      <div
        style={{
          width: `${avanco * 100}%`,
          height: "100%",
          background: cor.esferografica,
        }}
      />
    </div>
  );
};
