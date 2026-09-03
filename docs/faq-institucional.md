# FAQ institucional — TecJustiça Sigilo

Perguntas que um órgão do Judiciário faz antes de adotar este aplicativo, com as
respostas que o projeto consegue sustentar — com medição ou com código.

**Como ler.** Cada pergunta tem uma **resposta curta**, de uma ou duas frases,
para dizer em voz alta; depois vem o detalhe técnico e, quando existe, o lugar do
repositório onde a afirmação pode ser conferida. Onde o projeto **não** tem
resposta, está escrito que não tem. Um FAQ que só sabe elogiar o próprio produto
não serve para reunião técnica: a primeira pergunta difícil o derruba inteiro.

Revisão deste documento: **03/09/2026**.

> **Leia isto antes do resto.** Este FAQ descreve o **código atual** do projeto.
> O instalador publicado em Releases é a **versão 1.4.0**, gerada antes da troca
> de modelo de 02/09/2026: ela ainda usa o modelo anterior
> (`pierreguillou/ner-bert-large-cased-pt-lenerbr`, 2,5 GB, **sem licença
> declarada**), e os números de acurácia da seção 7 foram medidos com o modelo
> novo, que ainda não saiu em instalador.
>
> Onde a diferença importa, o texto abaixo diz qual é qual. Quem for apresentar
> este material precisa saber em que pé está: ou o instalador é regerado antes
> da reunião, ou a apresentação declara que o que está publicado é a versão
> anterior.

---

## 1. O essencial, em cinco frases

1. É um aplicativo de computador que apaga dados pessoais de peças processuais —
   nomes, CPF, endereço, OAB, número de processo — e devolve o documento
   utilizável.
2. Roda **inteiro na máquina do servidor**: o documento não sobe para lugar
   nenhum para ser anonimizado, e o aplicativo não tem servidor, nem conta, nem
   telemetria.
3. O reconhecimento usa um modelo de linguagem **treinado em peças jurídicas
   brasileiras**, somado à validação de dígito verificador de CPF, CNPJ e número
   CNJ.
4. A última medição, sobre 819 páginas de processos reais, encontrou **3.614 de
   3.615** ocorrências de dado pessoal.
5. É software livre, licença MIT: sem custo de licença, de aquisição ou de nuvem,
   e sem contrato para renovar.

---

## 2. O que é, e que problema resolve

### O que exatamente o aplicativo faz?

**Resposta curta:** ele lê a peça — inclusive digitalizada —, encontra os dados
pessoais, cobre cada um com uma tarja e devolve um documento de texto que dá para
ler, citar e circular sem expor ninguém.

**Detalhe.** O caminho tem quatro etapas:

| etapa | o que acontece |
|---|---|
| **Leitura** | PDF, DOCX, XLSX, PPTX, imagem, TXT. Página com texto nativo sai direto; página digitalizada passa por reconhecimento de imagem **na própria máquina**. |
| **Detecção** | um modelo de linguagem marca nomes e locais; expressões regulares marcam CPF, CNPJ, CNJ, OAB, CEP, telefone, e-mail, RG, PIS e conta bancária; o dígito verificador confirma ou descarta. |
| **Revisão** | o servidor vê cada ocorrência com o grau de confiança, confere o valor original passando o cursor sobre a tarja, e libera o que for falso positivo. |
| **Saída** | arquivo `.docx` ou `.md`, com cabeçalho declarando que é documento anonimizado e quantas páginas passaram por reconhecimento de imagem. |

### Por que não usar uma ferramenta genérica de anonimização?

**Resposta curta:** porque texto jurídico brasileiro quebra ferramenta genérica de
três maneiras previsíveis, e as três produzem vazamento silencioso.

**Detalhe.** As três:

- **Caixa alta.** Peça de processo escreve nome em `CAIXA ALTA`. Modelo treinado
  em texto jornalístico usa a maiúscula inicial como pista e perde o nome inteiro
  quando tudo é maiúsculo.
- **Números com estrutura.** CPF, CNPJ e número CNJ têm dígito verificador. Sem
  validá-lo, o detector marca `00.000.000/0000-00` de um formulário em branco e
  deixa passar o CPF escrito sem pontuação.
- **Vocabulário institucional.** "Ministério Público do Estado do Ceará",
  "Tribunal de Justiça", "Caixa Econômica Federal" são classificados como pessoa
  ou local por praticamente todo modelo. Mascarar isso não vaza nada — mas
  inutiliza a peça, e peça inutilizada volta para o servidor refazer à mão, que é
  justamente o trabalho que a ferramenta existia para evitar.

O aplicativo trata os três casos de propósito: modelo treinado em peças
jurídicas, validação de dígito verificador (`python-backend/validators.py`) e uma
lista de termos que nunca são mascarados
(`python-backend/config/deny_list.json`), editável sem recompilar.

---

## 3. Por que rodar na máquina de cada um

