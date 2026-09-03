# Acurácia — o que foi medido

Este arquivo é o lugar de olhar quando a pergunta é "quanto ele acerta?". O
histórico longo, com a auditoria manual de 14/08/2026, continua em
[`relatorio-situacao-2026-08-14.md`](relatorio-situacao-2026-08-14.md) — mas ele
descreve um modelo que não é mais o do produto, e por isso deixou de ser a
primeira leitura.

## O que o gate mede

O harness (`python-backend/eval/run_eval.py`) constrói o gabarito **de forma
independente do detector** e reporta dois números, porque eles respondem a
perguntas diferentes:

| critério | pergunta que responde |
|---|---|
| **por ocorrência** | quantas tarjas faltaram no documento |
| **por valor único** | quantas pessoas distintas continuaram identificáveis |

O segundo é o que importa para risco. Um nome que escapa uma vez em cinquenta
aparições sai bem no primeiro critério e continua sendo um nome exposto.

**O gate mede recall, não precisão.** Ele responde "o que escapou", não "o que
sobrou". É uma escolha alinhada ao risco principal — o dano de um CPF que escapa
é maior que o de uma palavra mascarada a mais — mas é uma lacuna conhecida, e
está registrada como tal. A ferramenta que existe para o outro lado é o
comparador A/B (`eval/comparar_modelos.py`), que não é gate.

## Como rodar

De dentro de `python-backend`:

```bash
PRESIDIO_EVAL_CORPUS=<pasta com os .md> PRESIDIO_NLP_MODE=transformer \
  ../.venv/Scripts/python.exe -m eval.run_eval --json saida.json
```

Custa dezenas de minutos de CPU. Não é gate de cada commit — é gate de release.

**Sem a variável, o gate é pulado, não reprovado.** E teste pulado passa por
teste aprovado em log corrido. Confira no cabeçalho da saída que os documentos
foram lidos, e confira o `modo_nlp` dentro do JSON: se o motor caiu para spaCy, o
arquivo saiu com números de spaCy.

## Última medição — 02/09/2026

> **Sobre o código atual, não sobre um instalador publicado.** O último
> instalador (1.4.0) foi gerado antes da troca de modelo e ainda usa o
> `pierreguillou`: os números desta seção não descrevem o que quem baixa hoje
> recebe. Os da linha "v1.3.0" no histórico, sim.

Modelo `dominguesm/legal-bert-ner-base-cased-ptbr`, modo `transformer`, 14
entidades da interface, 819 páginas, 1,64 milhão de caracteres, 25,7 min.

| documento | ocorrências | valores únicos | escapes |
|---|---|---|---|
| `civel_0200161` | 747 / 747 | 87 / 87 | 0 |
| `juri_19-08` | 2.237 / 2.237 | 166 / 166 | 0 |
| `expedientes_13-08` | 630 / 631 | 78 / 79 | 1 |
| **total** | **3.614 / 3.615 — 99,97%** | **331 / 332 — 99,70%** | **1** |

Baseline a bater: 99,97% por ocorrência, 99,70% por valor único.

**O único escape** é um CPF cortado no fim da linha, com o dígito verificador na
linha seguinte. É o mesmo de sempre, e é de uma classe conhecida: entidade
interrompida no meio do texto. A janela de análise com sobreposição resolve o
caso de linha adjacente; não resolve o de número truncado.

Nenhum outro tipo vazou. CEP, CNJ, CNPJ, e-mail, OAB, RG, telefone e **nome**
fecharam 100% nos três documentos.

## Histórico

| data | versão | ocorrências | valores únicos | escapes |
|---|---|---|---|---|
| 30/08/2026 | v1.3.0 | 3.613 / 3.615 — 99,94% | 330 / 332 — 99,40% | 2 |
| 31/08/2026 | rebuild | 3.613 / 3.615 — 99,94% | 331 / 333 — 99,40% | 2 |
| 02/09/2026 | modelo novo | **3.614 / 3.615 — 99,97%** | **331 / 332 — 99,70%** | **1** |

