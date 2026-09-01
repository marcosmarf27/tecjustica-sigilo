/**
 * A chave da API do OpenRouter, cifrada com DPAPI.
 *
 * Mesma cultura do cofre, e pelo mesmo motivo: `safeStorage` protege contra
 * outro usuário da máquina e contra leitura do disco fora do sistema, e **não**
 * protege contra programa malicioso rodando como o próprio usuário. A diferença
 * é que aqui o segredo não é do usuário — é uma credencial que gasta dinheiro.
 * Vale usar uma chave dedicada, com limite de crédito no painel do OpenRouter.
 *
 * ## Por que fora da pasta `cofre/`
 *
 * `cofre.esvaziar()` faz `fs.rmSync(pastaDoCofre(), { recursive: true })` e
 * `cofre.limparPendentes()` varre `*.tmp` de lá. Guardar a chave dentro dessa
 * pasta faria "esvaziar a biblioteca" apagar a credencial junto, e faria a
 * faxina do cofre disputar um arquivo temporário que não é dela. São dois
 * ciclos de vida diferentes: o usuário apaga documentos com frequência e troca
 * de chave quase nunca.
 *
 * ## A chave não atravessa a ponte IPC
 *
 * `ler()` existe para o processo principal usar ao montar a requisição, e
 * **nunca** é ligado a um `ipcMain.handle`. O renderer só enxerga `resumo()`,
 * que diz se existe chave e mostra os últimos quatro caracteres — o bastante
 * para o usuário reconhecer qual chave está ali, insuficiente para usá-la.
 */

import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";

export class CifragemIndisponivelError extends Error {
  constructor() {
    super(
      "O sistema não oferece cifragem para esta conta, e a chave da API não é gravada em claro."
    );
    this.name = "CifragemIndisponivelError";
  }
}

interface SegredoGravado {
  chave: string;
  gravadoEm: string;
}

/** O que o renderer pode saber sobre a chave. */
export interface ResumoDoSegredo {
  presente: boolean;
  ultimos4: string | null;
  gravadoEm: string | null;
}

function caminho(): string {
  return path.join(app.getPath("userData"), "segredos.bin");
}

export function disponivel(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function exigirDisponivel() {
  if (!disponivel()) throw new CifragemIndisponivelError();
}

/**
 * Grava, ou **recusa**. Nunca em claro.
 *
 * A mesma decisão do `cofre.gravar`: sem cifragem disponível, a resposta certa
 * é falhar de forma visível. Um fallback silencioso para texto puro deixaria a
 * credencial legível no perfil do usuário, e ninguém saberia.
 */
export function guardar(chave: string): void {
  exigirDisponivel();

  const limpa = chave.trim();
  if (limpa.length === 0) throw new Error("chave vazia");

  const valor: SegredoGravado = {
    chave: limpa,
    gravadoEm: new Date().toISOString(),
  };

  const cifrado = safeStorage.encryptString(JSON.stringify(valor));
  /* Temporário e rename, como no cofre: `rename` no mesmo volume é atômico, e
     uma queda no meio da gravação deixa a chave anterior intacta em vez de um
     arquivo truncado que não decifra. */
  const destino = caminho();
  const temporario = `${destino}.tmp`;
  fs.writeFileSync(temporario, cifrado);
  fs.renameSync(temporario, destino);
}

function lerGravado(): SegredoGravado | null {
  const destino = caminho();
  if (!fs.existsSync(destino)) return null;
  try {
    return JSON.parse(
      safeStorage.decryptString(fs.readFileSync(destino))
    ) as SegredoGravado;
  } catch {
    /* Perfil do Windows trocado, DPAPI atrelado a outra conta. Não dá para
       recuperar, e insistir não ajuda: quem chama trata como "não há chave" e o
       usuário cola outra. */
    return null;
  }
}

/**
 * A chave em claro, para montar a requisição.
 *
 * Só o processo principal chama isto. Não expor por IPC.
 */
export function ler(): string | null {
  return lerGravado()?.chave ?? null;
}

export function resumo(): ResumoDoSegredo {
  const gravado = lerGravado();
  if (gravado === null) {
    return { presente: false, ultimos4: null, gravadoEm: null };
  }
  return {
    presente: true,
    ultimos4: gravado.chave.slice(-4),
    gravadoEm: gravado.gravadoEm,
  };
}

export function apagar(): void {
  const destino = caminho();
  if (fs.existsSync(destino)) fs.rmSync(destino, { force: true });
  const temporario = `${destino}.tmp`;
  if (fs.existsSync(temporario)) fs.rmSync(temporario, { force: true });
}
