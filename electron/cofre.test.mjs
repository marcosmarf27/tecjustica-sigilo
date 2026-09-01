/**
 * Testes do cofre cifrado.
 *
 * As duas garantias que sustentam a mudança de promessa do produto são
 * verificadas aqui, e não só descritas na documentação:
 *
 *   1. **Falha fechada** — sem cifragem disponível, o cofre recusa gravar em
 *      vez de gravar em claro.
 *   2. **Nada legível em repouso** — o critério de aceitação pede conferir o
 *      arquivo com um editor hexadecimal procurando CPF. Isso é uma busca por
 *      substring nos bytes, e uma busca por substring é automatizável: o teste
 *      faz exatamente essa conferência, a cada execução, em vez de depender de
 *      alguém lembrar de abrir o arquivo à mão.
 *
 * O módulo `electron` não existe fora do Electron, então o `require` dele é
 * interceptado abaixo. O `safeStorage` falso aplica uma transformação
 * reversível e **não-identidade** — sem isso, o teste de "não há CPF legível"
 * passaria mesmo com o cofre gravando texto puro, que é justamente o defeito
 * que ele existe para pegar.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Controla o que o `safeStorage` falso responde durante cada teste. */
const controle = {
  cifragemDisponivel: true,
  /* Faz a N-ésima chamada a `encryptString` falhar (1 = a primeira). Serve
     para exercitar a falha *entre* gravar o conteúdo e gravar o índice, que é
     onde nasceria um arquivo órfão. */
  falharNaCifragem: 0,
  cifragens: 0,
};

let pastaTemporaria;

