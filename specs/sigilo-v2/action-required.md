# Ações Manuais: Sigilo v2

Passos que precisam de um humano — porque dependem de máquina, de arquivo fora
do git, de tempo de CPU ou de julgamento sobre a promessa do produto.

## Antes da Implementação

- [x] **Confirmar o interpretador Python x64** — `torch`, `onnxruntime` e `spacy`
  não publicam wheel `win32` nem sdist nas versões pinadas. Rodar
  `python -c "import sysconfig; print(sysconfig.get_platform())"`: tem de dizer
  `win-amd64`. Se der `win32`, o `.venv` nasce quebrado e o erro engana — o pip
  recusa a versão pinada e lista as vizinhas, o que parece pin removido do PyPI.

- [x] **Localizar o corpus de acurácia e exportar `PRESIDIO_EVAL_CORPUS`** — são
  os três `.md` do TJCE (1,6 MB) que não estão em repositório nenhum. Sem a
  variável o gate da fase 9 é **pulado**, não reprovado, e pulado passa por
  aprovado em log corrido.

- [x] **Decidir o destino do histórico existente** — o `localStorage`
  (`tecjustica-sigilo-history`, até 50 entradas de metadados) morre quando a
  biblioteca entra. O plano assume que **não** há migração: o cofre nasce vazio
  e desligado, e o usuário de v1 consente antes da primeira gravação. Confirmar
  que é isso mesmo.

- [x] **Confirmar o prazo padrão de expurgo do cofre** — o plano usa 30 dias.

## Durante a Implementação

- [x] **Regerar `python-backend/requirements-embed.txt`** (fase 7) — a partir de
  um venv que comprove funcionar, seguindo o cabeçalho do próprio arquivo. O
  `--no-deps` desliga o resolvedor e a conta chega calada: o pip instala com
  sucesso, o script diz "pronto" e o embarcado sai montado e quebrado. Já
  aconteceu — a lista mantida à mão cobria um terço do fecho transitivo e
  faltavam `thinc` e `click`.

- [x] **Montar o `python-embed` com o `mcp` dentro** (fase 7) —
  `scripts/setup-python-embed.sh`. São ~1,8 GB e não estão no git.

- [x] **Conferir o contraste dos 14 tokens de entidade nos dois temas**
  (fase 1) — 4,5:1 para texto, 3:1 para a marcação. Os três valores da paleta
  base já vêm medidos no plano; os de entidade não.

- [~] **Testar CORS a partir de uma extensão de verdade** (fase 6) — metade
  fechada. A NEGATIVA está automatizada em `tests/test_cors_extensao.py` e
  provada por mutação: página comum, `null`, `file://` e origem de extensão
  malformada são todas recusadas no preflight. É a metade que protege o
  usuário, porque `127.0.0.1` não impede a requisição de chegar — o CORS
  decide quem **lê** a resposta. Falta a positiva: confirmar que uma extensão
  instalada passa de verdade, o que só o Chromium responde.

- [ ] **Registrar o servidor MCP num cliente real** (fase 7) — Claude Code ou
  Claude Desktop — e chamar as quatro ferramentas.

## Após a Implementação

- [ ] **Rodar o gate de acurácia** — `PRESIDIO_EVAL_CORPUS=<pasta> python -m eval.run_eval`,
  de dentro de `python-backend`. **~62 min de CPU.** Baseline: 99,92% por
  ocorrência, 99,10% por valor único. Conferir `modo_nlp` = `transformer` no
  JSON e que o corpus foi lido.

- [ ] **Instalar numa máquina limpa e validar a CLI sem abrir a GUI** — abrir um
  `cmd` novo e rodar `tecjustica-sigilo status`. É o critério que prova que o
  hook NSIS funcionou.

