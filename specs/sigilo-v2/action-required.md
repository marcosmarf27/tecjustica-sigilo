# Ações Manuais: Sigilo v2

Passos que precisam de um humano — porque dependem de máquina, de arquivo fora
do git, de tempo de CPU ou de julgamento sobre a promessa do produto.

## Antes da Implementação

- [ ] **Confirmar o interpretador Python x64** — `torch`, `onnxruntime` e `spacy`
  não publicam wheel `win32` nem sdist nas versões pinadas. Rodar
  `python -c "import sysconfig; print(sysconfig.get_platform())"`: tem de dizer
  `win-amd64`. Se der `win32`, o `.venv` nasce quebrado e o erro engana — o pip
  recusa a versão pinada e lista as vizinhas, o que parece pin removido do PyPI.

- [ ] **Localizar o corpus de acurácia e exportar `PRESIDIO_EVAL_CORPUS`** — são
  os três `.md` do TJCE (1,6 MB) que não estão em repositório nenhum. Sem a
  variável o gate da fase 9 é **pulado**, não reprovado, e pulado passa por
  aprovado em log corrido.

- [ ] **Decidir o destino do histórico existente** — o `localStorage`
  (`tecjustica-sigilo-history`, até 50 entradas de metadados) morre quando a
  biblioteca entra. O plano assume que **não** há migração: o cofre nasce vazio
  e desligado, e o usuário de v1 consente antes da primeira gravação. Confirmar
  que é isso mesmo.

- [ ] **Confirmar o prazo padrão de expurgo do cofre** — o plano usa 30 dias.

## Durante a Implementação

- [ ] **Regerar `python-backend/requirements-embed.txt`** (fase 7) — a partir de
  um venv que comprove funcionar, seguindo o cabeçalho do próprio arquivo. O
  `--no-deps` desliga o resolvedor e a conta chega calada: o pip instala com
  sucesso, o script diz "pronto" e o embarcado sai montado e quebrado. Já
  aconteceu — a lista mantida à mão cobria um terço do fecho transitivo e
  faltavam `thinc` e `click`.

- [ ] **Montar o `python-embed` com o `mcp` dentro** (fase 7) —
  `scripts/setup-python-embed.sh`. São ~1,8 GB e não estão no git.

- [ ] **Conferir o contraste dos 14 tokens de entidade nos dois temas**
  (fase 1) — 4,5:1 para texto, 3:1 para a marcação. Os três valores da paleta
  base já vêm medidos no plano; os de entidade não.

- [ ] **Testar CORS a partir de uma extensão de verdade** (fase 6) — só o
  renderer dentro do Chromium impõe a regra. Os 110 testes falam HTTP direto e
  **não** cobrem isso; foi exatamente esse buraco que travou a tela em
  "Carregando motor de anonimização" com o backend no ar.

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

- [ ] **Conferir o cofre com editor hexadecimal** — abrir
  `%APPDATA%\TecJustiça Sigilo\cofre\*.bin` e confirmar que não há CPF legível.
  Depois forçar `safeStorage.isEncryptionAvailable()` a `false` e confirmar que
  o app **recusa gravar** em vez de gravar em claro.

- [ ] **Abrir o app e usar** — os dois bugs mais graves de agosto/2026 passaram
  por 110 testes verdes e só apareceram quando o usuário instalou e usou. Rodar
  a suíte não é a mesma coisa que abrir o app.

- [ ] **Revisar o texto novo do `README.md` sobre privacidade** — é o parágrafo
  que deixa de ser verdade com o cofre. Precisa dizer o que fica no disco,
  cifrado com o quê, contra o que protege (outro usuário da máquina, leitura do
  disco fora do sistema) e contra o que **não** protege (programa malicioso
  rodando como o próprio usuário). Julgamento humano, não redação automática.

---

> Estas ações também estão listadas em contexto no `implementation-plan.md`