### Por que não um serviço central no datacenter do tribunal?

**Resposta curta:** porque o modelo cabe num computador comum, e um serviço
central troca um problema já resolvido por três que exigem equipe permanente:
infraestrutura, disponibilidade e um ponto único por onde todos os autos passam.

**Detalhe.** Centralizar significa provisionar máquina, manter o serviço no ar,
dimensionar fila, monitorar, aplicar correção de segurança e responder por
indisponibilidade. Significa também que **todo documento sigiloso do órgão passa
por um mesmo ponto** — que vira ativo a proteger, a auditar e a explicar em caso
de incidente.

O aplicativo local não tem nada disso porque não tem serviço. Cada instalação é
independente: se uma máquina está desligada, ninguém mais é afetado; se uma
falha, a falha atinge um servidor e um documento.

A contrapartida honesta está na seção 11 — não há registro central de auditoria,
e atualizar o parque é redistribuir o instalador.

### Mas cada máquina aguenta?

**Resposta curta:** aguenta — o modelo tem cerca de 415 MB e roda em CPU comum,
sem placa de vídeo.

**Detalhe.** Medido num notebook Intel i5-12450HX, sem GPU:

| | |
|---|---|
| carga do motor | ~3,3 s, uma vez por sessão |
| detecção | ~0,94 s por mil caracteres |
| processo real completo (19 peças, 97 páginas, 53 dependendo de reconhecimento de imagem) | ~13 min |

O custo é dominado pelo **volume de texto**, não pelo número de páginas: a
correlação do tempo total com a contagem de caracteres é **0,927**; com o número
de páginas, 0,508; com o número de páginas digitalizadas, **0,192**. Por isso a
unidade de dimensionamento do projeto é segundos por mil caracteres — ela
sobrevive à mudança da mistura de peças, e a contagem por página não sobrevive.

### E se quiséssemos, ainda assim, centralizar?

**Resposta curta:** dá, e o aplicativo já tem quase tudo para isso — mas não é o
caminho por onde o projeto recomenda começar.

**Detalhe.** O motor já é um servidor HTTP local com API documentada
(`docs/api-local.md`), há um servidor MCP para agentes, e os travamentos internos
do reconhecimento de imagem são de processo, não de máquina — o que significa que
N processos multiplicam a vazão de forma quase linear. O que **não** existe é o
distribuidor de trabalho entre esses processos: o registro de tarefas é um
dicionário em memória, com teto de 20, que morre junto com o processo.

Ou seja: a arquitetura não impede a centralização, mas ela é trabalho a fazer,
não recurso a ligar.

---

## 4. "Como assim, um modelo de IA dentro do computador?"

Esta é a pergunta que costuma travar a conversa, e vale respondê-la com calma.

### O modelo fica onde?

**Resposta curta:** num arquivo, no disco, como qualquer outro programa — cerca de
415 MB, dentro da pasta do usuário.

**Detalhe.** Um modelo de linguagem é um arquivo de números (os "pesos"). Usá-lo é
abrir esse arquivo e fazer contas com ele. Não há nada de remoto nisso: é o mesmo
tipo de operação que um corretor ortográfico faz, só que muito maior.

O modelo aqui é o `dominguesm/legal-bert-ner-base-cased-ptbr`, publicado no
Hugging Face sob licença **CC BY 4.0**. O aplicativo o busca **uma vez**, na
primeira execução, numa **revisão fixada por identificador criptográfico**
(`engine.py`, constante `REVISAO_MODELO_BERT`). Depois disso, funciona sem rede.

Fixar a revisão não é detalhe: sem isso, o autor poderia atualizar o repositório
do modelo e a máquina passaria a carregar outro conjunto de pesos — outra
acurácia — sem que ninguém percebesse.

> **No instalador 1.4.0 publicado isto ainda não vale.** Aquela versão traz o
> modelo anterior — 2,5 GB, sem licença declarada, sem revisão fixada. A troca
> está no código e entra no próximo instalador. Quem instalar hoje e olhar o
> cache do Hugging Face vai encontrar o modelo antigo, e é melhor ouvir isso de
> quem apresenta do que descobrir sozinho.

### Este modelo "aprende" com os nossos processos?

**Resposta curta:** não. Ele é somente lido, nunca escrito — o aplicativo não tem
código de treinamento.

**Detalhe.** Há uma diferença que costuma se perder na conversa:

| | |
|---|---|
| **Treinar** | ajustar os pesos do modelo a partir de dados. Exige dataset rotulado, GPU e horas de processamento. **O aplicativo não faz isso.** |
| **Inferir** | usar os pesos como estão para classificar um texto. É o que acontece aqui, e não deixa vestígio no modelo. |

O arquivo do modelo é aberto em modo de leitura e continua byte a byte idêntico
depois de processar mil autos. Nada do documento entra nele — não há como o
conteúdo de um processo "vazar" para dentro do modelo ou para outro usuário por
essa via.

