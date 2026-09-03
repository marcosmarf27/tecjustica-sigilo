/**
 * A montagem: seis cenas em 58 segundos.
 *
 * As cenas se **sobrepõem** por 12 quadros e a de cima entra com fade. Corte
 * seco entre fundos da mesma cor produz um piscar que o olho lê como falha de
 * codificação, não como transição — e num vídeo institucional isso vira a
 * primeira coisa que alguém comenta.
 */
import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";

import { Trilho } from "./comum";
import { Abertura } from "./cenas/Abertura";
import { Fluxo } from "./cenas/Fluxo";
import { Local } from "./cenas/Local";
import { Numeros } from "./cenas/Numeros";
import { Problema } from "./cenas/Problema";
import { Revisao } from "./cenas/Revisao";
import { cor } from "./tokens";

const SOBREPOSICAO = 12;

const CENAS = [
  { Comp: Abertura, duracao: 150 },
  { Comp: Problema, duracao: 300 },
  { Comp: Fluxo, duracao: 330 },
  { Comp: Revisao, duracao: 390 },
  { Comp: Local, duracao: 300 },
  { Comp: Numeros, duracao: 270 },
];

export const DURACAO_TOTAL = CENAS.reduce((s, c) => s + c.duracao, 0);

/** Fade de entrada. A cena de baixo continua montada durante a sobreposição. */
const Entrada: React.FC<{ children: React.ReactNode; primeira: boolean }> = ({
  children,
  primeira,
}) => {
  const frame = useCurrentFrame();
  const opacidade = primeira
    ? 1
    : interpolate(frame, [0, SOBREPOSICAO], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return <AbsoluteFill style={{ opacity: opacidade }}>{children}</AbsoluteFill>;
};

export const Explicativo: React.FC = () => {
  let inicio = 0;

  return (
    <AbsoluteFill style={{ background: cor.papel }}>
      {CENAS.map(({ Comp, duracao }, i) => {
        const primeira = i === 0;
        const desde = primeira ? 0 : inicio - SOBREPOSICAO;
        const dura = primeira ? duracao : duracao + SOBREPOSICAO;
        inicio += duracao;

        return (
          // A chave é o índice, não `Comp.name`: o bundler mutila nomes de
          // função, e duas cenas com o mesmo nome mutilado colidiriam em
          // silêncio — React reaproveitaria o nó de uma para a outra.
          <Sequence key={i} from={desde} durationInFrames={dura}>
            <Entrada primeira={primeira}>
              <Comp />
            </Entrada>
          </Sequence>
        );
      })}
      <Trilho />
    </AbsoluteFill>
  );
};
