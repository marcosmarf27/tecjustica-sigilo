import { useState } from "react";
import { CliInstaller } from "../components/CliInstaller";
import { Botao, Cartao, Dialogo, Selo } from "../ui";
import type { ClientePareado } from "../hooks/usePythonBackend";

/**
 * Conexões — quem, além desta janela, alcança o motor.
 *
 * ## O pareamento, e por que ele tem um código
 *
 * Um cliente abre `POST /v1/parear` e recebe seis caracteres. Os **mesmos** seis
 * aparecem no diálogo aqui. Conferir o código nos dois lados é o que separa
 * "autorizei o programa que eu acabei de rodar" de "cliquei em permitir num
 * pedido que apareceu sozinho" — sem isso, qualquer processo local poderia
 * abrir um pedido e torcer para a pessoa aprovar no automático.
 *
 * O pedido vale 180 segundos. Curto de propósito: quem pareia está com o
 * programa aberto na frente. Um pedido que sobrevive à tarde inteira vira uma
 * aprovação distraída.
 *
 * ## O escopo que não se concede
 *
 * `arquivo-local` — ler um arquivo do disco por caminho — **nunca** é dado em
 * pareamento, mesmo quando pedido. Cliente externo manda o conteúdo; quem lê o
 * disco continua sendo só esta janela. É a resposta direta ao fato de que
 * `127.0.0.1` não protege nada: qualquer página aberta no navegador alcança
 * portas locais.
 */

function tempoRelativo(epochSegundos: number | null): string {
  if (!epochSegundos) return "nunca usada";
  const segundos = Math.floor(Date.now() / 1000 - epochSegundos);
  if (segundos < 60) return "agora há pouco";
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `há ${Math.floor(segundos / 3600)} h`;
  return `há ${Math.floor(segundos / 86400)} d`;
}

interface ConexoesProps {
  /** `127.0.0.1:8123` — a porta é dinâmica, então precisa vir de fora. */
  enderecoApi: string;
  motorPronto: boolean;
  avisar: (mensagem: string, tipo?: "sucesso" | "erro") => void;
  /** Lista mantida pelo App, que também a usa no rodapé do trilho. */
  clientes: ClientePareado[];
  aoRecarregar: () => void;
  revogarCliente: (id: string) => Promise<void>;
}

