/**
 * Primitivas da interface.
 *
 * Antes desta camada, cada tela montava seus próprios botões, cartões e chips
 * com classes soltas — o que fazia dois botões com a mesma função terem alturas
 * diferentes e um SVG de cadeado existir em três cópias.
 *
 * A regra que atravessa todas elas é a das duas vozes: **mono** para o que a
 * máquina diz (rótulo, botão, número, estado, código) e **serifa** para o que
 * se lê (a prosa do app e o texto do processo). Nenhuma primitiva daqui usa
 * sans, porque não existe sans no sistema.
 */

export { Botao } from "./Botao";
export { Cartao } from "./Cartao";
export { Campo } from "./Campo";
export { Carimbo } from "./Carimbo";
export { Dialogo } from "./Dialogo";
export { GrupoSegmentado } from "./GrupoSegmentado";
export { Icone, type NomeIcone } from "./Icone";
export { Marcacao } from "./Marcacao";
export { Popover } from "./Popover";
export { Selo } from "./Selo";
export { Tabela, type ColunaTabela } from "./Tabela";
export { Tarja } from "./Tarja";