### E se o nosso órgão bloqueia o Hugging Face?

**Resposta curta:** dá para levar o modelo junto; e se ele faltar, o aplicativo
**avisa e degrada explicitamente** — nunca finge que está tudo bem.

**Detalhe.** Três caminhos, do mais simples ao mais controlado:

1. Baixar numa máquina com acesso e copiar a pasta de cache
   (`%USERPROFILE%\.cache\huggingface`) para as demais.
2. Apontar a variável `HF_HOME` para uma pasta de rede já semeada.
3. Não fazer nada: sem o modelo, o motor **cai para o modo leve** (spaCy
   `pt_core_news_lg`, que vem dentro do instalador) e publica o motivo da queda na
   tela e na rota de saúde.

O item 3 merece ênfase, porque é decisão de projeto e não acaso: anonimizar com
qualidade inferior **acreditando** estar no modo bom é o risco de verdade.
Verificado em 31/08/2026, com o cache vazio e a rede desligada: a degradação é
anunciada, com o motivo, e o aviso chega à interface.

---

## 5. Segurança e proteção de dados

### O documento sai da máquina em algum momento?

**Resposta curta:** na anonimização, nunca. Existe **um** recurso opcional que
envia texto já anonimizado para fora — vem desligado, e está descrito na seção 10.

**Detalhe.** No caminho de anonimização não há chamada de rede: nem telemetria,
nem verificação de licença, nem atualização automática. Isso é verificável no
código — uma busca por `autoUpdater` ou `electron-updater` no repositório não
devolve nada — e observável com um monitor de rede aberto durante o
processamento.

Até as fontes tipográficas da interface são empacotadas junto, justamente para
não haver requisição a servidor de fontes.

### O que fica gravado no disco?

**Resposta curta:** por padrão, só o arquivo anonimizado que o próprio servidor
escolhe salvar. O resto existe apenas na memória, enquanto o programa está aberto.

**Detalhe.** Há um recurso chamado **Cofre**, que guarda o texto original e as
ocorrências para que uma revisão possa ser reaberta depois de fechar o programa. É
preciso ser exato sobre o que ele é, porque é a parte mais sensível do produto:

> O Cofre **é** um índice pesquisável de dados pessoais. Foi construído com esse
> custo à vista, e é por isso que ele vem desligado.

As defesas, todas em `electron/cofre.ts` e cobertas por teste:

| | |
|---|---|
| **Desligado por padrão** | nada é gravado até um consentimento explícito, uma vez, num aviso que diz exatamente o que passa a ficar no disco |
| **Cifrado em repouso** | DPAPI do Windows, atrelada à conta do usuário — conteúdo **e** índice, porque nome de arquivo de processo carrega nome de pessoa |
| **Falha fechada** | onde a cifragem não estiver disponível, o Cofre **recusa gravar**; nunca grava em claro |
| **Expurgo automático** | 30 dias por padrão, configurável, com apagamento item a item |

**O limite, que precisa ser dito antes de perguntarem:** a DPAPI protege contra
outro usuário da mesma máquina e contra a leitura do disco fora do sistema — se a
máquina for levada ou o disco montado em outro lugar. Ela **não** protege contra
um programa malicioso rodando com a conta do próprio usuário: para o sistema
operacional, esse programa é o usuário, e recebe os dados decifrados se pedir.
Nenhuma cifragem atrelada à conta protege contra isso.

### O aplicativo abre uma porta de rede. Isso não é um risco?

**Resposta curta:** abre, em `127.0.0.1`, e toda rota exige um token de sessão que
não é publicado em lugar nenhum.

**Detalhe.** A porta existe para que a linha de comando, agentes e uma futura
extensão de navegador usem o motor sem que o documento saia da máquina. O desenho
parte de um fato desconfortável:

> `127.0.0.1` não protege nada. Qualquer página aberta no navegador alcança portas
> locais.

Daí as camadas:

- **Token de sessão em toda rota**, exceto quatro públicas por necessidade
  (saúde, identificação e as duas de pareamento, que são a única forma de obter um
  token). Isso é testado por **varredura** da lista de rotas publicadas, não por
  amostragem: o teste percorre todas e exige recusa — tratando "não encontrado" e
  "corpo inválido" como reprovação, porque as duas significam que a requisição
  atravessou a autenticação.
- **CORS restritivo**: nenhuma origem `http://` de página comum é aceita, nem em
  desenvolvimento. Os testes negativos — página comum, `null`, `file://` — são a
  metade que protege o usuário.
- **Pareamento com aprovação humana**: cliente externo é autorizado
  individualmente, com um código conferido nas duas pontas, revogável na tela
  Conexões.
- **Abrir arquivo por caminho nunca é concedido a cliente externo.** Ele envia o
  conteúdo; quem lê arquivo do disco continua sendo só a janela do aplicativo.
  Rota nova nasce fora do alcance de cliente externo por omissão.

