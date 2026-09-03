/**
 * A tela de Revisão, recriada com dados sintéticos.
 *
 * É uma recriação e não uma captura, por um motivo que não é estético: toda
 * captura real desta tela mostraria nomes e CPF de um processo verdadeiro. Um
 * vídeo institucional sobre anonimização vazando dado pessoal seria a
 * demonstração do defeito.
 *
 * O que a recriação preserva do produto: a tarja é preta com filete colorido
 * (a cor nunca preenche), o score é **por ocorrência** — não o máximo do tipo
 * no documento —, e a lista lateral agrupa por tipo com contagem.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { Folha, Rotulo, Surge, Tarja } from "../comum";
import { cor, corEntidade, fonte } from "../tokens";

/** Cada tarja entra na ordem de leitura, com um respiro entre elas. */
const TARJAS = [
  { largura: 300, tipo: "processo" as const, entra: 30 },
  { largura: 420, tipo: "pessoa" as const, entra: 46 },
  { largura: 210, tipo: "cpf" as const, entra: 62 },
  { largura: 340, tipo: "local" as const, entra: 78 },
  { largura: 180, tipo: "oab" as const, entra: 94 },
];

const OCORRENCIAS = [
  { valor: "MARIA APARECIDA DOS…", score: "100%" },
  { valor: "João Ricardo Nunes", score: "99%" },
  { valor: "Helena Braga Matos", score: "97%" },
  { valor: "P. da Silva Neto", score: "71%" },
];

export const Revisao: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        background: cor.papel,
        padding: 90,
        justifyContent: "center",
        gap: 34,
      }}
    >
      <Surge>
        <Rotulo>a revisão — onde você confere</Rotulo>
      </Surge>

      <Surge atraso={6}>
        <Folha style={{ display: "flex", overflow: "hidden", height: 640 }}>
          {/* O documento, com as tarjas caindo sobre ele. */}
          <div style={{ flex: 1.75, padding: "40px 46px" }}>
            <div
              style={{
                fontFamily: fonte.mono,
                fontSize: 20,
                color: cor.toner3,
                marginBottom: 30,
              }}
            >
              peticao-inicial.pdf → peticao-inicial_anonimizado.docx
            </div>

            <div
              style={{
                fontFamily: fonte.serifa,
                fontSize: 30,
                lineHeight: 2.15,
                color: cor.toner,
              }}
            >
              Nos autos do processo nº{" "}
              <TarjaAnimada indice={0} />, move a presente ação{" "}
              <TarjaAnimada indice={1} />, inscrita no CPF sob o nº{" "}
              <TarjaAnimada indice={2} />, residente na{" "}
              <TarjaAnimada indice={3} />, representada por advogado inscrito na{" "}
              <TarjaAnimada indice={4} />.
            </div>
          </div>

          {/* O painel lateral: agrupado por tipo, com a contagem. */}
          <div
            style={{
              flex: 1,
              borderLeft: `1px solid ${cor.pauta}`,
              background: cor.papel,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "26px 28px 18px" }}>
              <div
                style={{
                  fontFamily: fonte.mono,
                  fontSize: 30,
                  color: cor.toner,
                }}
              >
                23 ocorrências
              </div>
              <div
                style={{
                  fontFamily: fonte.serifa,
                  fontSize: 22,
                  color: cor.toner2,
                  marginTop: 8,
                  lineHeight: 1.4,
                }}
              >
                O que não for dado pessoal pode ser liberado — e deixa de ser
                mascarado daqui em diante.
              </div>
            </div>

            <CabecalhoGrupo />

            {OCORRENCIAS.map((o, i) => (
              <div
                key={o.valor}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "15px 28px",
                  borderBottom: `1px solid ${cor.pauta}`,
                  fontFamily: fonte.mono,
                  fontSize: 21,
                  color: cor.toner,
                  opacity: interpolate(
                    frame,
                    [110 + i * 9, 124 + i * 9],
                    [0, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                  ),
                }}
              >
                <span>{o.valor}</span>
                <span
                  style={{
                    color: o.score === "71%" ? cor.carimbo : cor.toner3,
                  }}
                >
                  {o.score}
                </span>
              </div>
            ))}
          </div>
        </Folha>
      </Surge>

      <Surge atraso={200}>
        <div
          style={{
            fontFamily: fonte.serifa,
            fontSize: 32,
            color: cor.toner2,
          }}
        >
          Cada tarja tem o seu próprio grau de confiança. Dá para ordenar pelas
          menos certas — e é assim que se revisa um lote grande.
        </div>
      </Surge>
    </AbsoluteFill>
  );
};

const TarjaAnimada: React.FC<{ indice: number }> = ({ indice }) => {
  const frame = useCurrentFrame();
  const t = TARJAS[indice];
  const progresso = interpolate(frame, [t.entra, t.entra + 11], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Tarja largura={t.largura} cor={corEntidade[t.tipo]} progresso={progresso} />
  );
};

const CabecalhoGrupo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 28px",
        background: cor.papelFundo,
        borderTop: `1px solid ${cor.pauta}`,
        borderBottom: `1px solid ${cor.pauta}`,
        fontFamily: fonte.mono,
        fontSize: 21,
        color: cor.toner,
        opacity: interpolate(frame, [104, 116], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: "50%",
          background: corEntidade.pessoa,
        }}
      />
      <span style={{ flex: 1 }}>Nome</span>
      <span style={{ color: cor.toner3 }}>19</span>
    </div>
  );
};
