import { app, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Cofre — armazenamento cifrado de documentos anonimizados.
 *
 * ## A mudança de promessa, declarada
 *
 * Guardar o texto original e a lista de ocorrências cria no perfil do usuário
 * exatamente o artefato que este aplicativo existe para evitar: um índice
 * pesquisável de CPFs, nomes e endereços de um processo. A decisão foi tomada
 * com o custo à vista, para que a revisão possa ser reaberta de verdade — o
 * histórico anterior prometia isso e falhava, porque guardava só metadados
 * enquanto o conteúdo vivia na memória da sessão.
 *
 * O que torna a decisão defensável **não é opcional** e está tudo aqui:
 * cifragem em repouso, falha fechada, e nada gravado sem consentimento.
 *
 * ## Cifragem
 *
 * `safeStorage` do Electron. No Windows é DPAPI, atrelado à conta do usuário:
 * a chave é gerenciada pelo sistema, então não há senha para o usuário lembrar
 * nem arquivo de chave para vazar junto.
 *
 * **O limite, dito com todas as letras:** DPAPI protege contra outro usuário da
 * máquina e contra leitura do disco fora do sistema (o HD removido e montado
 * noutro lugar). **Não** protege contra um programa malicioso rodando como o
 * próprio usuário — esse programa pede a decifragem ao sistema e recebe.
 *
 * ## Falha fechada
 *
 * Com `isEncryptionAvailable()` falso — acontece em Linux sem chaveiro — o
 * cofre **recusa gravar**. Nunca grava em claro. É a mesma cultura do
 * `fetch-ocr-models.sh`, que recusa um download sem pin em vez de seguir com
 * um modelo não verificado: quando a garantia não pode ser dada, a operação
 * não acontece.
 *
 * ## O índice também é cifrado
 *
 * Poderia parecer exagero — é só uma lista. Mas nome de arquivo em processo
 * judicial carrega nome de pessoa ("Petição inicial - João da Silva.pdf"), e o
 * número CNJ identifica o processo. Um índice em claro entregaria de graça
 * boa parte do que o resto está protegendo.
 */

export interface EntradaDoCofre {
  id: string;
  /** Nome do arquivo original. */
  nome: string;
  /** ISO 8601. */
  gravadoEm: string;
  /** Número CNJ detectado, ou `null` para "Avulsos". */
  cnj: string | null;
  /** Quantas ocorrências foram encontradas. */
  totalOcorrencias: number;
  /** Contagem por tipo de entidade. */
  porTipo: Record<string, number>;
  /** Páginas que precisavam de OCR e não voltaram. */
  paginasComErro: number;
  totalPaginas: number;
}

/** O conteúdo pesado, num arquivo por documento. */
export interface ConteudoDoCofre {
  textoOriginal: string;
  textoAnonimizado: string;
  ocorrencias: unknown[];
  caminhoOriginal: string;
  ocr?: unknown;
  /* Em que condições o texto anonimizado foi produzido. Enquanto ele só era
     reaberto para revisão por quem já tinha o original, nada disso fazia falta.
     Faz falta a partir do momento em que o texto pode sair da máquina: os
     mesmos caracteres significam coisas diferentes conforme a política
     aplicada, as entidades pedidas e o motor que rodou.

     Todos opcionais porque o cofre tem documentos gravados antes disto existir.
     Ausente é **desconhecido**, e quem consome trata desconhecido como recusa —
     nunca como "deve ser o padrão". */
  politicaMascara?: string;
  valoresDistintos?: Record<string, number>;
  modoNlp?: string;
  entidadesSolicitadas?: string[];
}

/**
 * O que a conversa recebe — sem o texto original.
 *
 * `ConteudoDoCofre` guarda `textoOriginal` e `textoAnonimizado` lado a lado, e
 * trocar um pelo outro na hora de montar o que sai da máquina é uma edição de
 * uma palavra que vaza o processo inteiro. Nenhuma revisão de código pega isso
 * de forma confiável, porque as duas linhas são plausíveis.
 *
 * Então o campo não entra em escopo. Quem monta a conversa recebe este tipo, e
 * a linha errada deixa de ser possível de escrever.
 */
export type ConteudoParaConversa = Omit<ConteudoDoCofre, "textoOriginal">;

export class CofreIndisponivelError extends Error {
  constructor() {
    super(
      "O sistema não oferece cifragem para esta conta, e o cofre não grava em claro."
    );
    this.name = "CofreIndisponivelError";
  }
}

function pastaDoCofre(): string {
  return path.join(app.getPath("userData"), "cofre");
}

function caminhoDoIndice(): string {
  return path.join(pastaDoCofre(), "indice.bin");
}

function caminhoDoConteudo(id: string): string {
  /* O id é gerado aqui e nunca vem de fora, mas a checagem custa nada e fecha
     a porta para um `../` chegar por um canal futuro (a API v1, por exemplo). */
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("id inválido");
  return path.join(pastaDoCofre(), `${id}.bin`);
}

export function disponivel(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function exigirDisponivel() {
  if (!disponivel()) throw new CofreIndisponivelError();
}

function cifrarPara(caminho: string, valor: unknown) {
  exigirDisponivel();
  fs.mkdirSync(pastaDoCofre(), { recursive: true });
  const cifrado = safeStorage.encryptString(JSON.stringify(valor));
  /* Grava num temporário e renomeia: `rename` no mesmo volume é atômico, então
     uma queda de energia no meio deixa o arquivo antigo intacto em vez de um
     índice truncado — que levaria a biblioteca inteira junto. */
  const temporario = `${caminho}.tmp`;
  fs.writeFileSync(temporario, cifrado);
  fs.renameSync(temporario, caminho);
}

function decifrarDe<T>(caminho: string, reserva: T): T {
  if (!fs.existsSync(caminho)) return reserva;
  try {
    const cifrado = fs.readFileSync(caminho);
    return JSON.parse(safeStorage.decryptString(cifrado)) as T;
  } catch {
    /* Decifragem falha quando o perfil do Windows mudou ou o arquivo foi
       copiado de outra máquina — DPAPI é atrelado à conta. Devolver a reserva
       deixa o aplicativo abrir; o item simplesmente não é legível. */
    return reserva;
  }
}

/**
 * Um índice que existe mas não pôde ser lido.
 *
 * A distinção entre "não há índice" e "há um índice ilegível" é a diferença
 * entre gravar normalmente e **destruir a biblioteca inteira**. `listar()`
 * devolve `[]` nos dois casos — o que é certo para exibir —, mas gravar por
 * cima de um índice ilegível apagaria a referência a todos os documentos
 * guardados, que continuariam ocupando disco sem forma de serem alcançados.
 *
 * Acontece de verdade: perfil do Windows recriado, `userData` copiado de outra
 * máquina, senha da conta redefinida por administrador. Nesses casos os
 * arquivos estão lá e são indecifráveis; o certo é parar, não sobrescrever.
 */
function indiceIlegivel(): boolean {
  const caminho = caminhoDoIndice();
  if (!fs.existsSync(caminho)) return false;
  try {
    JSON.parse(safeStorage.decryptString(fs.readFileSync(caminho)));
    return false;
  } catch {
    return true;
  }
}

function exigirIndiceUtilizavel() {
  if (indiceIlegivel()) {
    throw new Error(
      "O índice do cofre existe mas não pôde ser decifrado — provavelmente " +
        "foi gravado por outra conta de usuário. Gravar agora apagaria a " +
        "referência aos documentos já guardados. Use “Esvaziar o cofre” para " +
        "recomeçar do zero."
    );
  }
}

export function listar(): EntradaDoCofre[] {
  return decifrarDe<EntradaDoCofre[]>(caminhoDoIndice(), []);
}

export function gravar(
  entrada: Omit<EntradaDoCofre, "id" | "gravadoEm">,
  conteudo: ConteudoDoCofre
): EntradaDoCofre {
  exigirDisponivel();
  exigirIndiceUtilizavel();

  const completa: EntradaDoCofre = {
    ...entrada,
    id: crypto.randomBytes(16).toString("hex"),
    gravadoEm: new Date().toISOString(),
  };

  /* Conteúdo primeiro, índice depois. Na ordem inversa, uma falha no meio
     deixaria o índice apontando para um arquivo que não existe — e a
     biblioteca mostraria um item que não abre, que é justamente o defeito que
     o cofre veio consertar. */
  const arquivoDoConteudo = caminhoDoConteudo(completa.id);
  cifrarPara(arquivoDoConteudo, conteudo);

  try {
    cifrarPara(caminhoDoIndice(), [completa, ...listar()]);
  } catch (erro) {
    /* Falhando o índice, o conteúdo já gravado seria um órfão: ocupa disco,
       guarda dados pessoais e nada mais aponta para ele — invisível também
       para o expurgo, que percorre o índice. Some junto com a falha. */
    try {
      if (fs.existsSync(arquivoDoConteudo)) fs.rmSync(arquivoDoConteudo);
    } catch {
      /* Nem apagar deu. O `id` vai para a fila em vez de o arquivo ficar no
         perfil para sempre — o erro original continua sendo o que sobe. */
      marcarPendente(completa.id);
    }
    throw erro;
  }

  return completa;
}

export function ler(id: string): ConteudoDoCofre | null {
  return decifrarDe<ConteudoDoCofre | null>(caminhoDoConteudo(id), null);
}

/**
 * O mesmo documento, sem o texto original, para o que vai sair da máquina.
 *
 * A eliminação é explícita e feita aqui, no ponto mais próximo do disco. Ela
 * não substitui a verificação do corpo antes do envio — são camadas diferentes:
 * esta impede a linha errada de existir, a outra confere o resultado.
 */
export function lerParaConversa(id: string): ConteudoParaConversa | null {
  const conteudo = ler(id);
  if (conteudo === null) return null;

  const { textoOriginal: _descartado, ...semOriginal } = conteudo;
  return semOriginal;
}

/**
 * A ordem inversa da gravação, e pelo mesmo motivo.
 *
 * `gravar` põe o conteúdo antes do índice porque só assim uma falha no meio
 * deixa um órfão (recuperável) em vez de um índice apontando para arquivo que
 * não existe. **Apagar tem de ser o espelho disso: índice primeiro.** A versão
 * anterior removia o conteúdo antes, e uma falha na gravação do índice — disco
 * cheio, perfil trocado no meio da sessão — deixava a biblioteca listando um
 * documento cujo arquivo já tinha sumido. Clicar em "Abrir" não abria nada, e
 * ali não havia rollback possível: arquivo apagado não volta.
 *
 * O preço da ordem certa é um arquivo que sobra quando a remoção do conteúdo
 * falha depois do índice — e sobrar, aqui, não é só disco ocupado: é texto com
 * dado pessoal que o usuário mandou apagar e continua no perfil. Por isso o
 * `id` entra na fila de `limparPendentes`, que tenta de novo na abertura
 * seguinte. Nada é inferido de ausência: a fila é explícita.
 */
export function apagar(id: string): void {
  exigirDisponivel();
  /* Sem esta guarda, um índice ilegível fazia `listar()` devolver `[]`, o
     filtro devolvia `[]`, e o cofre gravava um índice VAZIO por cima — a
     referência a todos os documentos guardados morria de uma vez, para apagar
     um. É a mesma destruição que `gravar` já se protegia de cometer; faltava
     aqui. */
  exigirIndiceUtilizavel();

  const arquivo = caminhoDoConteudo(id);
  cifrarPara(
    caminhoDoIndice(),
    listar().filter((e) => e.id !== id)
  );

  try {
    if (fs.existsSync(arquivo)) fs.rmSync(arquivo);
  } catch (erro) {
    /* O documento já saiu do índice: para o usuário, apagou. Estourar aqui
       mostraria erro sobre uma operação que deu certo. O que não pode é o
       arquivo cifrado ficar no perfil para sempre — daí a fila, que
       `limparPendentes` tenta de novo na próxima abertura. */
    console.error("[cofre] remoção adiada:", erro);
    marcarPendente(id);
  }
}

/**
 * A fila de remoções que ainda não puderam ser feitas.
 *
 * ## Por que uma lista, e não uma varredura
 *
 * A primeira versão disto varria a pasta e apagava todo `.bin` que o índice não
 * mencionasse. Parece equivalente e **não é**: ausência de referência não prova
 * que o arquivo é lixo — prova que a referência sumiu, e a referência é
 * justamente a coisa mais frágil aqui.
 *
 * O caso que derruba a varredura: `indice.bin` **apagado** (antivírus em
 * quarentena, restauração parcial de perfil, exclusão à mão). `indiceIlegivel()`
 * devolve `false`, porque arquivo ausente não é arquivo ilegível, e `listar()`
 * devolve `[]`. Aí *todo* conteúdo guardado parece órfão e a faxina apaga a
 * biblioteca inteira — exatamente o desastre que o cofre deveria evitar, agora
 * causado pela rotina de limpeza.
 *
 * Com uma lista explícita não há inferência: só entra aqui o `id` que alguém
 * mandou apagar e cuja remoção falhou. Índice perdido não destrói nada.
 */
function caminhoDosPendentes(): string {
  return path.join(pastaDoCofre(), "pendentes.bin");
}

function lerPendentes(): string[] {
  const lista = decifrarDe<string[]>(caminhoDosPendentes(), []);
  return Array.isArray(lista) ? lista.filter((id) => /^[0-9a-f]{32}$/.test(id)) : [];
}

/**
 * Anota que um conteúdo tem de sair do disco e ainda não saiu.
 *
 * Melhor esforço de propósito: falhar em registrar a pendência não pode
 * derrubar a operação que já deu certo do ponto de vista do usuário — o
 * documento já saiu do índice e a biblioteca não o alcança mais.
 */
function marcarPendente(id: string): void {
  try {
    const atual = lerPendentes();
    if (!atual.includes(id)) cifrarPara(caminhoDosPendentes(), [...atual, id]);
  } catch (erro) {
    console.error("[cofre] não foi possível registrar remoção pendente:", erro);
  }
}

/**
 * Tenta de novo o que ficou pendente, e recolhe `.tmp` de gravação interrompida.
 *
 * Roda na abertura do aplicativo. O motivo é de privacidade, não de disco: um
 * conteúdo que o usuário mandou apagar e não saiu é texto de processo com dado
 * pessoal continuando no perfil. Antivírus segurando o arquivo é a causa comum,
 * e some sozinha na próxima sessão.
 *
 * Os `.tmp` são inequívocos: `cifrarPara` grava em `<alvo>.tmp` e renomeia, e o
 * `rename` é atômico. Um `.tmp` que sobrou é de uma gravação que **não**
 * completou — o arquivo de destino continua na versão anterior, e quem chamou
 * recebeu a exceção. Nada aponta para ele.
 *
 * Devolve quantos arquivos saíram.
 */
export function limparPendentes(): number {
  const pasta = pastaDoCofre();
  if (!disponivel() || !fs.existsSync(pasta)) return 0;

  let removidos = 0;
  const restantes: string[] = [];

  for (const id of lerPendentes()) {
    const arquivo = path.join(pasta, `${id}.bin`);
    try {
      if (fs.existsSync(arquivo)) {
        fs.rmSync(arquivo);
        removidos += 1;
      }
      /* Se não existe, já foi: sai da fila. */
    } catch {
      restantes.push(id);
    }
  }

  for (const nome of fs.readdirSync(pasta)) {
    if (!nome.endsWith(".tmp")) continue;
    try {
      fs.rmSync(path.join(pasta, nome));
      removidos += 1;
    } catch {
      /* Fica para a próxima abertura; insistir agora não ajuda. */
    }
  }

  try {
    if (restantes.length > 0) {
      cifrarPara(caminhoDosPendentes(), restantes);
    } else if (fs.existsSync(caminhoDosPendentes())) {
      fs.rmSync(caminhoDosPendentes());
    }
  } catch (erro) {
    console.error("[cofre] não foi possível atualizar a fila de pendentes:", erro);
  }

  return removidos;
}

export function esvaziar(): void {
  const pasta = pastaDoCofre();
  if (!fs.existsSync(pasta)) return;
  /* Apaga a pasta inteira, incluindo o índice: um "esvaziar" que deixasse
     rastro não seria esvaziar. */
  fs.rmSync(pasta, { recursive: true, force: true });
}

/**
 * Apaga o que passou do prazo. Devolve quantos itens saíram.
 *
 * Roda na abertura do aplicativo. O prazo é escolha do usuário (padrão 30
 * dias) e existe porque o valor de reabrir um documento cai rápido, enquanto o
 * risco de manter texto com dado pessoal no disco não cai nunca.
 */
export function expurgar(diasDeRetencao: number): number {
  if (!disponivel() || diasDeRetencao <= 0) return 0;

  const limite = Date.now() - diasDeRetencao * 24 * 60 * 60 * 1000;
  const todas = listar();
  const sobreviventes = todas.filter(
    (e) => new Date(e.gravadoEm).getTime() >= limite
  );

  if (sobreviventes.length === todas.length) return 0;

  /* Índice primeiro, conteúdo depois — pelo mesmo motivo explicado em `apagar`.
     Aqui a ordem errada era ainda mais cara: o expurgo mexe em vários itens de
     uma vez, então uma falha na gravação do índice deixaria a biblioteca
     listando *todos* os expirados com o arquivo já apagado. */
  cifrarPara(caminhoDoIndice(), sobreviventes);

  for (const morta of todas.filter((e) => !sobreviventes.includes(e))) {
    const arquivo = caminhoDoConteudo(morta.id);
    try {
      if (fs.existsSync(arquivo)) fs.rmSync(arquivo);
    } catch {
      /* O item já saiu da biblioteca; o arquivo entra na fila de pendentes e
         `limparPendentes` tenta de novo na próxima abertura. Derrubar o expurgo
         inteiro por um arquivo travado deixaria os outros expirados no disco,
         que é o oposto do objetivo. */
      marcarPendente(morta.id);
    }
  }

  return todas.length - sobreviventes.length;
}