- [x] **Conferir o cofre com editor hexadecimal** — abrir
  `%APPDATA%\TecJustiça Sigilo\cofre\*.bin` e confirmar que não há CPF legível.
  Depois forçar `safeStorage.isEncryptionAvailable()` a `false` e confirmar que
  o app **recusa gravar** em vez de gravar em claro.

- [ ] **Abrir o app e usar** — os dois bugs mais graves de agosto/2026 passaram
  por 110 testes verdes e só apareceram quando o usuário instalou e usou. Rodar
  a suíte não é a mesma coisa que abrir o app.

- [x] **Revisar o texto novo do `README.md` sobre privacidade** — é o parágrafo
  que deixa de ser verdade com o cofre. Precisa dizer o que fica no disco,
  cifrado com o quê, contra o que protege (outro usuário da máquina, leitura do
  disco fora do sistema) e contra o que **não** protege (programa malicioso
  rodando como o próprio usuário). Julgamento humano, não redação automática.

---

> Estas ações também estão listadas em contexto no `implementation-plan.md`

---

## Situação em 30/08/2026

Entregue na **v1.3.0**. O que continua aberto, e por quê:

- [x] **Gate de acurácia completo** — RODADO em 30/08/2026, 66 min, modo
  `transformer`: **3.613 / 3.615 ocorrências (99,94%)** e 330 / 332 valores
  únicos (99,40%), acima da baseline de 99,92% / 99,10%. Os dois escapes são os
  residuais conhecidos. A contagem por ocorrência saiu idêntica à da v1.2.0,
  confirmando que nenhuma das nove correções do dia tocou a detecção.

- **Instalar em máquina limpa e rodar `tecjustica-sigilo status` num `cmd` novo**
  — o único critério que prova o hook NSIS.
- **CORS de uma extensão de verdade** — falta só a metade positiva. A negativa
  (página comum recusada) está automatizada e provada por mutação em
  `tests/test_cors_extensao.py`.
- **Registrar o MCP num cliente real** — o protocolo foi exercitado por stdio.
- **Forçar `safeStorage.isEncryptionAvailable()` a `false`** e confirmar que o
  cofre recusa gravar. A busca por CPF nos bytes já é automática em
  `electron/cofre.test.mjs`.
- **`PRESIDIO_CORPUS_OCR`** continua ausente nesta máquina: o
  `test_deteccao_ocr.py` pula em silêncio.

Roteiro de teste com comandos e resultados esperados:
https://claude.ai/code/artifact/69ea7150-bb79-46bb-8c88-3bf9779a09cc

## O lote que abortava — o que já foi eliminado

Relato: "seleciono cinco ou seis documentos, começa o processamento, aí de
repente ele para e volta pra tela normal pra juntar novos documentos".

Quatro hipóteses eliminadas por medição ou leitura:

1. **Backend** — reproduzido falando HTTP direto com ele, seis peças de um
   processo real do PJe: 6 processados, 0 falhas, nenhuma sondagem de status
   acima de 0,1 s.
2. **O laço do lote** — extraído para `percorrerLote` e coberto por 7 testes
   contra todas as formas de morrer construíveis (arquivo que estoura, todos
   estourando, item malformado, `despachar` quebrando, cancelamento).
3. **Tratamento no `App`** — a exceção do lote não era tratada; agora é, e há
   barreira de erro no renderer.
4. **Health check virando "erro" no meio** — impossível: o laço faz `return`
   assim que o motor fica pronto, e só o botão "tentar de novo" o reinicia.

Uma quinta explicação **existe e está provada como mecanismo**, mas não como
causa deste caso: HMR do servidor de desenvolvimento. Um `page reload` apaga o
estado do renderer e produz exatamente este sintoma (ver
`docs/desenvolvimento-windows.md`). Nos logos desta máquina os eventos de HMR
caíram **fora** das janelas de processamento, então não dá para atribuir o
relato a eles.

**Teste decisivo:** reproduzir no app empacotado, ou num `dev` que ninguém toque
durante o teste. Se não acontecer ali, era o HMR.
