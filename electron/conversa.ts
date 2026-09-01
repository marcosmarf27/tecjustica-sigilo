/**
 * A conversa: onde o documento vira prompt, e onde tudo é conferido antes de sair.
 *
 * Vive no processo principal por dois motivos que se somam. A chave da API
 * precisa de `safeStorage`, que só existe aqui. E o mapa de pseudônimos — a
 * tabela que liga `[PESSOA_1]` a um nome real — é a peça mais sensível do
 * recurso: ficando aqui, ela nunca atravessa a ponte IPC. O renderer recebe a
 * resposta **já re-hidratada**, em pedaços prontos para desenhar, e nunca a
 * tabela inteira.
 *
 * As conversas moram em memória e morrem com o aplicativo, de propósito.
 * Persisti-las criaria um segundo índice pesquisável de dados pessoais ao lado
 * do cofre — e o cofre só se justifica porque o produto precisava reabrir a
 * revisão. Uma conversa não precisa.
 */

import { randomUUID } from "crypto";

import * as cofre from "./cofre";
import * as openrouter from "./openrouter";
import { MODELO_PADRAO, estimar, estimarTokens, modeloPorId } from "./catalogo";
import { carimbar, type Proibido } from "./trava";
import {
  MapaDeSessao,
  type Ocorrencia,
  type Trecho,
  incorporar,
  pareceMascaradoComPlaceholder,
  prepararPergunta,
  reidratar,
} from "./pseudonimos";

/** Detecta dado pessoal num texto curto. Implementado pelo `main`, contra o backend. */
export type Detector = (texto: string) => Promise<Ocorrencia[]>;

export interface Aviso {
  grave: boolean;
  texto: string;
}

export interface Turno {
  papel: "usuario" | "assistente";
  /** O que foi digitado / o que o modelo respondeu, já re-hidratado. */
  trechos: Trecho[];
  /** Só para o turno do usuário: o que foi trocado antes de sair. */
  trocas?: { valor: string; rotulo: string }[];
}

export interface EstadoDaConversa {
  id: string;
  documentos: { id: string; nome: string }[];
  avisos: Aviso[];
  turnos: Turno[];
  /** Resposta em construção, já re-hidratada. Vazia quando não há envio em curso. */
  parcial: Trecho[];
  enviando: boolean;
  comprometida: boolean;
  erro: string | null;
  provedor: string | null;
  gastoDolares: number;
  tokensDoContexto: number;
  modelo: string;
}

interface Conversa {
  id: string;
  mapa: MapaDeSessao;
  documentos: { id: string; nome: string }[];
  /** O texto de cada peça, já no espaço de numeração comum. */
  textos: string[];
  proibidos: Proibido[];
  avisos: Aviso[];
  turnos: Turno[];
  parcial: Trecho[];
  enviando: boolean;
  comprometida: boolean;
  erro: string | null;
  provedor: string | null;
  gastoDolares: number;
  tokensDoContexto: number;
  modelo: string;
  cancelador: AbortController | null;
}

const conversas = new Map<string, Conversa>();

const INSTRUCAO = `Você lê autos de processos judiciais brasileiros que foram anonimizados.

Os dados pessoais foram substituídos por pseudônimos numerados, como [PESSOA_1], [CPF_2] ou [ENDEREÇO_1]. Cada número identifica uma pessoa ou um valor distinto, de forma consistente em todos os documentos desta conversa: [PESSOA_1] é sempre a mesma pessoa, e [PESSOA_2] é outra.

Regras:
- Use os pseudônimos exatamente como aparecem. Nunca invente um pseudônimo que não esteja nos documentos, e nunca tente adivinhar o nome real por trás de um deles.
- Se a resposta não estiver nos documentos, diga que não está. Não complete com conhecimento geral sobre direito brasileiro sem deixar claro que é isso que está fazendo.
- Um mesmo nome pode ter recebido pseudônimos diferentes quando aparece de forma incompleta no documento original. Por isso, ao contar pessoas, diga que está contando pseudônimos distintos.
- Cite a peça (Documento 1, Documento 2...) quando apoiar uma afirmação.

Responda em português do Brasil.`;