Duas leituras valem mais que os percentuais:

**A contagem por ocorrência saiu idêntica três vezes seguidas** — 3.613/3.615 em
v1.2.0, v1.3.0 e no rebuild. Isso serve de referência para a pergunta que aparece
a cada entrega: "mexer em X afetou a acurácia?". Quando as correções do dia não
tocam a detecção, a medição confirma o que o diff sugeria.

**O escape que sumiu.** `ELIONEUDO EVARISTO DE` — nome partido na quebra de linha,
residual desde a auditoria de agosto — desapareceu com a troca de modelo somada
aos consertos em `_fundir_spans`. PERSON fechou 100% nos três documentos.

**Uma oscilação não investigada.** O denominador de valores únicos do
`juri_19-08` variou entre corridas do mesmo arquivo: 166, depois 167, depois 166
outra vez. O percentual não se move, mas contagem de gabarito que muda sozinha é
o tipo de coisa que vale conferir se alguém voltar a mexer nisso.

## A troca de modelo de 02/09/2026

`pierreguillou/ner-bert-large-cased-pt-lenerbr` →
`dominguesm/legal-bert-ner-base-cased-ptbr`, revisão
`44210927c925448df025985e0ed48081bb5ac57c`, fixada em `engine.py`.

| motivo | |
|---|---|
| **Licença** | o anterior não declara licença; o novo é CC BY 4.0, atribuído no `NOTICE`. Não se redistribui modelo sem licença explícita. |
| **Domínio** | treinado em ~1M de peças do STF. |
| **Tamanho** | 415 MB contra 2,5 GB — BERT base no lugar de large. |
| **Velocidade** | a detecção caiu de ~3,2 s para **~0,94 s por mil caracteres**. |

**A troca não consertou o que motivou o ciclo, e isso é o mais instrutivo.** O
A/B das 43 peças de um inquérito deu saída de lixo **idêntica** nos dois modelos.
A causa não era o NER: era um recognizer de padrão (`nome_antes_papel`) cuja
expressão regular casava qualquer par de palavras antes de um parêntese, porque o
Presidio aplica `re.IGNORECASE` global e a caixa alta escrita no padrão não
significava nada. "devido processo legal (§…)" virava `PERSON`. Numa decisão real,
26 de 29 valores únicos de PERSON eram frase jurídica.

Foi preciso pedir ao analyzer que nomeasse o culpado
(`return_decision_process=True`) para ver que a origem era um pattern, e não o
modelo. O recognizer foi removido.

## Precisão: a lacuna aberta

O A/B do mesmo inquérito mostrou que o modelo novo traz **76 valores únicos de
PERSON** que o antigo não tinha — cerca de metade nomes reais a mais, cerca de
metade lixo de reconhecimento de imagem ("MACONHA DOZE TROUXAS", "TABLET
MULTILASER", "USUÁRIO PADRÃO").

O ciclo para atacar isso está definido, com as variáveis escolhidas: teto de score
na semente da propagação (`_propagar_nomes`) e vocabulário de qualificadores, uma
variável por vez, medindo no mesmo A/B.

A mitigação que já existe é a tela de Revisão: score **por ocorrência** (não mais
o máximo do tipo no documento), lista ordenável pelas menos certas, e liberação de
falso positivo com efeito imediato via `POST /remascarar`, sem reprocessar.

## Corpus

Três documentos da Justiça Estadual do Ceará, em markdown, 1,64 milhão de
caracteres. **Não estão no repositório** — carregam dados pessoais reais. A
variável `PRESIDIO_EVAL_CORPUS` aponta para a pasta.

Isso é uma limitação de representatividade que deve ser dita antes de perguntarem:
a distribuição de peças de outro ramo da Justiça é diferente. O harness aceita
qualquer pasta de `.md`/`.txt`, e medir sobre um corpus novo é configurar a
variável e esperar.
