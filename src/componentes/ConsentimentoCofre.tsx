import { Botao, Dialogo } from "../ui";

/**
 * Consentimento da primeira gravação no cofre.
 *
 * Este diálogo é uma condição da spec, não um enfeite de conformidade. Guardar
 * o texto original e a lista de ocorrências cria no perfil do usuário
 * exatamente o artefato que o aplicativo existe para evitar — um índice
 * pesquisável de CPFs, nomes e endereços. Quem opera precisa decidir isso de
 * olhos abertos, uma vez, sabendo o que passa a existir no disco.
 *
 * Por isso ele é `obrigatorio`: não fecha por Esc nem por clique fora. Um
 * diálogo que some sozinho vira um "sim" por acidente, e aqui o silêncio não
 * pode valer como consentimento.
 *
 * O texto diz as três coisas que importam, sem rodeio: **o que** fica gravado,
 * **contra o que** protege, e **contra o que não protege**. Essa última linha é
 * a que costuma faltar em avisos assim, e é a única que muda a decisão de quem
 * entende do assunto.
 */

interface ConsentimentoCofreProps {
  aberto: boolean;
  /** Nome do documento que disparou a pergunta. */
  nomeDoDocumento: string;
  aoAceitar: () => void;
  aoRecusar: () => void;
}

export function ConsentimentoCofre({
  aberto,
  nomeDoDocumento,
  aoAceitar,
  aoRecusar,
}: ConsentimentoCofreProps) {
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoRecusar}
      obrigatorio
      titulo="Guardar no cofre?"
      acoes={
        <>
          <Botao tipo="secundario" onClick={aoRecusar}>
            Não guardar
          </Botao>
          <Botao tipo="primario" icone="cadeado" onClick={aoAceitar}>
            Guardar cifrado
          </Botao>
        </>
      }
    >
      <p>
        Para reabrir a revisão de{" "}
        <strong className="text-text">{nomeDoDocumento}</strong> depois de fechar
        o aplicativo, é preciso guardar em disco:
      </p>

      <ul className="mt-3 space-y-1.5 pl-4 text-text-secondary">
        <li className="list-disc">
          o <strong className="text-text">texto original</strong> do documento,
          com os dados pessoais como estão nos autos;
        </li>
        <li className="list-disc">
          a <strong className="text-text">lista de ocorrências</strong> —
          cada CPF, nome e endereço encontrado, com sua posição;
        </li>
        <li className="list-disc">o texto já anonimizado e o nome do arquivo.</li>
      </ul>

      <p className="mt-3">
        Tudo isso fica <strong className="text-text">cifrado</strong> com a
        proteção de dados do Windows, atrelada à sua conta de usuário.
      </p>

      <div className="mt-3 border-l-2 border-warning pl-3">
        <p className="text-text-secondary">
          <strong className="text-text">O que isso protege:</strong> outra pessoa
          usando esta máquina com outra conta, e a leitura do disco fora do
          sistema — se o computador for levado ou o HD montado em outro lugar.
        </p>
        <p className="mt-1.5 text-text-secondary">
          <strong className="text-text">O que não protege:</strong> um programa
          malicioso rodando com a sua própria conta, agora. Para o sistema, ele é
          você — e recebe os dados decifrados se pedir.
        </p>
      </div>

      <p className="mt-3 text-text-tertiary">
        Recusando, o documento continua podendo ser salvo onde você escolher —
        só não fica guardado para reabrir. Dá para mudar de ideia nos Ajustes, e
        o cofre apaga sozinho o que passa do prazo de guarda.
      </p>
    </Dialogo>
  );
}