/**
 * Abre uma conversa sobre documentos do cofre.
 *
 * Recebe **ids**, nunca texto. É o mesmo princípio de `escopo_da_rota` no
 * backend: o caminho perigoso — mandar texto arbitrário para a nuvem — não
 * existe na interface, em vez de existir e ser evitado por disciplina.
 */
export function abrir(ids: string[], modelo = MODELO_PADRAO): EstadoDaConversa {
  if (ids.length === 0) throw new Error("nenhum documento selecionado");

  const mapa = new MapaDeSessao();
  const documentos: { id: string; nome: string }[] = [];
  const textos: string[] = [];
  const proibidos: Proibido[] = [];
  const avisos: Aviso[] = [];

  const indice = cofre.listar();

  for (const id of ids) {
    const entrada = indice.find((i) => i.id === id);
    const conteudo = cofre.lerParaConversa(id);
    if (entrada === undefined || conteudo === null) {
      throw new Error(`documento ${id} não está mais no cofre`);
    }

    exigirConversavel(entrada.nome, conteudo);
    avisos.push(...avisarSobre(entrada.nome, conteudo));

    const ocorrencias = (conteudo.ocorrencias ?? []) as Ocorrencia[];
    textos.push(incorporar(conteudo.textoAnonimizado, ocorrencias, mapa));
    documentos.push({ id, nome: entrada.nome });

    /* Tudo que não pode aparecer no que sai. Os valores reais das ocorrências,
       claro — mas também o nome do arquivo e o CNJ, que são dado pessoal: o
       próprio cofre cifra o índice porque "Petição inicial - João da Silva.pdf"
       carrega um nome e o CNJ identifica o processo. E o CNJ é uma das
       entidades que o motor mascara dentro do texto; deixá-lo reaparecer num
       cabeçalho desfaria o trabalho. */
    for (const oc of ocorrencias) {
      proibidos.push({ tipo: oc.type, valor: oc.text });
    }
    proibidos.push({ tipo: "nome do arquivo", valor: entrada.nome });
    if (entrada.cnj) proibidos.push({ tipo: "número do processo", valor: entrada.cnj });
    if (conteudo.caminhoOriginal) {
      proibidos.push({ tipo: "caminho do arquivo", valor: conteudo.caminhoOriginal });
    }
  }

  const conversa: Conversa = {
    id: randomUUID(),
    mapa,
    documentos,
    textos,
    proibidos,
    avisos,
    turnos: [],
    parcial: [],
    enviando: false,
    comprometida: false,
    erro: null,
    provedor: null,
    gastoDolares: 0,
    tokensDoContexto: estimarTokens(textos.join("\n\n") + INSTRUCAO),
    modelo,
    cancelador: null,
  };

  conversas.set(conversa.id, conversa);
  return exportar(conversa);
}

/**
 * Recusa o que não pode ser conversado.
 *
 * A política de máscara decide se o recurso funciona: `parcial` produz
 * `J**** d* S****` e `total` produz `*****`, e nenhuma das duas distingue duas
 * pessoas com as mesmas iniciais. Sem pseudônimo numerado não há como o modelo
 * raciocinar sobre quem é quem, nem como repor os nomes na tela.
 *
 * O campo não existia até esta versão, então o acervo antigo cai na inferência
 * pelo texto — que resolve o caso que importa (recusar o que veio mascarado com
 * asteriscos) e é declarada como inferência na mensagem.
 */
function exigirConversavel(nome: string, conteudo: cofre.ConteudoParaConversa) {
  const declarada = conteudo.politicaMascara;

  if (declarada !== undefined && declarada !== "placeholder") {
    throw new Error(
      `"${nome}" foi anonimizado com a política "${declarada}", que substitui ` +
        `os dados por asteriscos em vez de pseudônimos numerados. Não há como ` +
        `distinguir duas pessoas nesse texto. Reprocesse com a política ` +
        `"placeholder" para conversar sobre ele.`
    );
  }

  if (declarada === undefined && !pareceMascaradoComPlaceholder(conteudo.textoAnonimizado)) {
    throw new Error(
      `"${nome}" foi guardado antes de a conversa existir e não registra com ` +
        `que política foi mascarado; o texto também não tem pseudônimos ` +
        `numerados. Reprocesse o documento para conversar sobre ele.`
    );
  }
}

