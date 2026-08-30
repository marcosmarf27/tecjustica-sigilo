import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * `sessao.json` — como um programa local descobre onde o motor está.
 *
 * ## O gap número um
 *
 * A porta é dinâmica (`findAvailablePort(8123)` — com 8123 ocupada, o backend
 * sobe em 8124), o token é sorteado a cada execução e anunciado por stdout, e
 * ambos só existem na memória de dois processos. Sem isto, a CLI, uma extensão
 * do PJe ou um agente MCP não têm como sequer *achar* o backend, quanto mais
 * falar com ele.
 *
 * ## Por que não tem token dentro
 *
 * Esta é a fronteira que faz o desenho funcionar: **uma página de navegador não
 * lê arquivo; um programa local lê.**
 *
 * A descoberta chega a quem deve — processos rodando na máquina do usuário, que
 * é quem tem motivo legítimo para automatizar o trabalho dele — e não chega a
 * quem não deve: uma página aberta no navegador, que alcança `127.0.0.1` mas
 * não alcança o sistema de arquivos. Nenhuma criptografia envolvida; só a
 * escolha do canal.
 *
 * Quem lê este arquivo descobre a porta e então **pede pareamento**, que exige
 * aprovação humana com um código visível nos dois lados. Colocar o token aqui
 * transformaria o arquivo numa credencial e jogaria fora essa etapa inteira.
 */

interface Sessao {
  versao: 1;
  porta: number;
  pid: number;
  api: "habilitada" | "desabilitada";
}

function caminho(): string {
  return path.join(app.getPath("userData"), "sessao.json");
}

export function escrever(porta: number): void {
  const sessao: Sessao = {
    versao: 1,
    porta,
    pid: process.pid,
    api: "habilitada",
  };

  try {
    fs.mkdirSync(path.dirname(caminho()), { recursive: true });
    /* `\n` explícito, sem depender do padrão da plataforma: o arquivo é lido
       por um cliente Python, e manter os bytes previsíveis entre sistemas é o
       hábito do resto do projeto. */
    fs.writeFileSync(caminho(), JSON.stringify(sessao, null, 2) + "\n", {
      encoding: "utf-8",
    });
  } catch (erro) {
    /* Não subir a exceção: a descoberta é uma conveniência para clientes
       externos, e a janela do aplicativo funciona sem ela. Derrubar o boot do
       app porque o `userData` está somente-leitura seria trocar um recurso
       auxiliar pelo produto inteiro. */
    console.error("Não foi possível escrever sessao.json:", erro);
  }
}

/**
 * Apaga o arquivo ao encerrar.
 *
 * Um `sessao.json` órfão aponta para uma porta que não responde mais — ou,
 * pior, para uma porta que outro programa qualquer pegou nesse meio-tempo. E
 * apagar aqui não cobre tudo: o `before-quit` não roda numa queda de energia
 * nem quando o processo é encerrado pelo gerenciador de tarefas.
 *
 * **Por isso a defesa que vale é do lado do cliente, e é de identidade.** Antes
 * de mandar qualquer conteúdo, ele chama `GET /v1/info` e confere que a
 * resposta se identifica como este produto (`produto` e `api`). Status 200
 * sozinho não serve: qualquer servidor que tenha ficado com a porta responde
 * 200, e o passo seguinte de um cliente é um POST com o texto dos autos.
 *
 * O `pid` continua publicado para quem quiser um sinal a mais, mas ele **não**
 * é a checagem principal — pid é reciclado pelo sistema, e em Python o idioma
 * POSIX `os.kill(pid, 0)` no Windows chama `TerminateProcess`: mataria o
 * aplicativo em vez de perguntar por ele. Ver `cliente_local.app_no_ar`.
 */
export function apagar(): void {
  try {
    if (fs.existsSync(caminho())) fs.rmSync(caminho());
  } catch {
    // Encerrando de qualquer forma; não há a quem reportar.
  }
}