const electronFalso = {
  app: {
    getPath: (nome) => {
      if (nome !== "userData") throw new Error(`getPath inesperado: ${nome}`);
      return pastaTemporaria;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => controle.cifragemDisponivel,
    encryptString: (texto) => {
      if (!controle.cifragemDisponivel) {
        throw new Error("cifragem indisponível");
      }
      controle.cifragens += 1;
      if (controle.cifragens === controle.falharNaCifragem) {
        throw new Error("falha simulada na cifragem");
      }
      /* XOR com uma chave fixa, mais um prefixo. Reversível e suficiente para
         que o texto original não apareça nos bytes — é o que o teste de
         legibilidade precisa exercitar. */
      const bruto = Buffer.from(texto, "utf-8");
      const cifrado = Buffer.alloc(bruto.length);
      for (let i = 0; i < bruto.length; i++) cifrado[i] = bruto[i] ^ 0x5a;
      return Buffer.concat([Buffer.from("FAKE"), cifrado]);
    },
    decryptString: (buffer) => {
      const corpo = buffer.subarray(4);
      const claro = Buffer.alloc(corpo.length);
      for (let i = 0; i < corpo.length; i++) claro[i] = corpo[i] ^ 0x5a;
      return claro.toString("utf-8");
    },
  },
};

const carregarOriginal = Module._load;
Module._load = function (pedido, pai, ehPrincipal) {
  if (pedido === "electron") return electronFalso;
  return carregarOriginal.apply(this, [pedido, pai, ehPrincipal]);
};

const cofre = require(path.join(RAIZ, "dist-electron", "cofre.js"));

/* Dados de teste com a cara do que o cofre guarda de verdade. O CPF é
   sintético, mas o formato é o que importa para a busca nos bytes. */
const CPF_DE_TESTE = "529.982.247-25";
const NOME_DE_TESTE = "Joaquina Ferreira de Albuquerque";

function conteudoDeExemplo() {
  return {
    textoOriginal: `Requerente: ${NOME_DE_TESTE}, CPF ${CPF_DE_TESTE}, residente na Rua das Acácias.`,
    textoAnonimizado: "Requerente: [PESSOA_1], CPF [CPF_1], residente na [ENDERECO_1].",
    ocorrencias: [
      { type: "PERSON", text: NOME_DE_TESTE, start: 12, end: 44, score: 0.99 },
      { type: "CPF_BR", text: CPF_DE_TESTE, start: 51, end: 65, score: 1 },
    ],
    caminhoOriginal: "C:\\autos\\peticao.pdf",
  };
}

function entradaDeExemplo(extra = {}) {
  return {
    nome: "Petição inicial.pdf",
    cnj: "0001234-56.2023.8.06.0001",
    totalOcorrencias: 2,
    porTipo: { PERSON: 1, CPF_BR: 1 },
    paginasComErro: 0,
    totalPaginas: 14,
    ...extra,
  };
}

describe("cofre", () => {
  before(() => {
    pastaTemporaria = fs.mkdtempSync(path.join(os.tmpdir(), "cofre-teste-"));
  });

  after(() => {
    fs.rmSync(pastaTemporaria, { recursive: true, force: true });
    Module._load = carregarOriginal;
  });

  beforeEach(() => {
    controle.cifragemDisponivel = true;
    controle.falharNaCifragem = 0;
    controle.cifragens = 0;
    cofre.esvaziar();
  });

  test("grava e relê um documento inteiro", () => {
    const original = conteudoDeExemplo();
    const entrada = cofre.gravar(entradaDeExemplo(), original);

    assert.match(entrada.id, /^[0-9a-f]{32}$/, "id deve ser hex de 32 dígitos");
    assert.ok(entrada.gravadoEm, "deve registrar quando foi gravado");

    const relido = cofre.ler(entrada.id);
    assert.deepEqual(relido, original, "o conteúdo tem de voltar idêntico");
  });

  test("o índice lista o que foi gravado, mais recente primeiro", () => {
    const a = cofre.gravar(entradaDeExemplo({ nome: "A.pdf" }), conteudoDeExemplo());
    const b = cofre.gravar(entradaDeExemplo({ nome: "B.pdf" }), conteudoDeExemplo());

    const lista = cofre.listar();
    assert.equal(lista.length, 2);
    assert.equal(lista[0].id, b.id, "o mais recente vem primeiro");
    assert.equal(lista[1].id, a.id);
  });

  test("nenhum CPF ou nome legível nos bytes em repouso", () => {
    const entrada = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());

    /* A conferência que o critério de aceitação descreve como "abrir com editor
       hexadecimal": procurar o dado sensível nos bytes de cada arquivo do
       cofre — o conteúdo e o índice. */
    const arquivos = fs
      .readdirSync(path.join(pastaTemporaria, "cofre"))
      .map((f) => path.join(pastaTemporaria, "cofre", f));

    assert.ok(arquivos.length >= 2, "deve haver ao menos conteúdo e índice");

    for (const arquivo of arquivos) {
      const bytes = fs.readFileSync(arquivo);
      for (const codificacao of ["utf-8", "latin1", "utf16le"]) {
        const texto = bytes.toString(codificacao);
        assert.ok(
          !texto.includes(CPF_DE_TESTE),
          `CPF legível em ${path.basename(arquivo)} (${codificacao})`
        );
        assert.ok(
          !texto.includes(NOME_DE_TESTE),
          `nome legível em ${path.basename(arquivo)} (${codificacao})`
        );
      }
    }

    // E o índice também não pode entregar o nome do arquivo nem o CNJ.
    const indice = fs.readFileSync(path.join(pastaTemporaria, "cofre", "indice.bin"));
    assert.ok(
      !indice.toString("utf-8").includes("0001234-56.2023"),
      "o número do processo não pode estar legível no índice"
    );

    assert.ok(cofre.ler(entrada.id), "e mesmo assim tem de reler");
  });

  test("RECUSA gravar quando o sistema não oferece cifragem", () => {
    controle.cifragemDisponivel = false;

    assert.throws(
      () => cofre.gravar(entradaDeExemplo(), conteudoDeExemplo()),
      /cofre|cifragem/i,
      "gravar sem cifragem tem de lançar, não gravar em claro"
    );

    /* A parte que importa de verdade: além de lançar, não pode ter deixado
       nada para trás. Um cofre que grava e só depois falha seria pior que um
       que não grava. */
    const pasta = path.join(pastaTemporaria, "cofre");
    const restos = fs.existsSync(pasta) ? fs.readdirSync(pasta) : [];
    assert.deepEqual(restos, [], "nada pode ter sido escrito em disco");
  });

  test("disponivel() acompanha o safeStorage", () => {
    controle.cifragemDisponivel = false;
    assert.equal(cofre.disponivel(), false);
    controle.cifragemDisponivel = true;
    assert.equal(cofre.disponivel(), true);
  });

  test("apagar remove o conteúdo e a linha do índice", () => {
    const a = cofre.gravar(entradaDeExemplo({ nome: "A.pdf" }), conteudoDeExemplo());
    const b = cofre.gravar(entradaDeExemplo({ nome: "B.pdf" }), conteudoDeExemplo());

    cofre.apagar(a.id);

    assert.equal(cofre.ler(a.id), null, "o conteúdo tem de sumir do disco");
    assert.deepEqual(
      cofre.listar().map((i) => i.id),
      [b.id],
      "e a linha tem de sair do índice"
    );
  });

  test("esvaziar não deixa rastro", () => {
    cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    cofre.esvaziar();

    assert.deepEqual(cofre.listar(), []);
    assert.equal(
      fs.existsSync(path.join(pastaTemporaria, "cofre")),
      false,
      "a pasta inteira tem de sair — um esvaziar que deixa rastro não esvazia"
    );
  });

  test("expurgo apaga o que passou do prazo e preserva o resto", () => {
    const antigo = cofre.gravar(
      entradaDeExemplo({ nome: "antigo.pdf" }),
      conteudoDeExemplo()
    );
    const novo = cofre.gravar(
      entradaDeExemplo({ nome: "novo.pdf" }),
      conteudoDeExemplo()
    );

    /* Envelhece o primeiro reescrevendo o índice: 40 dias atrás, contra um
       prazo de 30. */
    const quarentaDiasAtras = new Date(
      Date.now() - 40 * 24 * 60 * 60 * 1000
    ).toISOString();
    const indice = cofre
      .listar()
      .map((i) => (i.id === antigo.id ? { ...i, gravadoEm: quarentaDiasAtras } : i));
    // Regrava o índice pelo próprio cofre, para não duplicar a lógica de cifra.
    fs.writeFileSync(
      path.join(pastaTemporaria, "cofre", "indice.bin"),
      electronFalso.safeStorage.encryptString(JSON.stringify(indice))
    );

    const removidos = cofre.expurgar(30);

    assert.equal(removidos, 1, "só o vencido sai");
    assert.deepEqual(cofre.listar().map((i) => i.id), [novo.id]);
    assert.equal(cofre.ler(antigo.id), null, "o conteúdo do vencido some");
    assert.ok(cofre.ler(novo.id), "o que está no prazo continua legível");
  });

  test("expurgo com prazo zero não apaga nada", () => {
    cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    assert.equal(cofre.expurgar(0), 0, "prazo 0 significa 'guardar para sempre'");
    assert.equal(cofre.listar().length, 1);
  });

  test("RECUSA gravar sobre um índice ilegível, em vez de destruí-lo", () => {
    /* O caso real: perfil do Windows recriado, `userData` copiado de outra
       máquina, senha redefinida por administrador. Os arquivos estão lá e são
       indecifráveis. Gravar por cima apagaria a referência a tudo que já está
       guardado — os arquivos continuariam ocupando disco, com dados pessoais
       dentro, e sem forma nenhuma de serem alcançados ou expurgados. */
    cofre.gravar(entradaDeExemplo({ nome: "importante.pdf" }), conteudoDeExemplo());

    fs.writeFileSync(
      path.join(pastaTemporaria, "cofre", "indice.bin"),
      Buffer.from("lixo que nao decifra")
    );

    assert.throws(
      () => cofre.gravar(entradaDeExemplo({ nome: "novo.pdf" }), conteudoDeExemplo()),
      /índice do cofre/i,
      "gravar sobre um índice ilegível tem de falhar"
    );
  });

  test("conteúdo órfão não sobra quando o índice falha", () => {
    cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    const antes = fs.readdirSync(path.join(pastaTemporaria, "cofre")).length;

    /* `gravar` cifra duas vezes: primeiro o conteúdo, depois o índice. Falhar
       na segunda reproduz exatamente a janela perigosa — o conteúdo já está no
       disco e nada aponta para ele. Um órfão desses guarda dados pessoais,
       ocupa espaço e é invisível até para o expurgo, que percorre o índice. */
    controle.cifragens = 0;
    controle.falharNaCifragem = 2;

    assert.throws(
      () => cofre.gravar(entradaDeExemplo({ nome: "vai-falhar.pdf" }), conteudoDeExemplo()),
      /falha simulada/
    );

    controle.falharNaCifragem = 0;

    assert.equal(
      fs.readdirSync(path.join(pastaTemporaria, "cofre")).length,
      antes,
      "o conteúdo já gravado tem de sumir junto com a falha, não virar órfão"
    );
    assert.equal(cofre.listar().length, 1, "e o índice continua com o item bom");
  });

  test("id fora do formato é recusado", () => {
    // Fecha a porta para um "../" chegar por um canal futuro, como a API v1.
    assert.throws(() => cofre.ler("../../etc/passwd"), /id inválido/);
  });

  test("apagar RECUSA agir sobre um índice ilegível, em vez de esvaziá-lo", () => {
    /* A mesma destruição que `gravar` já se protegia de cometer, pela porta de
       trás: com o índice ilegível, `listar()` devolve `[]`, o filtro devolve
       `[]`, e gravar isso apagava de uma vez a referência a TODOS os documentos
       guardados — para apagar um. Os arquivos ficavam no disco, com dados
       pessoais dentro, inalcançáveis pela biblioteca e invisíveis ao expurgo. */
    const entrada = cofre.gravar(entradaDeExemplo({ nome: "importante.pdf" }), conteudoDeExemplo());
    const arquivoDoConteudo = path.join(pastaTemporaria, "cofre", `${entrada.id}.bin`);
    const indice = path.join(pastaTemporaria, "cofre", "indice.bin");

    fs.writeFileSync(indice, Buffer.from("lixo que nao decifra"));
    const bytesDoIndice = fs.readFileSync(indice);

    assert.throws(
      () => cofre.apagar(entrada.id),
      /índice do cofre/i,
      "apagar com índice ilegível tem de falhar"
    );
    assert.deepEqual(
      fs.readFileSync(indice),
      bytesDoIndice,
      "o índice ilegível não pode ser sobrescrito"
    );
    assert.ok(
      fs.existsSync(arquivoDoConteudo),
      "e o conteúdo tem de continuar lá, para poder ser recuperado"
    );
  });

  test("apagar tira do índice ANTES de tocar no disco", () => {
    /* Ordem espelhada à de `gravar`, e pelo mesmo motivo: o índice nunca pode
       apontar para um arquivo que não existe. Na ordem antiga o conteúdo saía
       primeiro, e uma falha na gravação do índice deixava a biblioteca listando
       um documento que não abre — sem rollback possível, porque arquivo apagado
       não volta.

       O teste força exatamente essa falha. Fazer só o caminho feliz não provaria
       nada: com tudo dando certo, as duas ordens terminam iguais. */
    const entrada = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    const arquivoDoConteudo = path.join(pastaTemporaria, "cofre", `${entrada.id}.bin`);

    // Durante `apagar` há uma cifragem só: a do índice. Falha nela.
    controle.cifragens = 0;
    controle.falharNaCifragem = 1;
    assert.throws(() => cofre.apagar(entrada.id), /falha simulada/);
    controle.falharNaCifragem = 0;

    assert.ok(
      fs.existsSync(arquivoDoConteudo),
      "falhando o índice, o conteúdo TEM de continuar lá — na ordem antiga já teria sido apagado"
    );
    assert.equal(
      cofre.listar().length,
      1,
      "e o índice continua íntegro, apontando para um arquivo que existe"
    );

    // Sem a falha, apagar apaga dos dois lugares.
    cofre.apagar(entrada.id);
    assert.equal(cofre.listar().length, 0, "sai do índice");
    assert.equal(fs.existsSync(arquivoDoConteudo), false, "e sai do disco");
  });

  test("limparPendentes termina a remoção que ficou pela metade", () => {
    /* O caso real: antivírus segurando o `.bin` no instante do "Apagar". O
       documento sai do índice — para o usuário, apagou — mas o arquivo cifrado
       com dado pessoal continua no perfil. É privacidade, não disco.

       Para forçar a falha sem depender de antivírus, o conteúdo vira uma pasta
       não-vazia: `fs.rmSync` sem `recursive` recusa uma pasta em qualquer
       sistema. Trocar `fs.rmSync` por um espião não serviria — o TypeScript
       compila `import * as fs` com `__importStar`, que **copia** as funções, e
       a cópia dentro do módulo não enxerga o remendo. */
    const entrada = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    const pasta = path.join(pastaTemporaria, "cofre");
    const arquivo = path.join(pasta, `${entrada.id}.bin`);

    fs.rmSync(arquivo);
    fs.mkdirSync(arquivo);
    fs.writeFileSync(path.join(arquivo, "trava"), "segurando");

    cofre.apagar(entrada.id);

    assert.equal(cofre.listar().length, 0, "saiu da biblioteca mesmo assim");
    assert.ok(fs.existsSync(arquivo), "mas o conteúdo ficou — é o que se conserta");
    assert.ok(
      fs.existsSync(path.join(pasta, "pendentes.bin")),
      "e a remoção ficou anotada, em vez de esquecida"
    );

    // O antivírus solta o arquivo: agora ele é removível.
    fs.rmSync(arquivo, { recursive: true });
    fs.writeFileSync(arquivo, Buffer.from("conteudo que sobrou"));

    assert.equal(cofre.limparPendentes(), 1, "a próxima abertura termina o serviço");
    assert.equal(fs.existsSync(arquivo), false, "e agora o arquivo saiu");
    assert.equal(
      fs.existsSync(path.join(pasta, "pendentes.bin")),
      false,
      "com a fila vazia, o arquivo da fila também sai"
    );
  });

  test("limparPendentes recolhe .tmp de gravação interrompida", () => {
    /* `cifrarPara` grava em `<alvo>.tmp` e renomeia — e `rename` é atômico. Um
       `.tmp` que sobrou é de uma gravação que NÃO completou: o destino continua
       na versão anterior e quem chamou recebeu a exceção. Nada aponta para ele,
       e ele guarda dado pessoal cifrado. */
    const viva = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    const pasta = path.join(pastaTemporaria, "cofre");
    fs.writeFileSync(path.join(pasta, "indice.bin.tmp"), Buffer.from("interrompido"));

    assert.equal(cofre.limparPendentes(), 1);
    assert.equal(fs.existsSync(path.join(pasta, "indice.bin.tmp")), false);
    assert.ok(fs.existsSync(path.join(pasta, `${viva.id}.bin`)), "o resto fica");
    assert.equal(cofre.listar().length, 1, "e a biblioteca segue intacta");
  });

  test("PERDER o índice não apaga documento nenhum", () => {
    /* O defeito da primeira versão desta limpeza, e a razão de ela ter virado
       uma fila explícita.

       Ela varria a pasta e apagava todo `.bin` que o índice não mencionasse.
       Com o `indice.bin` APAGADO — antivírus em quarentena, restauração parcial
       de perfil —, `indiceIlegivel()` devolve `false` (arquivo ausente não é
       arquivo ilegível) e `listar()` devolve `[]`. Todo conteúdo guardado
       parecia órfão, e a rotina de faxina apagava a biblioteca inteira.

       Ausência de referência não prova que o arquivo é lixo: prova que a
       referência sumiu — e a referência é a coisa mais frágil do conjunto. */
    const a = cofre.gravar(entradaDeExemplo({ nome: "a.pdf" }), conteudoDeExemplo());
    const b = cofre.gravar(entradaDeExemplo({ nome: "b.pdf" }), conteudoDeExemplo());
    const pasta = path.join(pastaTemporaria, "cofre");

    fs.rmSync(path.join(pasta, "indice.bin"));
    assert.equal(cofre.listar().length, 0, "sem índice, a biblioteca aparece vazia");

    assert.equal(cofre.limparPendentes(), 0, "e a limpeza não pode tocar em nada");
    assert.ok(fs.existsSync(path.join(pasta, `${a.id}.bin`)), "o conteúdo de a fica");
    assert.ok(fs.existsSync(path.join(pasta, `${b.id}.bin`)), "o conteúdo de b fica");
    assert.deepEqual(
      cofre.ler(a.id),
      conteudoDeExemplo(),
      "e continua legível: o índice se perdeu, o documento não"
    );
  });

  // --- Regravar um documento já guardado -----------------------------------
  //
  // O cofre é gravado assim que o processamento termina, ANTES da revisão. Sem
  // `atualizar`, rejeitar um falso positivo corrigia a tela e deixava no cofre
  // a versão suja — e é do cofre que a conversa lê.

  test("atualizar troca o conteúdo e preserva id e data", () => {
    const antes = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());

    const depois = cofre.atualizar(
      antes.id,
      entradaDeExemplo({ totalOcorrencias: 1, porTipo: { CPF_BR: 1 } }),
      { ...conteudoDeExemplo(), textoAnonimizado: "Requerente: Ana, CPF [CPF_1]." }
    );

    /* Trocar o id seria a implementação preguiçosa — apagar e gravar. O id é o
       que a revisão aberta e a seleção da conversa carregam: trocá-lo no meio
       da sessão transformaria uma correção em "documento não está mais no
       cofre". A data também fica: revisar não é guardar de novo. */
    assert.equal(depois.id, antes.id);
    assert.equal(depois.gravadoEm, antes.gravadoEm);
    assert.equal(depois.totalOcorrencias, 1);
    assert.equal(
      cofre.ler(antes.id).textoAnonimizado,
      "Requerente: Ana, CPF [CPF_1]."
    );
  });

  test("atualizar mexe só no documento pedido", () => {
    const a = cofre.gravar(entradaDeExemplo({ nome: "A.pdf" }), conteudoDeExemplo());
    const b = cofre.gravar(entradaDeExemplo({ nome: "B.pdf" }), conteudoDeExemplo());

    cofre.atualizar(a.id, entradaDeExemplo({ nome: "A.pdf" }), {
      ...conteudoDeExemplo(),
      textoAnonimizado: "só o A mudou",
    });

    assert.equal(cofre.ler(b.id).textoAnonimizado, conteudoDeExemplo().textoAnonimizado);
    assert.equal(cofre.listar().length, 2, "não duplicou a linha do índice");
    assert.deepEqual(
      cofre.listar().map((i) => i.id).sort(),
      [a.id, b.id].sort()
    );
  });

  test("atualizar um id que não está no cofre devolve null, sem criar nada", () => {
    /* Documento apagado no meio do caminho, ou nunca guardado porque o cofre
       está desligado. Recriar a entrada aqui passaria por cima do
       consentimento que a gravação tem — e gravaria dados pessoais no disco de
       quem escolheu não guardar nenhum. */
    assert.equal(
      cofre.atualizar("naoexiste", entradaDeExemplo(), conteudoDeExemplo()),
      null
    );
    assert.equal(cofre.listar().length, 0);
    const pasta = path.join(pastaTemporaria, "cofre");
    const restos = fs.existsSync(pasta)
      ? fs.readdirSync(pasta).filter((f) => f.endsWith(".bin"))
      : [];
    assert.deepEqual(restos, [], "nada pode ter sido escrito em disco");
  });

  test("RECUSA atualizar sobre um índice ilegível, em vez de destruí-lo", () => {
    /* Mesma guarda de `gravar` e `apagar`: com o índice ilegível — perfil do
       Windows trocado —, regravá-lo por cima apagaria a referência a tudo que
       já está guardado. */
    const a = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    const pasta = path.join(pastaTemporaria, "cofre");
    fs.writeFileSync(path.join(pasta, "indice.bin"), Buffer.from("lixo"));

    assert.throws(() =>
      cofre.atualizar(a.id, entradaDeExemplo(), conteudoDeExemplo())
    );
  });

  test("RECUSA atualizar quando o sistema não oferece cifragem", () => {
    const a = cofre.gravar(entradaDeExemplo(), conteudoDeExemplo());
    controle.cifragemDisponivel = false;

    assert.throws(
      () => cofre.atualizar(a.id, entradaDeExemplo(), conteudoDeExemplo()),
      /cofre|cifragem/i,
      "sem cifragem, regravar em claro seria pior que não regravar"
    );
  });

});