export function Conexoes({
  enderecoApi,
  motorPronto,
  avisar,
  clientes,
  aoRecarregar,
  revogarCliente,
}: ConexoesProps) {
  const [aRevogar, setARevogar] = useState<ClientePareado | null>(null);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-text">
            Conexões
          </h1>

          {/* O endereço da API, à vista.
              Faltava, e a falta era grave: a porta é **dinâmica** (a primeira
              livre a partir de 8123), então sem mostrá-la aqui nem o operador
              nem quem for escrever uma extensão tem como descobrir onde o motor
              está. Era a informação mais importante desta tela. */}
          <div className="text-right">
            <p className="flex items-center justify-end gap-2 font-mono text-2xs tracking-wide text-text-secondary uppercase">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  motorPronto ? "bg-success" : "bg-text-tertiary"
                }`}
              />
              API local · {motorPronto ? "ligada" : "subindo"}
            </p>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(enderecoApi);
                avisar(`${enderecoApi} copiado.`);
              }}
              title="Copiar o endereço"
              className="mt-1 rounded font-mono text-sm text-accent underline decoration-accent/40 decoration-2 underline-offset-4 hover:decoration-accent"
            >
              {enderecoApi}
            </button>
          </div>
        </div>

        <Cartao
          titulo="Como um programa se conecta"
          descricao="O mesmo caminho vale para a linha de comando, uma extensão de navegador ou um agente."
        >
          <ol className="space-y-2.5 text-sm text-text-secondary">
            <li className="flex gap-2.5">
              <span className="font-mono text-2xs text-text-tertiary">1</span>
              <span>
                O programa chama{" "}
                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-2xs text-text">
                  POST /v1/parear
                </code>{" "}
                e recebe um código de seis letras.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono text-2xs text-text-tertiary">2</span>
              <span>
                O <strong className="text-text">mesmo código</strong> aparece
                aqui numa janela, com o nome de quem pediu. Conferir os dois é o
                que impede aprovar às cegas.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono text-2xs text-text-tertiary">3</span>
              <span>
                Aprovado, ele recebe uma credencial e passa a aparecer na lista
                abaixo — onde pode ser revogado a qualquer momento.
              </span>
            </li>
          </ol>
          <p className="mt-3 text-xs text-text-tertiary">
            Para a linha de comando, o comando é{" "}
            <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-2xs text-text">
              tecjustica-sigilo conectar
            </code>
            . O contrato completo para quem escreve um cliente está em{" "}
            <code className="font-mono text-2xs">docs/api-local.md</code>.
          </p>
        </Cartao>

        <CliInstaller
          onClose={() => {}}
          showToast={(mensagem, tipo) =>
            avisar(mensagem, tipo === "error" ? "erro" : "sucesso")
          }
        />

        <Cartao
          titulo="Clientes pareados"
          descricao="Programas autorizados a usar o motor desta máquina."
        >
          {clientes.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nenhum cliente pareado. Um programa que peça acesso aparece aqui
              para você aprovar, com um código que precisa bater com o dele.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text">{c.nome}</p>
                    <p className="mt-0.5 truncate font-mono text-2xs text-text-tertiary">
                      {c.origem ?? "origem desconhecida"} ·{" "}
                      {tempoRelativo(c.ultimo_uso)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.escopos.map((e) => (
                        <Selo key={e} tom="acao">
                          {e}
                        </Selo>
                      ))}
                    </div>
                  </div>
                  <Botao
                    tipo="perigo"
                    tamanho="mini"
                    onClick={() => setARevogar(c)}
                  >
                    Revogar
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="O que um cliente externo pode fazer">
          <ul className="space-y-2 text-sm text-text-secondary">
            <li className="flex gap-2">
              <Selo tom="acao">anonimizar</Selo>
              <span>manda um texto, recebe o texto mascarado.</span>
            </li>
            <li className="flex gap-2">
              <Selo tom="acao">ocr</Selo>
              <span>manda uma imagem, recebe o texto reconhecido.</span>
            </li>
            <li className="flex gap-2">
              <Selo tom="acao">documento</Selo>
              <span>envia um PDF ou DOCX e recebe o texto.</span>
            </li>
          </ul>
          <p className="mt-3 border-l-2 border-warning pl-3 text-xs leading-normal text-text-secondary">
            Ler um arquivo do disco <strong>por caminho</strong> não está nessa
            lista e nunca é concedido. Um cliente externo sempre manda o
            conteúdo; quem abre arquivo do seu computador continua sendo só esta
            janela.
          </p>
        </Cartao>

        <Dialogo
          aberto={aRevogar !== null}
          aoFechar={() => setARevogar(null)}
          titulo="Revogar acesso"
          acoes={
            <>
              <Botao tipo="secundario" onClick={() => setARevogar(null)}>
                Cancelar
              </Botao>
              <Botao
                tipo="perigo"
                onClick={async () => {
                  if (!aRevogar) return;
                  try {
                    await revogarCliente(aRevogar.id);
                    avisar(`${aRevogar.nome} não tem mais acesso.`);
                    aoRecarregar();
                  } catch (erro) {
                    avisar(
                      erro instanceof Error ? erro.message : "Falhou",
                      "erro"
                    );
                  } finally {
                    setARevogar(null);
                  }
                }}
              >
                Revogar
              </Botao>
            </>
          }
        >
          <p>
            <strong className="text-text">{aRevogar?.nome}</strong> perde o
            acesso imediatamente. Para voltar a usar, terá de parear de novo.
          </p>
        </Dialogo>
      </div>
    </div>
  );
}
