/**
 * A última barreira antes da rede.
 *
 * Todo o resto do desenho impede que dado pessoal chegue ao corpo da
 * requisição: o conteúdo vem de `cofre.lerParaConversa`, que não tem
 * `textoOriginal`; a pergunta passa pelo detector; os documentos entram como
 * "Documento 1", nunca pelo nome do arquivo.
 *
 * Isto aqui não confia em nada disso. Recebe o corpo **já serializado**, do
 * jeito exato que sairia pelo fio, e procura os valores que não podem estar
 * lá. Se achar, ninguém envia.
 *
 * A diferença entre esta verificação e as outras camadas é que ela mede o
 * resultado em vez de garantir o processo. É a mesma escolha que o backend faz
 * ao contar as páginas que o OCR realmente reconheceu, em vez de confiar que o
 * liteparse as entregou.
 *
 * Uma regra que não pode ser quebrada: **a mensagem de erro nunca mostra o
 * valor encontrado.** Uma defesa contra vazamento que escreve o dado vazado no
 * log é um vazamento com outro nome.
 */

/** Um valor que não pode aparecer no que sai da máquina. */
export interface Proibido {
  /** Só para a mensagem de erro: "CPF", "nome do arquivo", "CNJ". */
  tipo: string;
  valor: string;
}

export class VazamentoBloqueadoError extends Error {
  constructor(
    readonly tipo: string,
    readonly posicao: number
  ) {
    super(
      `um valor do tipo "${tipo}" apareceu no que seria enviado ` +
        `(posição ${posicao}); nada foi enviado`
    );
    this.name = "VazamentoBloqueadoError";
  }
}

/**
 * Forma comparável. Precisa ser a mesma normalização usada em
 * `pseudonimos.normalizar`, senão "JOÃO" no corpo escaparia de "joão" na lista.
 *
 * Colapsar espaço muda os deslocamentos em relação ao corpo original, e é por
 * isso que a posição relatada no erro é aproximada — serve para localizar, não
 * para recortar.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

/**
 * Abaixo disto não dá para verificar sem alarme falso constante.
 *
 * Um valor de duas letras casa dentro de qualquer palavra, e mesmo com
 * fronteira de palavra ele aparece sozinho em texto normal o tempo todo. O
 * próprio backend já descarta detecções assim (`_aparar` exige pelo menos dois
 * caracteres alfanuméricos).
 *
 * É um buraco, e vale dizê-lo em voz alta: um dado pessoal de um ou dois
 * caracteres não é pego por esta trava. Na prática não existe — nome, CPF, CEP,
 * OAB e telefone são todos bem maiores — mas a defesa é essa, e não outra.
 */
export const MINIMO_VERIFICAVEL = 3;

/** Caractere que faz parte de uma palavra, para efeito de fronteira. */
export function ehLetraOuDigito(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** O quanto de um valor conta para o mínimo: só letra e dígito. */
export function pesoVerificavel(valor: string): number {
  return valor.replace(/[^\p{L}\p{N}]/gu, "").length;
}

/**
 * Recusa o envio se algum valor proibido estiver no corpo.
 *
 * A busca exige fronteira de palavra dos dois lados. Sem isso, um `LOCATION`
 * chamado "Ana" bloquearia qualquer corpo que contivesse "Fernanda", e uma
 * trava que dispara sempre é desligada na primeira semana.
 */
export function verificarSaida(
  corpo: string,
  proibidos: Proibido[],
  isentas: string[] = []
): void {
  const alvo = normalizar(corpo);
  const trechosIsentos = localizarIsentas(alvo, isentas);

  for (const { tipo, valor } of proibidos) {
    const agulha = normalizar(valor).trim();
    if (pesoVerificavel(agulha) < MINIMO_VERIFICAVEL) continue;

    let de = alvo.indexOf(agulha);
    while (de !== -1) {
      const ate = de + agulha.length;
      const antes = alvo[de - 1];
      const depois = alvo[ate];
      if (
        !ehLetraOuDigito(antes) &&
        !ehLetraOuDigito(depois) &&
        !dentroDeAlguma(de, ate, trechosIsentos)
      ) {
        throw new VazamentoBloqueadoError(tipo, de);
      }
      de = alvo.indexOf(agulha, de + 1);
    }
  }
}

/**
 * Os trechos do corpo que são texto constante do próprio aplicativo.
 *
 * A instrução do sistema fala em "documento", "peça" e termina em "português do
 * Brasil". Basta o motor rotular qualquer uma dessas palavras como `LOCATION`
 * em algum ponto do processo — e ele rotula — para que ela entre na lista de
 * proibidos e a trava a encontre **no nosso próprio texto**, que não veio do
 * usuário e não revela nada sobre ele.
 *
 * Foi o que aconteceu na primeira conversa real: bloqueio na posição 1066, um
 * "Brasil" escrito por nós. Uma trava que dispara sobre o texto que ela mesma
 * escreveu é desligada na primeira semana, e aí não há trava nenhuma.
 *
 * Isentar é seguro porque a região é definida pela ocorrência **literal** de uma
 * constante do programa: nada que o usuário forneça cai dentro dela.
 */
function localizarIsentas(alvo: string, isentas: string[]): [number, number][] {
  const trechos: [number, number][] = [];
  for (const isenta of isentas) {
    const agulha = normalizar(isenta).trim();
    if (agulha.length === 0) continue;
    let de = alvo.indexOf(agulha);
    while (de !== -1) {
      trechos.push([de, de + agulha.length]);
      de = alvo.indexOf(agulha, de + agulha.length);
    }
  }
  return trechos;
}

function dentroDeAlguma(
  de: number,
  ate: number,
  trechos: [number, number][]
): boolean {
  return trechos.some(([inicio, fim]) => de >= inicio && ate <= fim);
}

/**
 * Corpo que passou pela trava.
 *
 * O tipo existe para que o cliente HTTP só aceite corpo carimbado: montar um
 * objeto à mão e chamar a rede direto deixa de compilar. É a mesma ideia do
 * `lerParaConversa` — tornar a linha errada impossível de escrever, em vez de
 * pedir atenção a quem escreve.
 */
declare const carimboDaTrava: unique symbol;

export interface CorpoVerificado {
  readonly json: string;
  /* O símbolo não é exportado, então este objeto não pode ser construído fora
     daqui — nem por engano, nem por pressa. */
  readonly [carimboDaTrava]: true;
}

export function carimbar(
  corpo: unknown,
  proibidos: Proibido[],
  isentas: string[] = []
): CorpoVerificado {
  const json = JSON.stringify(corpo);
  verificarSaida(json, proibidos, isentas);
  return { json } as unknown as CorpoVerificado;
}
