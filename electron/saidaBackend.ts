/**
 * Leitura da saída padrão do backend.
 *
 * Vive em arquivo próprio porque tem um detalhe que já custou caro: a saída de
 * um processo filho chega em pedaços que **não** respeitam limite de linha. Um
 * token de 43 caracteres pode vir partido entre dois eventos, e casar a
 * expressão regular contra um pedaço solto rende metade do segredo. Meio token
 * é rejeitado exatamente como token nenhum — com o agravante de que o erro só
 * aparece muito depois, quando a pessoa manda processar o primeiro documento e
 * recebe 403 sem explicação.
 *
 * Por isso a saída é acumulada e só linhas completas são interpretadas.
 */

export interface LeitorDeSaida {
  /** Consome mais um pedaço da saída. */
  consumir(pedaco: string): void;
}

export interface OuvintesDeSaida {
  /** Chamado quando a credencial da sessão é anunciada. */
  aoReceberToken(token: string): void;
  /** Chamado para cada linha que não é a credencial. */
  aoRegistrar(linha: string): void;
}

const MARCADOR_TOKEN = /^PRESIDIO_TOKEN=(\S+)$/;

export function criarLeitorDeSaida(ouvintes: OuvintesDeSaida): LeitorDeSaida {
  let pendente = "";

  return {
    consumir(pedaco: string): void {
      pendente += pedaco;
      const linhas = pendente.split(/\r?\n/);
      // O último pedaço pode estar incompleto: fica para o próximo evento.
      pendente = linhas.pop() ?? "";

      for (const linha of linhas) {
        const marcador = linha.match(MARCADOR_TOKEN);
        if (marcador) {
          ouvintes.aoReceberToken(marcador[1]);
          continue;
        }
        if (linha.trim()) ouvintes.aoRegistrar(linha.trim());
      }
    },
  };
}
