import { corDaEntidade } from "../types";

/**
 * Um nome real, reposto no lugar do pseudônimo que de fato trafegou.
 *
 * A troca é local e só na exibição: o que saiu da máquina foi `[PESSOA_1]`, e o
 * mapa que liga o rótulo ao nome nunca deixou o processo principal. Por isso a
 * marca visual não é enfeite — ela distingue o que o modelo escreveu do que
 * este aplicativo repôs, e é a diferença entre ler uma resposta e confiar nela.
 *
 * O `title` mostra o pseudônimo, para quem quiser conferir o que trafegou sem
 * sair da tela.
 */
export function PseudonimoReposto({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: string;
}) {
  const tipo = rotulo.replace(/^\[|_\d+\]$/g, "");

  return (
    <mark
      title={`repostos localmente no lugar de ${rotulo}`}
      className="rounded-[3px] px-0.5 font-medium text-text"
      style={{
        backgroundColor: `color-mix(in srgb, ${corDaEntidade(tipo)} 22%, transparent)`,
        boxShadow: `inset 0 -1px 0 ${corDaEntidade(tipo)}`,
      }}
    >
      {valor}
    </mark>
  );
}

/**
 * Um pseudônimo que não é desta conversa.
 *
 * O modelo pode citar `[PESSOA_9]` num processo com três pessoas. Apagar em
 * silêncio esconderia a invenção; trocar por um nome qualquer seria pior. Fica
 * à vista, marcado como o que é.
 */
export function PseudonimoDesconhecido({ rotulo }: { rotulo: string }) {
  return (
    <mark
      title="este pseudônimo não existe nos documentos desta conversa"
      className="rounded-[3px] border border-dashed border-danger px-1 font-mono text-2xs text-danger"
      style={{ backgroundColor: "transparent" }}
    >
      {rotulo} ?
    </mark>
  );
}
