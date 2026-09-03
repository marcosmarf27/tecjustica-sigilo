import React from "react";
import { Composition } from "remotion";

import { DURACAO_TOTAL, Explicativo } from "./Explicativo";
import { FPS } from "./tokens";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Explicativo"
    component={Explicativo}
    durationInFrames={DURACAO_TOTAL}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