/** O que o usuário precisa saber antes de perguntar, mas não impede a conversa. */
function avisarSobre(
  nome: string,
  conteudo: cofre.ConteudoParaConversa
): Aviso[] {
  const avisos: Aviso[] = [];

  /* Documento anonimizado com o motor caído para spaCy tem recall
     materialmente pior que o do BERT, e é ele que sairia da máquina. O
     CLAUDE.md chama isso de "o risco de verdade" — e até aqui esse risco só
     valia para quem lia o documento; agora vale para quem o envia. */
  if (conteudo.modoNlp === "spacy") {
    avisos.push({
      grave: true,
      texto:
        `"${nome}" foi anonimizado com o motor leve (spaCy), que detecta menos ` +
        `que o BERT. A qualidade da anonimização deste documento é inferior à ` +
        `medida no gate do produto.`,
    });
  } else if (conteudo.modoNlp === undefined) {
    avisos.push({
      grave: false,
      texto: `"${nome}" não registra com que motor foi anonimizado.`,
    });
  }

  /* Entidade desmarcada na receita não é procurada — e o texto "anonimizado"
     carrega aquele tipo em claro. `porTipo`, do índice, conta o que foi
     ENCONTRADO, então não distingue "não pedi" de "não achei": só o que foi
     pedido responde essa pergunta. */
  const pedidas = conteudo.entidadesSolicitadas;
  if (pedidas === undefined) {
    avisos.push({
      grave: false,
      texto: `"${nome}" não registra quais tipos de dado foram procurados.`,
    });
  } else if (pedidas.length < 14) {
    avisos.push({
      grave: true,
      texto:
        `"${nome}" foi anonimizado procurando ${pedidas.length} dos 14 tipos de ` +
        `dado. O que ficou de fora continua em claro no texto que será enviado.`,
    });
  }

  return avisos;
}

export function estado(id: string): EstadoDaConversa | null {
  const conversa = conversas.get(id);
  return conversa ? exportar(conversa) : null;
}

export function fechar(id: string): void {
  conversas.get(id)?.cancelador?.abort();
  conversas.delete(id);
}

export function cancelar(id: string): void {
  conversas.get(id)?.cancelador?.abort();
}

/** Quanto custaria a próxima pergunta, para mostrar antes de enviar. */
export function orcamento(id: string) {
  const conversa = conversas.get(id);
  if (!conversa) return null;
  const modelo = modeloPorId(conversa.modelo);
  if (!modelo) return null;
  return estimar(modelo, conversa.tokensDoContexto);
}

/** O texto exato que sairia da máquina, para o usuário conferir antes. */
export function previsualizar(id: string): string | null {
  const conversa = conversas.get(id);
  if (!conversa) return null;
  return montarMensagens(conversa, "«sua pergunta»")
    .map((m) => `── ${m.role} ──\n${m.content}`)
    .join("\n\n");
}

function montarMensagens(
  conversa: Conversa,
  pergunta: string
): openrouter.Mensagem[] {
  /* Os documentos vão numerados, nunca pelo nome do arquivo. */
  const corpo = conversa.textos
    .map((t, i) => `## Documento ${i + 1}\n\n${t}`)
    .join("\n\n");

  const anteriores: openrouter.Mensagem[] = conversa.turnos.map((t) => ({
    role: t.papel === "usuario" ? "user" : "assistant",
    /* O histórico volta com os pseudônimos, não com os nomes repostos: o que
       trafegou foi o pseudônimo, e é ele que o modelo já viu. */
    content: t.trechos
      .map((p) => (p.tipo === "texto" ? p.texto : p.rotulo))
      .join(""),
  }));

  return [
    { role: "system", content: INSTRUCAO },
    { role: "user", content: `${corpo}\n\n---\n\nCom base nos documentos acima:` },
    ...anteriores,
    { role: "user", content: pergunta },
  ];
}

