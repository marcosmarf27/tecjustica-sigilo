import { useEffect, useState } from "react";
import { Botao, Dialogo, Icone, Selo } from "../ui";
import type { PedidoDePareamento } from "../hooks/usePythonBackend";

/**
 * Aprovação de um pedido de pareamento.
 *
 * ## Por que mora na casca, e não na tela de Conexões
 *
 * Quem roda `tecjustica-sigilo conectar` no terminal olha para a janela do
 * aplicativo — que pode estar em qualquer destino. Com o polling dentro de
 * Conexões, o pedido só apareceria para quem já estivesse naquela tela, e o
 * comando expiraria em 180 s sem explicar nada. Um pedido de autorização não
 * pode depender de a pessoa já estar no lugar certo.
 *
 * ## Por que tem um código
 *
 * O cliente recebe seis caracteres ao abrir o pedido; os mesmos seis aparecem
 * aqui. Conferir nos dois lados é o que separa "autorizei o programa que eu
 * acabei de rodar" de "cliquei em permitir num pedido que apareceu sozinho".
 * Sem isso, qualquer processo local poderia abrir um pedido e torcer pela
 * aprovação automática.
 *
 * O diálogo é `obrigatorio`: não fecha por Esc nem por clique fora. Ou aprova,
 * ou recusa — deixar sumir seria transformar distração em consentimento.
 */

/** De quanto em quanto tempo procurar pedidos novos. */
const INTERVALO_DE_POLLING_MS = 2000;

interface AprovacaoDePareamentoProps {
  ativo: boolean;
  listarPedidos: () => Promise<PedidoDePareamento[]>;
  decidirPedido: (id: string, aprovado: boolean) => Promise<void>;
  avisar: (mensagem: string, tipo?: "sucesso" | "erro") => void;
  aoAprovar: () => void;
}

export function AprovacaoDePareamento({
  ativo,
  listarPedidos,
  decidirPedido,
  avisar,
  aoAprovar,
}: AprovacaoDePareamentoProps) {
  const [pedido, setPedido] = useState<PedidoDePareamento | null>(null);

  /* Um pedido nasce no backend a partir de uma requisição externa, sem passar
     pelo renderer — não há como o React saber que ele existe sem perguntar.
     Dois segundos deixam o diálogo parecer imediato a quem acabou de rodar o
     comando no terminal. */
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;

    const olhar = async () => {
      try {
        const pendentes = await listarPedidos();
        if (vivo) setPedido(pendentes[0] ?? null);
      } catch {
        // Sem backend não há pedido para mostrar.
      }
    };

    olhar();
    const timer = setInterval(olhar, INTERVALO_DE_POLLING_MS);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [ativo, listarPedidos]);

  const decidir = async (aprovado: boolean) => {
    if (!pedido) return;
    try {
      await decidirPedido(pedido.id, aprovado);
      avisar(
        aprovado
          ? `${pedido.nome} agora pode usar o motor.`
          : `Pedido de ${pedido.nome} recusado.`
      );
      if (aprovado) aoAprovar();
    } catch (erro) {
      avisar(
        erro instanceof Error ? erro.message : "Não foi possível decidir",
        "erro"
      );
    } finally {
      setPedido(null);
    }
  };

  return (
    <Dialogo
      aberto={pedido !== null}
      aoFechar={() => decidir(false)}
      obrigatorio
      titulo="Um programa pede acesso ao motor"
      acoes={
        <>
          <Botao tipo="secundario" onClick={() => decidir(false)}>
            Recusar
          </Botao>
          <Botao tipo="primario" onClick={() => decidir(true)}>
            Permitir
          </Botao>
        </>
      }
    >
      <p>
        <strong className="text-text">{pedido?.nome}</strong> quer usar o motor
        de anonimização desta máquina.
      </p>

      <p className="mt-3 font-mono text-2xs tracking-wide text-text-tertiary uppercase">
        Confira se este código é o mesmo que o programa mostrou
      </p>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.3em] text-accent tabular-nums">
        {pedido?.codigo}
      </p>
      <p className="mt-1 text-xs text-text-tertiary">
        Se os códigos não baterem, recuse — o pedido é de outro programa.
      </p>

      <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3">
        <p className="text-xs text-text-tertiary">
          Origem:{" "}
          <span className="font-mono text-text-secondary">
            {pedido?.origem ?? "não informada"}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-tertiary">Poderá:</span>
          {pedido?.escopos.map((e) => (
            <Selo key={e} tom="acao">
              {e}
            </Selo>
          ))}
          {pedido?.escopos.length === 0 && (
            <span className="text-xs text-text-tertiary">nada — recuse</span>
          )}
        </div>
        <p className="flex items-start gap-1.5 pt-1 text-xs text-text-tertiary">
          <Icone nome="cadeado" tamanho={13} className="mt-0.5 shrink-0" />
          Não poderá abrir arquivos do seu disco por caminho.
        </p>
      </div>
    </Dialogo>
  );
}
