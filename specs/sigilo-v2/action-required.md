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

- [~] **Registrar o servidor MCP num cliente real** (fase 7) — o **contrato do
  protocolo** está automatizado em `tests/test_mcp_protocolo.py`: o teste sobe
  `cli.py mcp` de verdade e fala JSON-RPC pelo stdio dele, com o SDK oficial —
  `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, mais
  ferramenta desconhecida e esquema de cada uma. O que resta é comportamento de
  cliente: ver um agente escolher a ferramenta certa. Isso é UX, não contrato.

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

- [x] **Instalar e validar a CLI sem abrir a GUI** — FEITO em 31/08/2026 com o
  instalador REAL (`TecJustiça Sigilo Setup 1.3.0.exe`), não com réplica. A
  cadeia inteira executada: instalador → gancho NSIS → PATH → shim → CLI.

  ```
  app aberto? False
  --- cmd novo, PATH lido do registro ---
  aplicativo: fechado
  modo: offline (o motor sobe a cada comando)
  ```

  E o gancho de desinstalação também: numa instalação de teste em pasta
  temporária, remover devolveu o PATH **byte a byte idêntico** ao original.

  **E a autossuficiência foi testada**, que é o núcleo verificável de "máquina
  limpa". Montando um ambiente sem a entrada de desenvolvimento no PATH — sem
  tocar no registro —, o CLI instalado anonimizou um documento inteiro, com o
  motor carregado do `python-embed`: CPF, RG, endereço, CEP, telefone, e-mail,
  OAB, número CNJ e nomes, todos mascarados. O shim instalado não menciona o
  repositório nem o `.venv`.

  **E o comportamento numa máquina sem o cache do BERT foi testado**, que é o
  outro núcleo verificável de "máquina limpa". Com `HF_HOME` apontando para uma
  pasta vazia e a rede desligada, o motor **cai para o spaCy sem quebrar e diz
  por quê** — o que importa, porque anonimizar com qualidade de spaCy achando
  que se tem BERT é o risco real:

  ```
  modo efetivo    : spacy        (solicitado: transformer)
  motivo_fallback : "We couldn't connect to 'https://huggingface.co'..."
  motor pronto    : True
  mascarou        : CPF [CPF_1] de [PESSOA_1].
  ```

  E chega aos dois lugares: `/health`, que a interface lê para montar o
  `avisoDeModo`, e `/v1/info`, que um cliente externo lê.

  Resíduo final: numa máquina com rede, o modelo seria **baixado** na primeira
  execução em vez de cair para o leve. Esse caminho continua sem execução — mas
  o desfecho perigoso (degradar em silêncio) está coberto.
- **CORS de uma extensão de verdade** — falta só a metade positiva. A negativa
  (página comum recusada) está automatizada e provada por mutação em
  `tests/test_cors_extensao.py`.
- **Registrar o MCP num cliente real** — falta só o comportamento do agente
  escolhendo a ferramenta. O contrato do protocolo está automatizado em
  `tests/test_mcp_protocolo.py`, contra o SDK oficial.
- **Forçar `safeStorage.isEncryptionAvailable()` a `false`** e confirmar que o
  cofre recusa gravar. A busca por CPF nos bytes já é automática em
  `electron/cofre.test.mjs`.
- **`PRESIDIO_CORPUS_OCR`** continua ausente nesta máquina: o
  `test_deteccao_ocr.py` pula em silêncio.

Roteiro de teste com comandos e resultados esperados:
https://claude.ai/code/artifact/69ea7150-bb79-46bb-8c88-3bf9779a09cc

## O lote que abortava — investigação encerrada em 31/08/2026

Relato: "seleciono cinco ou seis documentos, começa o processamento, aí de
repente ele para e volta pra tela normal pra juntar novos documentos".

**Não reproduzido como defeito do produto.** O app EMPACOTADO — sem Vite, sem
HMR, dirigido por CDP — processou seis peças de um processo real do PJe em
**32 segundos** e abriu a revisão com as seis abas e as tarjas renderizadas:

```
[00:58:03]   0% PREPARANDO ..................... PROGRESSO 0 DE 6
[00:58:27]  50% LENDO O DOCUMENTO — PAGINA 1 DE 2 (5 DE 6)
[00:58:35]  VOLTAR  003_Procuracao...  004_Documento-de-Identificacao...
```

O que foi eliminado, cada um por medição e não por leitura:

1. **Backend** — seis peças por HTTP direto: 6 processados, 0 falhas, nenhuma
   sondagem de status acima de 0,1 s.
2. **O laço do lote** — extraído para `percorrerLote` e coberto por 7 testes
   contra toda forma de morrer construível.
3. **Tratamento no `App`** — a exceção do lote não era tratada; agora é, e há
   barreira de erro no renderer.
4. **Health check virando "erro" no meio** — impossível: o laço faz `return`
   assim que o motor fica pronto.
5. **HMR do servidor de desenvolvimento** — mecanismo provado (um `page reload`
   apaga o estado e produz o sintoma), mas os eventos caíram fora das janelas de
   processamento nos logs.
6. **O app empacotado** — funciona, conforme acima.

**A causa mais provável, com o formato exato do sintoma:** `/processar`
devolvendo **404**. O backend responde 404 quando `Path(caminho).is_file()` é
falso; aí os seis arquivos falham em ~2 segundos, `processados.length === 0`, e
o `App` volta para a Mesa. Reproduzi isso por acidente — com um caminho truncado
— e o resultado na tela é indistinguível do relatado.

O que mudou: antes isso era **mudo**. Hoje aparece aviso vermelho com o motivo e
cada arquivo fica marcado "falhou" com a causa na própria linha. Se o sintoma
voltar, ele vem com a explicação junto.


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

**Se voltar a acontecer:** o texto do aviso diz o motivo. Um 404 aponta para
caminho que o backend não abre.