/**
 * Manda uma pergunta.
 *
 * A ordem aqui não é acidental: detectar, mascarar, montar, **carimbar**,
 * enviar. O carimbo é a última coisa antes da rede e vale sobre o corpo já
 * serializado, do jeito que sairia pelo fio.
 */
export function exigirPodeEnviar(id: string): void {
  /* Separado do envio de propósito. Quem chama espera por esta parte e o erro
     chega à tela; o envio em si roda solto, e os erros dele são lidos depois em
     `estado()`. Fundidos, uma recusa aqui viraria rejeição sem tratamento e o
     usuário clicaria em Enviar sem que nada acontecesse. */
  const conversa = conversas.get(id);
  if (!conversa) throw new Error("conversa não encontrada");
  if (conversa.enviando) throw new Error("já há uma pergunta em andamento");
  if (conversa.comprometida) {
    throw new Error(
      "esta conversa foi marcada como comprometida e não aceita novos envios"
    );
  }
}

export async function perguntar(
  id: string,
  pergunta: string,
  detectar: Detector,
  chave: string
): Promise<void> {
  const conversa = conversas.get(id);
  if (!conversa) return;

  conversa.erro = null;
  conversa.parcial = [];
  conversa.enviando = true;

  try {
    /* O detector local é DETECTOR, nunca numerador. A resposta dele traz um
       `anonymized_text` que não serve: o `Mascarador` do backend recomeça a
       numerar do 1 a cada chamada, então o `[PESSOA_1]` da pergunta seria outra
       pessoa que a do contexto — e o modelo responderia sobre quem não foi
       perguntado. Só as ocorrências são usadas; a numeração é feita aqui, a
       partir do mapa desta conversa. */
    const ocorrencias = await detectar(pergunta);
    const preparada = prepararPergunta(pergunta, ocorrencias, conversa.mapa);

    const mensagens = montarMensagens(conversa, preparada.texto);
    const modelo = modeloPorId(conversa.modelo);
    if (!modelo) throw new Error(`modelo desconhecido: ${conversa.modelo}`);

    const corpo = carimbar(
      openrouter.montarCorpo({
        modelo: conversa.modelo,
        mensagens,
        esforcoDeRaciocinio: "low",
      }),
      conversa.proibidos
    );

    conversa.turnos.push({
      papel: "usuario",
      trechos: reidratar(preparada.texto, conversa.mapa),
      trocas: preparada.trocas,
    });

    conversa.cancelador = new AbortController();
    const resultado = await openrouter.enviar(
      chave,
      corpo,
      conversa.modelo,
      (acumulado) => {
        conversa.parcial = reidratar(acumulado, conversa.mapa);
      },
      conversa.cancelador.signal
    );

    conversa.turnos.push({
      papel: "assistente",
      trechos: reidratar(resultado.texto, conversa.mapa),
    });
    conversa.parcial = [];
    conversa.provedor = resultado.provedor;
    if (resultado.custo !== null) conversa.gastoDolares += resultado.custo;

    for (const alarme of resultado.alarmes) {
      conversa.avisos.push({ grave: alarme.grave, texto: alarme.texto });
      if (alarme.grave) conversa.comprometida = true;
    }
  } catch (erro) {
    conversa.erro = erro instanceof Error ? erro.message : String(erro);
    conversa.parcial = [];
  } finally {
    conversa.enviando = false;
    conversa.cancelador = null;
  }
}

function exportar(c: Conversa): EstadoDaConversa {
  return {
    id: c.id,
    documentos: c.documentos,
    avisos: c.avisos,
    turnos: c.turnos,
    parcial: c.parcial,
    enviando: c.enviando,
    comprometida: c.comprometida,
    erro: c.erro,
    provedor: c.provedor,
    gastoDolares: c.gastoDolares,
    tokensDoContexto: c.tokensDoContexto,
    modelo: c.modelo,
  };
}
