/**
 * O problema, mostrado em vez de afirmado.
 *
 * Todos os dados desta cena são **sintéticos**. O CPF `111.444.777-35` é o que
 * o repositório já usa nos testes: tem dígito verificador válido, então o
 * detector o reconhece, e não pertence a ninguém. Um vídeo de anonimizador com
 * dado real seria a demonstração do defeito, não do produto.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { Folha, Prosa, Rotulo, Surge } from "../comum";
import { cor, corEntidade, fonte } from "../tokens";

const TRECHO: { texto: string; tipo?: keyof typeof corEntidade }[] = [
  { texto: "Nos autos do processo nº " },
  { texto: "0001234-56.2024.8.06.0001", tipo: "processo" },
  { texto: ", move a presente ação " },
  { texto: "MARIA APARECIDA DOS SANTOS", tipo: "pessoa" },
  { texto: ", inscrita no CPF sob o nº " },
  { texto: "111.444.777-35", tipo: "cpf" },
  { texto: ", residente na " },
  { texto: "Rua das Acácias, 128, Fortaleza", tipo: "local" },
  { texto: ", representada por advogado inscrito na " },
  { texto: "OAB/CE 45.678", tipo: "oab" },
  { texto: "." },
];

export const Problema: React.FC = () => {
  const frame = useCurrentFrame();
  // O realce sobe depois que a frase já foi lida — primeiro o texto, depois o
  // que há de errado nele.
  const realce = interpolate(frame, [95, 130], [0, 1], {
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
        <Rotulo>o problema</Rotulo>
      </Surge>

      <Surge atraso={6}>
        <Folha style={{ padding: "52px 58px" }}>
          <div
            style={{
              fontFamily: fonte.serifa,
              fontSize: 40,
              lineHeight: 1.85,
              color: cor.toner,
            }}
          >
            {TRECHO.map((pedaco, i) =>
              pedaco.tipo ? (
                <span
                  key={i}
                  style={{
                    background: `${corEntidade[pedaco.tipo]}${Math.round(
                      realce * 38
                    )
                      .toString(16)
                      .padStart(2, "0")}`,
                    borderBottom: `3px solid ${corEntidade[pedaco.tipo]}`,
                    borderRadius: 3,
                    paddingBottom: 1,
                    transition: "none",
                  }}
                >
                  {pedaco.texto}
                </span>
              ) : (
                <span key={i}>{pedaco.texto}</span>
              )
            )}
          </div>
        </Folha>
      </Surge>

      <Surge atraso={135}>
        <Prosa tamanho={36}>
          Cinco dados pessoais em uma única frase. Compartilhar a peça — com um
          perito, com outro órgão, com uma ferramenta de IA — exige tirá-los
          antes.
        </Prosa>
      </Surge>
    </AbsoluteFill>
  );
};
