/**
 * A tese do produto: o documento não sai da máquina.
 *
 * A cena é construída para ser lida sem áudio e sem legenda — o desenho tem de
 * dizer sozinho que existe uma fronteira e que nada a atravessa.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { Folha, Prosa, Rotulo, Surge, Titulo } from "../comum";
import { cor, fonte } from "../tokens";

export const Local: React.FC = () => {
  const frame = useCurrentFrame();
  const risco = interpolate(frame, [96, 118], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: cor.papel,
        padding: 110,
        justifyContent: "center",
        gap: 46,
      }}
    >
      <Surge>
        <Rotulo>por que isso importa</Rotulo>
      </Surge>

      <Surge atraso={6}>
        <Titulo tamanho={64}>O documento não sai daqui.</Titulo>
      </Surge>

      <div style={{ display: "flex", gap: 34, alignItems: "center" }}>
        <Surge atraso={3} style={{ flex: 1 }}>
          <Folha style={{ padding: "40px 38px" }}>
            <div
              style={{
                fontFamily: fonte.mono,
                fontSize: 26,
                color: cor.deferido,
                marginBottom: 16,
              }}
            >
              ✓ na sua máquina
            </div>
            <div
              style={{
                fontFamily: fonte.serifa,
                fontSize: 27,
                lineHeight: 1.5,
                color: cor.toner2,
              }}
            >
              O modelo — 415 MB — fica no disco. Leitura, OCR e detecção rodam
              em CPU comum, sem placa de vídeo.
            </div>
          </Folha>
        </Surge>

        {/* A fronteira. Ela é o desenho, não o enfeite. */}
        <Surge atraso={12}>
          <div
            style={{
              width: 3,
              height: 230,
              background: cor.pautaForte,
              position: "relative",
            }}
          >
            {/* Centrado NA divisória, não ao lado dela: o marcador é o que diz
                que a fronteira não é atravessada. Fora do eixo, ele vira um
                enfeite pendurado no cartão vizinho. */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 62,
                height: 62,
                borderRadius: "50%",
                background: cor.papel,
                border: `2px solid ${cor.carimbo}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: fonte.mono,
                fontSize: 30,
                color: cor.carimbo,
                opacity: risco,
              }}
            >
              ⨯
            </div>
          </div>
        </Surge>

        <Surge atraso={20} style={{ flex: 1 }}>
          <Folha
            style={{
              padding: "40px 38px",
              opacity: 0.55,
              borderStyle: "dashed",
            }}
          >
            <div
              style={{
                fontFamily: fonte.mono,
                fontSize: 26,
                color: cor.carimbo,
                marginBottom: 16,
              }}
            >
              ⨯ nenhum servidor
            </div>
            <div
              style={{
                fontFamily: fonte.serifa,
                fontSize: 27,
                lineHeight: 1.5,
                color: cor.toner2,
              }}
            >
              Sem nuvem a contratar, sem conta, sem telemetria, sem
              infraestrutura para o órgão manter.
            </div>
          </Folha>
        </Surge>
      </div>

      <Surge atraso={112}>
        <Prosa tamanho={32}>
          É o que permite instalar na máquina que o servidor já usa, em vez de
          provisionar uma infra que exigiria equipe dedicada para operar.
        </Prosa>
      </Surge>
    </AbsoluteFill>
  );
};
