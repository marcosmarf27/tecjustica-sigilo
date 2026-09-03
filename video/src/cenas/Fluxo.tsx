/**
 * As quatro etapas, na ordem em que acontecem.
 *
 * A ordem importa mais que os ícones: Revisão vem ANTES da saída, porque no
 * produto ela não é opcional. Um fluxograma que a coloca ao lado, como desvio,
 * conta uma história diferente da que o aplicativo implementa.
 */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { Folha, Rotulo, Surge, Titulo } from "../comum";
import { cor, fonte } from "../tokens";

const ETAPAS = [
  {
    n: "1",
    nome: "Leitura",
    detalhe: "PDF, Word, imagem. Página digitalizada passa por OCR aqui mesmo.",
  },
  {
    n: "2",
    nome: "Detecção",
    detalhe: "Modelo jurídico para nomes; regra + dígito verificador para CPF, CNPJ e CNJ.",
  },
  {
    n: "3",
    nome: "Revisão",
    detalhe: "Você confere cada ocorrência com o grau de confiança. Não é opcional.",
  },
  {
    n: "4",
    nome: "Saída",
    detalhe: "Documento de texto, com aviso de que é anonimizado.",
  },
];

export const Fluxo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        background: cor.papel,
        padding: 110,
        justifyContent: "center",
        gap: 52,
      }}
    >
      <Surge>
        <Rotulo>o caminho de um documento</Rotulo>
      </Surge>

      <div style={{ display: "flex", gap: 22, alignItems: "stretch" }}>
        {ETAPAS.map((etapa, i) => {
          /* Curto de propósito. A cena entra por cima da anterior com fundo
             opaco, e durante os 12 quadros de sobreposição o que se vê é ESTA
             cena: se o conteúdo dela só começa no quadro 14, a transição
             mostra meio segundo de tela vazia. O atraso tem de caber dentro
             da sobreposição, não vir depois dela. */
          const entrada = 2 + i * 12;
          const seta = interpolate(frame, [entrada + 12, entrada + 26], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <React.Fragment key={etapa.n}>
              <Surge atraso={entrada} style={{ flex: 1, display: "flex" }}>
                <Folha
                  style={{
                    padding: "34px 30px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      fontFamily: fonte.mono,
                      fontSize: 22,
                      color: cor.esferografica,
                      letterSpacing: 2,
                    }}
                  >
                    {etapa.n}
                  </div>
                  <Titulo tamanho={40}>{etapa.nome}</Titulo>
                  <div
                    style={{
                      fontFamily: fonte.serifa,
                      fontSize: 25,
                      lineHeight: 1.45,
                      color: cor.toner2,
                    }}
                  >
                    {etapa.detalhe}
                  </div>
                </Folha>
              </Surge>

              {i < ETAPAS.length - 1 ? (
                <div
                  style={{
                    alignSelf: "center",
                    fontFamily: fonte.mono,
                    fontSize: 38,
                    color: cor.pautaForte,
                    opacity: seta,
                  }}
                >
                  ›
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>

      <Surge atraso={130}>
        <div
          style={{
            fontFamily: fonte.mono,
            fontSize: 26,
            color: cor.toner3,
            letterSpacing: 1,
          }}
        >
          nenhuma dessas etapas usa a internet
        </div>
      </Surge>
    </AbsoluteFill>
  );
};