### O instalador é assinado digitalmente?

**Resposta curta:** não é — e isso significa que o Windows exibirá o aviso do
SmartScreen na primeira execução.

**Detalhe.** Assinatura de código exige certificado emitido para pessoa jurídica,
com custo anual. O projeto é pessoal e não tem um. Consequências práticas:

- A tela "O Windows protegeu o seu computador" aparece; é preciso clicar em "Mais
  informações → Executar assim mesmo".
- Distribuição por ferramenta de gestão de parque pode exigir liberação explícita.
- **Se o órgão tiver certificado próprio**, assinar o instalador é alteração de
  poucas linhas na configuração de empacotamento — e é o caminho recomendado para
  distribuição em escala.

Compensações que existem hoje: o código-fonte é público, o instalador é gerado a
partir dele, e um manifesto versionado fixa a versão e o SHA-256 de cada modelo de
reconhecimento de imagem — a integridade é auditável mesmo sem assinatura.

---

## 6. Conformidade

### Como isso se encaixa na LGPD?

**Resposta curta:** a ferramenta produz o artefato que a LGPD trata de forma mais
branda — o dado anonimizado — e o produz sem transferir o dado original a terceiro
nenhum.

**Detalhe.** Dois pontos que costumam ser cobrados:

- **Não há transferência.** O tratamento acontece no equipamento do próprio órgão,
  sob a conta do próprio servidor. Não há operador terceiro, contrato de
  tratamento nem transferência internacional no caminho da anonimização.
- **Minimização por construção.** O padrão do produto é não guardar nada; o
  armazenamento é escolha explícita do usuário, cifrada e com prazo.

### E a Resolução CNJ nº 615/2025?

**Resposta curta:** a Resolução veda o compartilhamento de dados do Judiciário com
soluções de IA **salvo se anonimizados ou pseudonimizados na origem** — e "na
origem" é literalmente o que este aplicativo faz.

