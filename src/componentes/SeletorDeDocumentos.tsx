import { useEffect, useMemo, useState } from "react";

import { Botao, Campo, Dialogo, Marcador, Selo } from "../ui";
import { POLITICAS_MASCARA } from "../types";

/**
 * Escolher, dentro da conversa, sobre quais documentos conversar.
 *
 * É a lista do cofre reduzida ao que decide a escolha: nome, processo, data e
 * como foi mascarado. Não é uma segunda tela de Documentos — quem quer apagar,
 * abrir a revisão ou varrer por ocorrências vai lá.
 *
 * O que sai daqui são **ids**, pela mesma ação que Documentos já despacha. A
 * fronteira da ponte IPC (id, nunca texto) continua intacta.
 *
 * Só "Marcador" produz pseudônimo numerado, e só ele conversa. Um documento
 * mascarado de outro jeito aparece na lista, mas com o aviso ao lado —
 * descobrir isso ao tentar abrir a conversa é tarde.
 */

interface SeletorDeDocumentosProps {
  aberto: boolean;
  documentos: EntradaDoCofre[];
  escolhidos: string[];
  aoFechar: () => void;
  aoConfirmar: (ids: string[]) => void;
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function SeletorDeDocumentos({
  aberto,
  documentos,
  escolhidos,
  aoFechar,
  aoConfirmar,
}: SeletorDeDocumentosProps) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set(escolhidos));
  const [busca, setBusca] = useState("");

  /* Abrir de novo recomeça do que está em uso, não do que ficou marcado da
     última vez e não foi confirmado. */
  useEffect(() => {
    if (aberto) {
      setMarcados(new Set(escolhidos));
      setBusca("");
    }
  }, [aberto, escolhidos]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = [...documentos].sort((a, b) => b.gravadoEm.localeCompare(a.gravadoEm));
    if (!termo) return lista;
    return lista.filter(
      (d) => d.nome.toLowerCase().includes(termo) || (d.cnj?.toLowerCase().includes(termo) ?? false)
    );
  }, [documentos, busca]);

  const alternar = (id: string) =>
    setMarcados((atuais) => {
      const novo = new Set(atuais);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Sobre quais documentos?"
      largo
      acoes={
        <>
          <Botao tipo="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            tipo="primario"
            disabled={marcados.size === 0}
            onClick={() => aoConfirmar([...marcados])}
          >
            Conversar sobre {marcados.size === 0 ? "…" : marcados.size}
          </Botao>
        </>
      }
    >
      <Campo
        rotulo="Buscar"
        placeholder="nome ou número do processo"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      <ul className="mt-3 max-h-[46vh] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
        {visiveis.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-text-tertiary">
            Nenhum documento com esse termo.
          </li>
        )}
        {visiveis.map((d) => {
          const politica = POLITICAS_MASCARA.find((p) => p.id === d.politicaMascara);
          const conversavel = politica?.id === "placeholder";
          return (
            <li key={d.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-hover">
                <Marcador
                  marcado={marcados.has(d.id)}
                  aoAlternar={() => alternar(d.id)}
                  rotulo={`Marcar ${d.nome}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{d.nome}</span>
                  <span className="block truncate font-mono text-2xs text-text-tertiary">
                    {d.cnj ?? "Avulsos"} · {dataCurta(d.gravadoEm)} ·{" "}
                    {d.totalOcorrencias.toLocaleString("pt-BR")} ocorrências
                  </span>
                </span>
                {!conversavel && (
                  <Selo tom="atencao">
                    {politica ? politica.titulo : "máscara não registrada"}
                  </Selo>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-text-tertiary">
        Os documentos escolhidos passam a compartilhar uma numeração só: a mesma pessoa recebe o
        mesmo pseudônimo em todas as peças.
      </p>
    </Dialogo>
  );
}
