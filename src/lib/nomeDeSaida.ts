/**
 * Como nomear o arquivo anonimizado.
 *
 * O resultado da anonimização é sempre **texto** — markdown, quando a entrada
 * foi um documento que passou pelo extrator. Não é um PDF, não é um DOCX, não é
 * uma imagem: é o texto que saiu de dentro deles, com os dados pessoais
 * mascarados.
 *
 * Isto existia errado: o nome de saída preservava a extensão de entrada, com
 * uma exceção para `.rtf`. Então `peticao.pdf` era salvo como
 * `peticao_anonimizado.pdf` contendo markdown — um arquivo que nenhum leitor de
 * PDF abre. O mesmo valia para `.docx`, `.xlsx` e imagens. A exceção do `.rtf`
 * mostra que o problema era conhecido; os formatos adicionados depois não foram
 * incluídos.
 *
 * A regra agora é a inversa e não tem exceção: a extensão descreve o que o
 * arquivo **é**, não de onde veio.
 */

/** Formatos cujo conteúdo já é texto puro e sobrevive a si mesmo. */
const TEXTO_PURO = new Set([".txt", ".md", ".markdown"]);

export type FormatoSaida = "md" | "txt" | "docx";

export function extensaoDeSaida(nomeOriginal: string, formato?: FormatoSaida): string {
  if (formato === "docx") return ".docx";
  if (formato === "txt") return ".txt";

  const ponto = nomeOriginal.lastIndexOf(".");
  const original = ponto > 0 ? nomeOriginal.slice(ponto).toLowerCase() : "";

  // Texto que entrou como texto sai como entrou — não há estrutura a ganhar.
  if (TEXTO_PURO.has(original)) return original;

  // Todo o resto virou markdown ao ser extraído: PDF, DOCX, planilha,
  // apresentação, imagem digitalizada. E o RTF, cuja formatação se perde na
  // conversão.
  return ".md";
}

export function nomeDeSaida(nomeOriginal: string, formato?: FormatoSaida): string {
  const ponto = nomeOriginal.lastIndexOf(".");
  const base = ponto > 0 ? nomeOriginal.slice(0, ponto) : nomeOriginal;
  return `${base}_anonimizado${extensaoDeSaida(nomeOriginal, formato)}`;
}

/** Caminho completo, ao lado do arquivo original. */
export function caminhoDeSaida(
  caminhoOriginal: string,
  nomeOriginal: string,
  formato?: FormatoSaida
): string {
  const nome = nomeDeSaida(nomeOriginal, formato);
  const separador = caminhoOriginal.includes("\\") ? "\\" : "/";
  const corte = caminhoOriginal.lastIndexOf(separador);
  const pasta = corte > 0 ? caminhoOriginal.substring(0, corte) : "";
  return pasta ? `${pasta}${separador}${nome}` : nome;
}