**Detalhe.** A [Resolução CNJ nº 615, de 11 de março de 2025](https://atos.cnj.jus.br/atos/detalhar/6001),
em vigor desde 14/07/2025, estabelece princípios, diretrizes e requisitos para o
desenvolvimento, o uso e a governança de soluções de IA no Poder Judiciário. Entre
eles:

- veda o compartilhamento de dados detidos pelo Judiciário com soluções de IA
  externas, **exceto quando anonimizados ou pseudonimizados na origem**, observada
  a LGPD;
- define anonimização na origem como o processo técnico realizado **antes** de os
  dados serem transmitidos;
- veda o uso de dados sigilosos ou protegidos por segredo de justiça para
  treinamento de modelos, salvo anonimização prévia na origem;
- exige anonimização desde a concepção, com privacidade por padrão.

> **Antes da reunião:** confira a numeração dos artigos no texto oficial. O portal
> do CNJ recusa leitura automatizada, então as citações acima estão em substância,
> sem número de artigo — e afirmar um número errado numa sala da Justiça Federal
> custa mais caro do que não citá-lo.

O encaixe é direto: o aplicativo **é** a etapa "na origem". Ele transforma a peça
sigilosa no artefato que a Resolução admite ver processado adiante — e a seção 10
descreve o único recurso do produto que consome esse artefato.

---

## 7. Acurácia: o que foi medido, e o que não foi

Esta seção existe porque é aqui que um laboratório de IA vai apertar.

### Quanto ele acerta?

**Resposta curta:** na última medição, **3.614 de 3.615** ocorrências de dado
pessoal — 99,97% — sobre 819 páginas de três processos reais.

**Detalhe.** Medição de 02/09/2026 **sobre o código atual** — não sobre o
instalador 1.4.0 publicado, que ainda traz o modelo anterior. Modo BERT jurídico,
14 tipos de entidade, 1,64 milhão de caracteres, 25,7 minutos de processamento:

| documento | ocorrências | valores únicos | escapes |
|---|---|---|---|
| processo cível | 747 / 747 | 87 / 87 | 0 |
| audiência de júri | 2.237 / 2.237 | 166 / 166 | 0 |
| expedientes | 630 / 631 | 78 / 79 | 1 |
| **total** | **3.614 / 3.615 — 99,97%** | **331 / 332 — 99,70%** | **1** |

São dois critérios porque medem coisas diferentes: **por ocorrência** responde
"quantas tarjas faltaram"; **por valor único** responde "quantas pessoas distintas
continuaram identificáveis" — e é este o que importa para risco, já que um nome
que escapa uma vez em cinquenta continua sendo um nome exposto.

O único escape é um CPF partido no fim da linha, com o dígito verificador na linha
seguinte. Nenhum outro tipo vazou: CEP, CNJ, CNPJ, e-mail, OAB, RG, telefone e
nome fecharam 100% nos três documentos.

O gabarito é construído de forma **independente do detector** — não é o sistema
conferindo a si mesmo.

### Onde está o ponto fraco dessa medição?

**Resposta curta:** ela mede o que escapa, não o que sobra. A precisão — quanto o
sistema marca a mais — **não é medida sistematicamente**, e é a lacuna conhecida
do projeto.

**Detalhe.** É a resposta que deve vir antes da pergunta, porque a pergunta virá:

- **Recall é o que o gate mede.** Faz sentido para o risco principal: o dano de um
  CPF que escapa é maior que o de uma palavra mascarada a mais.
- **Precisão não tem gate.** Existe um comparador A/B
  (`python-backend/eval/comparar_modelos.py`), e ele já produziu um achado
  desconfortável: num inquérito com digitalização ruim e texto em caixa alta,
  cerca de metade dos nomes novos que o modelo atual encontrou eram lixo de
  reconhecimento — nome de produto, fragmento de frase. Está registrado como ciclo
  de trabalho aberto, com as duas variáveis a mexer já escolhidas.
- **Mitigação hoje:** a tela de Revisão. Cada ocorrência aparece com o seu grau de
  confiança, a lista é ordenável pelas menos certas, e o falso positivo é liberado
  num clique — com efeito imediato no documento aberto, sem reprocessar.

### O corpus é representativo do que nós temos?

**Resposta curta:** não necessariamente — são três documentos da Justiça Estadual
do Ceará. A resposta certa é rodar a medição no corpus de vocês.

**Detalhe.** O harness de avaliação faz parte do repositório e aponta para uma
pasta indicada por variável de ambiente. Rodar sobre peças previdenciárias ou de
execução fiscal da Justiça Federal é trabalho de configurar uma variável e esperar
o processamento — e é a proposta mais concreta que se pode levar para a reunião:

```
PRESIDIO_EVAL_CORPUS=<pasta com as peças> python -m eval.run_eval
```

O relatório sai com recall por ocorrência, proteção por valor único e o inventário
do que escapou, item a item.

Uma armadilha do próprio harness, que vale conhecer: **sem a variável, o gate é
pulado, não reprovado** — e teste pulado passa por teste aprovado em log corrido.
O cabeçalho da saída diz quantos documentos foram lidos; é o que se confere antes
de acreditar num "passou".

### Por que este modelo e não outro?

**Resposta curta:** porque foi escolhido por comparação medida, não por reputação —
e a troca mais recente teve motivo de governança além do técnico.

**Detalhe.** O modelo anterior era um BERT grande treinado em jurisprudência, com
bom desempenho, mas **sem licença declarada** — e não se redistribui modelo sem
licença explícita. O atual é treinado sobre cerca de um milhão de peças do STF,
declara CC BY 4.0, e ocupa 415 MB contra 2,5 GB do anterior.

E é preciso ser exato sobre o alcance dessa frase: **o instalador 1.4.0 que está
publicado ainda distribui o modelo sem licença.** Foi por ter percebido isso que
a troca aconteceu; a correção existe no código e ainda não existe em instalador.
Dizer "não se redistribui modelo sem licença" sobre um pacote publicado que faz
exatamente isso seria o tipo de afirmação que uma auditoria desmonta em um
minuto.

A comparação foi feita lado a lado sobre o mesmo corpus, um processo por modelo, e
produziu um achado que vale contar porque desmente a intuição: os falsos positivos
que motivaram o ciclo **saíram idênticos nos dois modelos**. A causa não era o
modelo — era uma expressão regular que casava qualquer par de palavras antes de um
parêntese, transformando "devido processo legal (§…)" em nome de pessoa. Numa
decisão real, 26 dos 29 nomes detectados eram frase jurídica.

A regra que ficou: nome é trabalho do modelo de linguagem e de regra ancorada em
rótulo textual explícito. A expressão regular foi removida.

---

## 8. Desempenho: quanto custa processar

### Quanto tempo leva um processo inteiro?

**Resposta curta:** cerca de 13 minutos para um processo de 97 páginas — na
prática, o servidor manda processar e vai fazer outra coisa.

**Detalhe.** O custo por tipo de página sai **invertido** em relação à intuição, e
vale saber porque a pergunta "e as digitalizadas, não são as lentas?" sempre
aparece:

| | medido |
|---|---|
| página com texto nativo | 14,0 s |
| página digitalizada | 3,9 s |

A explicação fica simples quando se olha o conteúdo: um documento de identidade
digitalizado tem vinte palavras; um contrato nativo tem vinte e quatro mil
caracteres. O reconhecimento de imagem cobra pela imagem; a detecção cobra pelo
texto — e a detecção leva mais da metade do tempo.

### Quanta memória?

**Resposta curta:** 16 GB é o que foi medido e o que se recomenda. Abaixo disso
não há medição — e a degradação por falta de memória não é suave, é abrupta, o
que torna a extrapolação arriscada.

**Detalhe.** É a variável que mais afeta o desempenho, e não sutilmente. Três
medições do mesmo dia:

| ensaio | efeito |
|---|---|
| mesma extração, com e sem o modelo residente na memória | 1,48x |
| mesma detecção, mesmo texto, corridas diferentes | 3,9x |
| instalação, máquina saturada contra máquina livre | **15x** (110 min contra 7,3 min) |

O caso da instalação é o mais didático porque a magnitude não deixa margem: o
mesmo instalador, na mesma máquina, escrevendo a 2,1 MB/s com a memória no fim e a
31,5 MB/s depois que os processos pesados saíram.

A consequência para o dimensionamento de um parque: **na faixa em que a memória
acaba, o desempenho não degrada devagar — ele desaba.** É o que torna "16 GB dá
conta" uma frase perigosa se as máquinas já rodam outras coisas pesadas, e é
também por que não se deve afirmar nada sobre 8 GB sem medir: nessa região, o
comportamento não se estima por regra de três.

### Precisa de placa de vídeo?

**Resposta curta:** não. Tudo roda em CPU, de propósito — é o que permite instalar
em máquina de mesa comum.

**Detalhe.** Uma observação contraintuitiva, útil para quem for dimensionar: usar
**todos** os núcleos disponíveis é a pior configuração possível para o
reconhecimento de imagem. Medido, num processador com núcleos de desempenho e de
eficiência, 11 threads chegam a ser cinco vezes mais lentas que 4 — o motor
sincroniza numa barreira a cada camada, e o grupo inteiro anda na velocidade da
fatia mais lenta, que cai num núcleo de eficiência. O padrão do produto é 4
threads por causa disso.

---

## 9. Instalação e distribuição em escala

### Como se instala?

**Resposta curta:** um instalador do Windows, com Avançar e Avançar. Não pede
privilégio de administrador e instala na pasta do usuário.

**Detalhe.**

| | |
|---|---|
| Sistema | Windows 10 ou 11, **64 bits** |
| Instalador | ~880 MB |
| Ocupação após instalar | ~2,3 GB |
| Modelo de linguagem | ~415 MB, baixado uma vez na primeira execução |
| Tempo de instalação | 20 a 30 min numa máquina comum — o volume é o Python embarcado |
| Privilégio | de usuário; instala no perfil, sem administrador |

O instalador já traz o Python, as bibliotecas de aprendizado de máquina e os
modelos de reconhecimento de imagem. Não há pré-requisito a instalar antes, nem
dependência de runtime no sistema.

### Dá para distribuir para muitas máquinas de uma vez?

**Resposta curta:** dá — a instalação é por usuário, sem administrador, e o
instalador aceita os parâmetros de linha de comando do NSIS.

**Detalhe.** É um instalador NSIS gerado por electron-builder, com as
características que interessam a uma implantação:

- **Diretório alternativo** com `/D=<caminho>`, verificado neste projeto.
- **Modo silencioso** com `/S` — é o padrão do NSIS; convém validar no piloto,
  porque não foi exercitado neste instalador especificamente.
- **Sem elevação**: instala no perfil do usuário.
- **Sem auto-atualização**: o aplicativo nunca busca versão nova sozinho. É uma
  escolha — o parque não muda sem que alguém decida — e implica que atualizar é
  redistribuir.

Duas ressalvas a considerar no planejamento:

1. **O instalador não é assinado** (seção 5). Para parque gerenciado, assinar com
   o certificado do órgão é o caminho.
2. **Instalar por cima remove a instalação anterior**, e com ela a lista de termos
   liberados que o usuário acumulou. Está registrado como pendência, com a direção
   já decidida — gravar essa lista na pasta de dados do usuário. Enquanto não é
   feito, vale exportá-la antes de atualizar.

### Linux e macOS?

**Resposta curta:** o código é multiplataforma e roda em modo de desenvolvimento;
o instalador pronto só existe para Windows, porque é onde estão as máquinas do
Judiciário.

---

## 10. O recurso que manda dado para fora

Esta seção existe porque omiti-la seria o pior erro possível numa reunião técnica:
alguém abre o repositório e descobre sozinho.

### O que é "Conversar com os autos"?

**Resposta curta:** é um recurso opcional que permite fazer perguntas sobre as
peças a um modelo de linguagem na nuvem — enviando **somente o texto já
anonimizado**, com a chave do próprio usuário, e desligado por padrão.

**Detalhe.** É o primeiro recurso do produto que manda dado para fora, e isso muda
a natureza do pior defeito possível: até aqui, um erro entregava um documento mal
anonimizado ao próprio usuário; agora poderia mandar dado sigiloso para a
internet. As defesas são proporcionais a isso:

| defesa | o que faz |
|---|---|
| **Desligado por padrão** | sem uma chave de API que o usuário mesmo cola, o aplicativo não fala com a internet |
| **Só texto anonimizado** | a entrada é a saída do anonimizador, nunca o documento original |
| **A pergunta também é anonimizada** | é o vetor esquecido: o documento foi tratado com cuidado, mas a pergunta é digitada com os dados reais à frente ("o CPF tal aparece?") — ela passa pelo detector antes de sair |
| **Numeração única entre peças** | juntar doze peças anonimizadas separadamente daria dois `[PESSOA_1]` diferentes, e o modelo responderia com confiança trocando as pessoas |
| **Trava de saída** | o corpo da requisição é varrido, já serializado, contra a lista de valores proibidos; achando um, não envia |
| **Retenção zero** | só provedores com política de retenção zero, consultada na API do roteador — não numa lista fixa que envelhece e vira alarme falso |
| **Sem compressão de contexto** | o recurso que corta o meio do texto quando ele não cabe está desativado de propósito: prompt grande demais deve **falhar**, não responder com confiança sobre metade do processo |
| **Nada persiste** | as conversas vivem só na memória e morrem com o aplicativo |

Há ainda um detalhe que costuma impressionar quem entende do assunto: o texto que
vai para a nuvem fica **mais** anonimizado que o arquivo salvo em disco. O motivo é
que o anonimizador substitui por posição — se um nome foi reconhecido em dois
lugares e perdido num terceiro, o terceiro fica em claro no arquivo salvo. O
caminho da conversa fecha esse resíduo aplicando a decisão que o motor já tomou a
**todas** as aparições daquele valor, em todas as peças. Não é uma segunda
detecção — seria inútil, acharia o mesmo que a primeira achou; é a aplicação
completa da primeira.

### Podemos simplesmente não usar isso?

**Resposta curta:** sim, e é o estado de fábrica. Sem chave configurada, o
aplicativo não tem para onde enviar nada.

Se a política do órgão for proibir, o recurso pode ser removido do empacotamento —
o código é aberto e a compilação é local.

---

## 11. Limitações conhecidas

Lista honesta, porque cada item aqui é uma pergunta que alguém vai fazer.

| limitação | situação |
|---|---|
| **Não faz tarja em PDF** | a saída é sempre texto (`.docx`/`.md`), nunca o formato de entrada. Queimar os pixels no PDF e sanear metadados é trabalho previsto e não feito. A biblioteca pronta que existe para isso não serve: roda sobre o motor de reconhecimento de imagem que este projeto descartou por medição. |
| **Precisão não tem gate** | ver seção 7. É a lacuna de medição do projeto. |
| **Não é multiusuário** | uma instalação, um usuário, uma máquina. Não há perfis, permissões nem fila compartilhada. |
| **Sem registro central de auditoria** | não há como um gestor ver, de um ponto só, o que foi anonimizado no órgão. É a contrapartida direta de não haver serviço central. |
| **Atualização é redistribuição** | não há auto-atualização, por escolha; e instalar por cima descarta a lista de termos liberados do usuário. |
| **Instalador não assinado** | SmartScreen na primeira execução. |
| **Entidade partida no fim da linha** | o único escape da última medição: um CPF cortado antes do dígito verificador, com o resto na linha seguinte. A janela de análise com sobreposição resolve o caso de linha adjacente, não o de número truncado. |
| **Falsos positivos em digitalização ruim** | em inquérito com caixa alta e reconhecimento sofrível, o modelo produz nomes que não existem. Ciclo de trabalho aberto, com as variáveis já escolhidas. |
| **Somente português** | o modelo e as regras são de documento brasileiro. |

---

## 12. Licença, custo, manutenção

### Quanto custa?

**Resposta curta:** nada. Licença MIT, sem custo de aquisição, de assinatura ou de
nuvem — e o código fica com o órgão, para adaptar como quiser.

**Detalhe.** O único custo variável possível é o do recurso opcional de conversa,
que usa a chave de um provedor externo e é pago por uso pelo próprio usuário.
Desligado, custo zero.

### Quem mantém isso?

**Resposta curta:** hoje, uma pessoa — e é por isso que o projeto investe em teste
automatizado e medição, que é a forma de manutenção que sobrevive a qualquer troca
de mantenedor.

**Detalhe.** É a pergunta certa a fazer sobre software no serviço público, e a
resposta não deve ser defensiva. O que existe hoje:

| | |
|---|---|
| **322 testes automatizados** | 181 no motor de detecção, 90 no processo principal, 51 na interface |
| **Gate de acurácia de release** | 819 páginas de processos reais, com número publicado a cada versão |
| **Documentação de decisão** | o repositório registra o **porquê** de cada escolha não óbvia, inclusive dos erros — há armadilhas descritas com o defeito, o sintoma e a correção |
| **Código público** | MIT, no GitHub, com histórico completo |

E o que **não** existe: equipe, contrato de suporte, SLA. Se o órgão adotar em
escala, essa é a conversa a ter — e a licença MIT já permite que a manutenção
passe a ser feita internamente, sem depender de ninguém.

### Que licenças de terceiros estão envolvidas?

| componente | licença |
|---|---|
| TecJustiça Sigilo | MIT |
| Presidio (Data Privacy Stack) | MIT |
| PP-OCRv6 (PaddlePaddle) | Apache 2.0 |
| liteparse | Apache 2.0 |
| modelo de NER (`dominguesm`) | **CC BY 4.0** — exige atribuição, cumprida no arquivo `NOTICE`, que viaja dentro do instalador |

---

## 13. Como este projeto conversa com o que já existe

**Resposta curta:** há pelo menos dois outros anonimizadores no Judiciário
brasileiro, e a relação é complementar — cada um resolveu bem uma parte diferente.

**Detalhe.**

- **Anonimizador do TJPA**, lançado em março de 2026 pela Setic do tribunal e já
  adotado por outro tribunal. É web e **faz tarja verdadeira em PDF** — o que este
  projeto não faz.
- **DocAnon (LABI/JFCE)**: arquitetura de serviço em contêiner, multiusuário,
  persistência zero, tarja verdadeira em PDF.

Onde este projeto tem algo a acrescentar:

| aqui | lá |
|---|---|
| reconhecimento de imagem **medido**, com o motor escolhido por comparação | tarja verdadeira em PDF |
| escolha de modelo com gate de acurácia publicado | arquitetura de serviço multiusuário |
| execução local, sem infraestrutura a manter | operação centralizada e auditável |

O dado que vale levar: em matrícula de cartório datilografada, o motor de
reconhecimento de imagem mais difundido recuperou **17,7%** das palavras, contra
nunca menos de 42,6% do motor adotado aqui. Num anonimizador isso não é perda de
qualidade — é vazamento silencioso, porque **o que o reconhecimento não
transcreveu, nenhum detector encontra**, e o documento sai mutilado parecendo
completo.

Convergência técnica entre os projetos — mesma biblioteca de base, mesma lista de
entidades da LGPD, mesmo formato de marcador — é característica do campo, não
indício de cópia: há poucos caminhos para tratar dado pessoal em português
jurídico.

---

## 14. As perguntas difíceis

### "Como sabemos que ele não está deixando passar coisa?"

Não se sabe por confiança — se sabe por medição, e a medição é reproduzível no
corpus de vocês. O número atual é 99,97% por ocorrência sobre 819 páginas, com o
inventário do que escapou. E a tela de Revisão existe exatamente porque anonimizar
sem poder conferir é fé, não garantia.

### "E se o modelo errar num caso que importa?"

Erra. A pergunta certa não é se erra, e sim o que o sistema faz a respeito: cada
ocorrência chega ao revisor com o seu grau de confiança, a lista é ordenável pelas
menos certas, e o documento não sai sem passar por essa tela.

### "Isso não é só um invólucro em volta do Presidio?"

O Presidio é a base, e isso está declarado. O que este projeto acrescenta é o que
faz diferença em peça brasileira: modelo jurídico em português com revisão fixada,
validação de dígito verificador, lista de termos institucionais, reconhecimento de
imagem escolhido por medição, tela de revisão e um gate de acurácia sobre
processos reais. O Presidio puro, sem isso, produz o resultado descrito na seção 2.

### "Por que confiar num projeto de uma pessoa só?"

Não é questão de confiar na pessoa: o código é aberto, os testes rodam na máquina
de vocês, e a medição de acurácia pode ser refeita sobre o corpus de vocês antes de
qualquer decisão. É mais verificável que a maioria dos softwares contratados.

### "Vocês testaram em documentos da Justiça Federal?"

Não. O corpus de medição é da Justiça Estadual do Ceará, e a distribuição de peças
previdenciárias ou de execução fiscal é outra. É a primeira coisa a fazer, e o
harness já está pronto para isso.

### "Qual é o maior risco de adotar isso?"

Dois, ditos sem rodeio:

1. **O Cofre.** Se ligado sem critério, ele é um índice pesquisável de dados
   pessoais na máquina do servidor. Vem desligado, é cifrado e expurga sozinho —
   mas a decisão de ligá-lo merece política, não apenas um clique.
2. **A confiança excessiva.** O maior risco de qualquer anonimizador é o usuário
   parar de conferir. O produto é desenhado contra isso — a revisão é o caminho
   normal, não uma opção —, mas nenhum desenho substitui a instrução ao usuário.

---

## Onde conferir cada afirmação

| assunto | arquivo |
|---|---|
| decisões de projeto, com o porquê | `CLAUDE.md` |
| medições de acurácia | `docs/acuracia.md` |
| contrato da API local | `docs/api-local.md` |
| desenho da interface | `docs/design-system.md` |
| atribuições de terceiros | `NOTICE` |
| modelo e revisão fixada | `python-backend/engine.py` |
| validação de dígito verificador | `python-backend/validators.py` |
| termos nunca mascarados | `python-backend/config/deny_list.json` |
| harness de acurácia | `python-backend/eval/run_eval.py` |
