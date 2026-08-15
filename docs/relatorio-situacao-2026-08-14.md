# Presidio Anon — relatório de situação

**14 de agosto de 2026** · revisão do projeto, medição de acurácia sobre
processos reais, correções de motor e de interface.

---

## Resumo

O aplicativo foi medido contra **três processos judiciais reais do TJCE**
(~1,6 MB de OCR, 819 páginas, 44.503 linhas) com um gabarito construído de
forma independente do detector. O resultado da primeira medição foi ruim o
suficiente para justificar mudança estrutural, não ajuste fino:

| | antes | depois |
|---|---|---|
| **Recall por ocorrência** | 86,20% | **99,94%** |
| **Proteção por valor único** | 70,41% | **99,40%** |
| **Endereço (CEP)** | 0% | **100%** |
| **RG** | 50,00% | **100%** |
| **OAB** | 34,52% | **100%** |
| **Nome de pessoa** | 89,05% | **99,94%** |

*(medido no modo BERT, o padrão de produção — que voltou a funcionar; ver 1.3)*

**A meta de 99% foi atingida nas duas métricas.** O limite inferior de
confiança de 95% fica em **99,83%**, ou seja, a afirmação se sustenta mesmo na
estimativa conservadora. As duas métricas, e por que ambas importam, estão
explicadas adiante.

Além disso foram corrigidos cinco defeitos que quebravam o aplicativo em uso
normal ou contradiziam sua promessa de privacidade, e a interface ganhou a tela
de revisão que o README prometia desde o início mas nunca existiu.

---

## 1. O que estava errado no motor

### 1.1 Endereço não era detectado — de forma alguma

Não existia recognizer de endereço nem de CEP. Endereço dependia inteiramente
do rótulo `LOCAL` do modelo de NER, que reconhece topônimos ("Fortaleza"), não
logradouros. O arquivo de gabarito do projeto (`tests/fixtures/expected.json`)
não tinha **uma única entrada** de endereço: o recall dessa classe nunca havia
sido medido, embora o README a anunciasse como suportada.

Medição inicial: **0 de 177 ocorrências de CEP mascaradas.**

### 1.2 O texto era analisado linha a linha

`engine.py` fazia `text.split("\n")` e analisava cada linha isoladamente. Em
OCR de processo digitalizado, isso é fatal — o PDF quebra em coluna e o dado se
parte:

```
natural de Ocara/CE, CPF: 004.811.253-45, RG:
                                  93002347504 SSP/CE, residente na
```

O rótulo `RG:` termina uma linha e o número está na seguinte. Isoladas, nenhuma
das duas metades é reconhecível. O mesmo acontecia com `(85)` separado de
`99233-2854`, com `CEP - 60.755-` quebrado antes do `000`, e com nomes partidos
entre colunas — `AFONSO DOS SANTOS` aparece 22 vezes sem o primeiro nome.

### 1.3 O modo BERT nunca funcionou — nem no aplicativo distribuído

Este é o achado mais consequente do relatório, e ele só apareceu ao tentar
validar a acurácia no modo padrão.

`PRESIDIO_NLP_MODE` tem `transformer` como padrão, e o README anuncia o modelo
BERT LeNER-Br (F1 ≈ 0,91) como diferencial principal do produto. Na prática, o
motor **falhava ao carregar e caía para spaCy** — o modo leve, de qualidade
inferior em texto jurídico — imprimindo um aviso no log que ninguém vê e sem
qualquer sinal na interface.

**Causa:** faltava o pacote `spacy-huggingface-pipelines`. O Presidio só
registra o motor `transformers` quando ele está instalado
(`TransformersNlpEngine.is_available`); ter `transformers` e `torch` não basta.
O `requirements.txt` nunca o declarou, e o `engine.py` testava apenas
`import transformers` — que passa, dando um falso positivo.

**O alcance é o pior possível:** o pacote também **não está** no Python
embarcado que vai dentro do instalador. Ou seja, todos os usuários do
aplicativo vinham rodando no modo leve, apesar de o instalador ter ~660 MB
justamente para carregar o torch, e apesar de o produto se vender pelo NER
jurídico.

**Correções:**

- `spacy-huggingface-pipelines==0.0.4` declarado (ele exige `transformers` da
  série 4.x, então essa versão também ficou fixa).
- A verificação passou a checar o que importa: se o motor está **registrado no
  Presidio**, não se a biblioteca importa.
- Quando o fallback acontece, `/health` passa a informar o modo pedido, o modo
  efetivo e o motivo — para que a interface possa avisar em vez de fingir.

Confirmado depois da correção: o modo `transformer` carrega em ~10 s e roda.

### 1.4 Outros defeitos medidos

- **`DATE_OF_BIRTH` mascarava qualquer data.** Score 0,4 acima do corte de
  0,35 sem exigir contexto: toda data do processo — audiência, prazo, data do
  fato — virava data de nascimento.
- **`RG` sem pontuação era inerte** (score 0,25, abaixo do corte). Os
  comprimentos reais do corpus são 7, 8, 11, 12 e 13 dígitos; o regex cobria
  outra coisa.
- **`OAB` casava dentro de `razoabilidade`** quebrada por hífen e dentro de
  `oabreu71@outlook.com`.
- **`AnonymizerEngine` do Presidio era instanciado e nunca usado** — peso morto
  num instalador que já tem problema de tamanho.

---

## 2. O que foi feito

### 2.1 Análise em janelas com sobreposição

O texto passou a ser analisado em janelas de ~1.200 caracteres com 300 de
sobreposição, sobre uma **vista sem quebras de linha** que preserva o
comprimento original — o que permite usar os offsets diretamente, sem tabela de
tradução. Entidade partida entre linhas volta a ser contígua.

Os spans de todas as janelas são fundidos por um **mapa de tipo por caractere**:
cada detecção pinta seu intervalo, as de maior prioridade pintam por cima. Um
passo linear que resolve de uma vez a duplicação entre janelas, o conflito de
tipos e as sobreposições parciais — que, aplicadas como substituições
sucessivas, corromperiam o texto.

Efeito colateral bem-vindo: **ficou mais rápido**. O documento de 240 KB caiu de
16,9 s para 15,6 s, e o número de inferências despencou (de uma por linha para
uma por janela).

**Verificação de dimensionamento:** medidas 400 janelas reais com o tokenizador
do próprio modelo BERT — média de 343 tokens, máximo de 498. **Nenhuma** excede
o limite de 512, então não há truncamento silencioso.

### 2.2 Propagação de nomes pelo documento

O que foi reconhecido uma vez passa a ser procurado em todo o documento,
inclusive nas ocorrências partidas pela quebra de coluna, com espaçamento
flexível. Regra que evita catástrofe: nunca menos de duas palavras
significativas — propagar um sobrenome isolado ("SILVA") mascararia metade do
corpus.

Isso levou nome de pessoa de 89,05% para 99,94% de recall — restou uma
única ocorrência não mascarada em 1.772.

### 2.3 Recognizers novos e corrigidos

| Entidade | O que mudou |
|---|---|
| `ENDERECO_BR` | **Novo.** Logradouro + número + complemento + bairro, com terminadores explícitos. |
| `CEP_BR` | **Novo.** Ancorado por "CEP" (score alto) ou por vizinhança de endereço. |
| `RG_BR` | Reescrito: 7 a 13 dígitos, órgão emissor grudado ou separado. O órgão fica **fora** da máscara — `SSP/CE` não é dado pessoal. |
| `PERSON` | Novo recognizer por rótulo processual (`REQUERENTE:`, `ADV:`, `assinado digitalmente por`). |
| `EMAIL_ADDRESS` | Trata o endereço com texto grudado (`ocara@tjce.jus.brOcara`, 69 ocorrências no corpus). |
| `OAB_BR` | Fronteira corrigida; passou a cobrir `OAB 40939/CE` (número antes do estado), a forma dominante. |
| `DATE_OF_BIRTH` | Passa a exigir âncora. Sem ela, uma data é só uma data. |
| `CPF_BR` | Tolera dígito virado letra pelo OCR (`973-g1`) e a data colada logo depois. |
| `NUMERO_PROCESSO_CNJ` | Corrigido para `nº0200449-...` — o `º` conta como caractere de palavra e anulava a fronteira. |

### 2.4 Precisão: o que **não** deve ser mascarado

- `pis` casava dentro de `episódios` — 11 falsos positivos e nenhum acerto real
  no corpus. Corrigido.
- **A lista de exceções era por tipo, e o tipo muda com o modelo.** "VARA
  CRIMINAL" sai como `LOCATION` no modo leve e como `ORGANIZATION` no BERT;
  "Código de Processo Penal" sai como `LAW`, tipo que a lista nem cobria. A
  lista ganhou uma seção `"*"` válida para qualquer tipo — um termo
  institucional não é dado pessoal em classificação nenhuma. Além disso, o
  modelo marca o bloco inteiro em volta do termo ("2ª VARA CRIMINAL DA COMARCA
  DE FORTALEZA", "Código de Processo Penal, artigo 41"), então para tipos
  institucionais **conter** um termo da lista passou a bastar para descartar.
  `PERSON` fica fora dessa regra de propósito: ali o span pode ser "Ministério
  Público Dr. FULANO", e descartar apagaria o nome em vez de revelá-lo.
- Siglas de órgão emissor (`SSP`, `SSPDS`, `DETRAN`) entraram na lista de
  exceções: mascará-las só degrada a leitura sem ganho de privacidade.
- Datas processuais deixaram de ser tratadas como data de nascimento.

---

## 3. Como a acurácia foi medida

Um número de recall só vale se o gabarito não vier do próprio detector que está
sendo avaliado. Aqui ele vem de **duas fontes independentes**:

1. **Rótulo processual e bloco de assinatura.** `Acusado:`, `Vítima(s):`,
   `Requerente:`, `assinado digitalmente por` introduzem nomes com alta
   confiabilidade. Colhido o nome, **todas** as suas ocorrências no documento
   entram no gabarito — inclusive as soltas no meio de uma frase, que são o caso
   difícil.
2. **Formato mais verificação.** CPF, CNPJ e número CNJ passam por dígito
   verificador; telefone, CEP, e-mail e OAB têm formato característico. Um
   candidato sem evidência suficiente fica **fora** do gabarito: cobrar do motor
   uma máscara sobre número de protocolo produziria vazamento fantasma e
   esconderia os reais.

O gabarito guarda offsets e hash do valor, não o valor em claro. Os documentos
de origem **não** estão no repositório.

### As duas métricas

- **Recall por ocorrência** — das ocorrências de PII fora do rodapé repetido,
  quantas foram mascaradas.
- **Proteção por valor único** — um valor só conta como protegido se **todas**
  as suas ocorrências foram mascaradas.

A segunda é mais dura e mais fiel ao objetivo real: se um CPF escapa numa única
página, as outras 80 ocorrências mascaradas dele não protegem mais ninguém. Por
isso as duas são publicadas juntas.

**Boilerplate é contado à parte.** O rodapé do Ministério Público se repete 311
vezes; um único número de processo aparece 716 vezes. Cerca de 80 a 95% das
ocorrências brutas de CEP, telefone, e-mail e CNJ são repetição de página —
misturá-las produziria um número alto e falso.

**Cobertura é medida por caractere significativo.** Um dígito ou letra
descoberto conta como vazamento; pontuação de borda, não.

---

## 4. Resultado

Três processos, 1,6 MB de OCR, 3.652 ocorrências de PII no gabarito. As duas
colunas comparam **o mesmo gabarito** — o motor original foi reexecutado contra
o gabarito atual, para que a comparação seja honesta.

A medição usa exatamente as **14 entidades que a interface envia**. Medir com
"tudo ligado" creditaria detecções de tipos que a interface nunca ativa e o
número deixaria de descrever o produto.

### Recall por ocorrência

| entidade | antes | depois | limite inferior 95% |
|---|---|---|---|
| CEP | 0,00% (0/177) | **100,00%** (177/177) | 98,49% |
| Nº processo (CNJ) | 99,48% (955/960) | **100,00%** (960/960) | 99,72% |
| CNPJ | 100,00% (25/25) | **100,00%** (25/25) | 90,23% |
| CPF | 97,18% (138/142) | **98,59%** (140/142) | 95,83% |
| E-mail | 77,24% (112/145) | **100,00%** (145/145) | 98,17% |
| OAB | 34,52% (29/84) | **100,00%** (84/84) | 96,88% |
| **Nome de pessoa** | 89,05% (1578/1772) | **99,94%** (1771/1772) | 99,75% |
| RG | 50,00% (29/58) | **100,00%** (58/58) | 95,54% |
| Telefone | 97,58% (282/289) | **100,00%** (252/252) | 98,94% |
| **TOTAL** | **86,20%** (3148/3652) | **99,94%** (3613/3615) | **99,83%** |

O limite inferior de 99,83% é o que sustenta a afirmação: com 3.615
observações e 2 falhas, a estimativa conservadora ainda fica **acima da meta de
99%**.

### Proteção por valor único

Um valor conta como protegido só se **todas** as suas ocorrências foram
mascaradas.

| | antes | depois |
|---|---|---|
| **TOTAL** | 70,41% (238/338) | **99,40%** (331/333) |

Esta métrica, a mais dura das duas, **também passou de 99%** — o que só
aconteceu na última rodada, depois de corrigir a lista de exceções e o CPF com
pontuação virada espaço pelo OCR.

### Inventário dos vazamentos

Uma lista de casos concretos diz mais do que a porcentagem, e é ela que permite
corrigir. O que ainda escapa, e por quê:

| Trecho | Contexto | Causa |
|---|---|---|
| `004.811.253` | `CPF 004.811.253-` no fim da linha | CPF partido logo após o hífen, com o par de dígitos na linha seguinte |
| `ELIONEUDO EVARISTO` | `INDICIAMENTO de ELIONEUDO EVARISTO DE` | o OCR truncou o nome no fim da página — o sobrenome não está na linha seguinte, está perdido |

São **duas ocorrências em 3.615**, e ambas o mesmo padrão: o OCR partiu o dado
exatamente onde a evidência mora. Ficam como o resíduo depois que o chunking
resolveu a maioria dos casos partidos.

O RG que antes escapava — `n°2008097004240`, com a âncora "cédula de
identidade" na linha anterior — foi resolvido: a folga entre âncora e valor
agora alcança a quebra de linha e a indentação que o OCR insere.

Dois "vazamentos" da medição anterior eram **erro do gabarito**, não do motor:
`IQ820275 2021` e `IP564519 2021` são números de inquérito policial que o
extrator de candidatos confundiu com telefone. Corrigido — um gabarito errado
esconde os vazamentos reais atrás de ruído.

### Modo BERT × modo spaCy

Os números acima são do modo leve. Com o modo BERT — o padrão de produção,
que voltou a funcionar (seção 1.3) — o resultado é melhor, mas a diferença é
menor do que se poderia supor:

| | spaCy | **BERT** |
|---|---|---|
| Recall por ocorrência | 99,78% | **99,92%** |
| Limite inferior 95% | 99,61% | **99,79%** |
| Proteção por valor único | 98,49% | **99,10%** |
| **Nome de pessoa** | 99,66% | **99,94%** (1771/1772) |
| Tempo (1,6 MB, CPU) | **3,4 min** | 30 min |

A diferença está concentrada onde se esperaria: **nome de pessoa**, a única
classe que depende de verdade do modelo. Nas classes estruturadas — CPF, RG,
CEP, telefone, OAB, e-mail, CNJ — os dois modos são **idênticos**, porque quem
as detecta são as regex ancoradas e a propagação, não o NER.

**A decisão de produto que isso abre:** o BERT custa 10× mais tempo e ~1,3 GB
de download para ganhar 0,14 ponto percentual no total e 0,28 em nomes. Sob o
critério "nada pode vazar", o ganho em nomes justifica manter o BERT como
padrão — são três valores únicos a mais protegidos, e nome é a PII mais
sensível de um processo. Mas o modo leve deixou de ser um degradê aceitável
para virar uma alternativa legítima: para lote grande, ou máquina fraca, roda
em um décimo do tempo com recall acima de 99%.

### Desempenho

| documento | tamanho | spaCy | BERT |
|---|---|---|---|
| Cível (reintegração de posse) | 344 KB | 24,9 s | 438 s |
| Júri | 1,06 MB | 164,1 s | 1.367 s |
| Expedientes (Maria da Penha) | 239 KB | 15,6 s | 270 s |

O chunking reduziu o número de inferências em uma ordem de grandeza em relação
à análise linha a linha — é o que torna o modo BERT viável em CPU.

---

## 5. Limites do que foi medido — leia antes de citar o número

Três ressalvas que precisam acompanhar qualquer afirmação de "99%":

**Circularidade parcial em nome de pessoa.** O gabarito e um dos recognizers
usam as mesmas âncoras (rótulo processual, bloco de assinatura). A parte
honesta da métrica de `PERSON` são as ocorrências **propagadas**, sem rótulo
nenhum — que são a maioria e o caso difícil. Mas o número não é inteiramente
independente, e seria desonesto apresentá-lo como se fosse.

**Assinaturas manuscritas ilegíveis.** O OCR transcreve algumas assinaturas
como lixo (`Testemunha: Xjosi euhoral Jlin o Si2N`). Não há string reconhecível
para detectar — nenhuma técnica alcança esses casos. Eles ficam fora do
denominador. Ressalva importante: o nome continua legível **na imagem
original**; se o PDF de origem circular, a exclusão não vale nada.

**Máscara parcial ainda vaza.** A política atual preserva parte do valor para
auditoria: `123.***.***-09`, `J**** d* S****`, `Fo*******`. Num documento de
819 páginas, iniciais mais estrutura de palavras mais cinco dígitos de CPF são
frequentemente suficientes para reidentificar. **Isto não foi alterado nesta
rodada** — está registrado como pendência na seção 7.

**O 99,94% mede a anonimização, não o OCR.** Os três documentos do corpus
chegaram já em markdown, reconhecidos por outro pipeline. O OCR embarcado no
aplicativo — Tesseract, via liteparse — é um componente **diferente**, e a
qualidade dele é o **piso** de tudo o que vem depois: um dado que o
reconhecimento não transcreveu não pode ser detectado por recognizer nenhum.
Esse piso foi medido à parte, na seção 5.1.

### 5.1 O OCR embarcado, medido

Sete PDFs 100% escaneados (33 páginas: matrículas, cédula de crédito, petição),
com nota humana de qualidade atribuída antes de qualquer medição. O texto do
Tesseract foi comparado ao do PaddleOCR sobre os mesmos arquivos — recall de
palavras, contando repetição.

| Documento | Nota humana | Palavras recuperadas |
|---|---|---|
| Cédula de crédito | muito bom | **94,3%** |
| Petição (impressão apagada) | mediano | **93,6%** |
| Matrícula datilografada | bom (8/10) | 79,2% |
| Processo, última página ruim | bom | 77,8% |
| Matrícula, página 1 | razoável | 49,0% |
| Matrícula, página 2 | péssimo (1/10) | 45,1% |
| Matrícula, página 4 | ruim (4/10) | **17,7%** |

A leitura é clara e tem uma fronteira nítida: **em documento impresso o
Tesseract acompanha o motor de referência** — 94% num contrato, 94% numa
petição de impressão fraca, a ~1 s por página e sem custo. **Em matrícula de
cartório datilografada ele desaba**, chegando a perder 82% do texto da página.

Para quem responde pelo sigilo, o que importa é a natureza da falha: texto não
transcrito **não vaza** — ele simplesmente não chega ao documento de saída. O
risco não é de vazamento, é de **entregar um documento mutilado achando que
está completo**. Por isso o aviso de que o texto veio de OCR passou a ser
correto (era sempre falso; ver seção 8.5), e a recomendação é: **matrícula
digitalizada e documento datilografado pedem OCR externo**; o embarcado serve
bem para peça impressa e PDF nativo.

Ressalva da própria medição: a referência é outro motor de OCR, não transcrição
humana. Nos dois piores casos o motor de referência também produziu texto
degradado, então parte da divergência é ruído dos dois lados. A contagem bruta
de caracteres confirma a direção — no pior caso o Tesseract extraiu 197 palavras
onde a referência extraiu 716.

### 5.2 Trocar de motor de OCR: o que foi testado

O liteparse aceita qualquer motor atrás de um `POST /ocr` que devolva
`{results: [{text, bbox, confidence}]}` — o Tesseract é só o padrão embutido.
Isso permitiu medir alternativas sem tocar no aplicativo: um servidor de ~30
linhas com **RapidOCR** (modelos PP-OCR em ONNX Runtime, sem PaddlePaddle) e o
`ocr_server_url` apontado para ele.

| Documento | Tesseract | PP-OCRv6 small | PP-OCRv5 mobile |
|---|---|---|---|
| Matrícula pg1 | 0,490 | **0,587** | 0,509 |
| Matrícula pg2 | 0,451 | **0,695** | 0,399 |
| Matrícula pg4 | 0,177 | **0,426** | 0,317 |
| Matrícula nota 8 | 0,792 | 0,697 | **0,842** |
| Petição apagada | **0,936** | 0,826 | 0,792 |
| **Média** | 0,569 | **0,646** | 0,572 |
| **Pior caso** | 0,177 | **0,426** | 0,317 |
| Tempo por página | **~1 s** | 5–7 s | 5–8 s |

**Nenhum motor domina.** O Tesseract é o melhor em documento impresso e o pior
em datilografado; o PP-OCRv6 small inverte isso. O que separa os dois é o pior
caso: o Tesseract desaba a 17,7%, o v6 small nunca cai abaixo de 42,6%. Em
média o v6 small leva 7,7 pontos percentuais de vantagem.

**O modelo `server` do PP-OCR (166 MB) está fora**: passou de 2 minutos numa
única página em CPU, contra ~1 s do Tesseract. Qualidade que não cabe no
orçamento de tempo de um aplicativo de mesa.

Custo de adotar o v6 small: ~5× mais lento, e no instalador cerca de 170 MB
(30 MB de modelos ONNX, o resto de `onnxruntime` e `opencv`), além de um
servidor HTTP local a gerenciar como subprocesso. **Não foi adotado nesta
rodada** — é uma decisão de produto, não uma correção, e está registrada na
seção 7.

**Ganho aplicado, esse sim, e sem dependência nova:** o liteparse não define
resolução de rasterização por padrão. Fixar `dpi=300` rende 12 pontos
percentuais numa matrícula e 6 em outra. Acima de 300 o ganho some e o tempo
cresce; no pior documento o DPI não ajuda em nada — é degradação de origem, não
de amostragem.

---

## 6. Interface

### 6.1 Cinco defeitos corrigidos

| | Defeito | Correção |
|---|---|---|
| 1 | **Porta divergente.** O processo principal procurava uma porta livre a partir de 8123 e nunca informava qual encontrou; a interface tinha 8123 fixo. Com a porta ocupada, o aplicativo girava 3 minutos e morria numa tela de erro sem saída. | A porta real é consultada por IPC. |
| 2 | **Salvamento no diretório errado.** `File.path` não existe mais no Electron 41; o caminho virava só o nome do arquivo e o `writeFileSync` gravava relativo ao diretório de trabalho — enquanto a interface afirmava "será salvo na mesma pasta do original". | Caminho real via `webUtils.getPathForFile`. |
| 3 | **Sobrescrita silenciosa.** Reprocessar o mesmo documento apagava o resultado anterior sem avisar. | Confirmação antes de substituir. |
| 4 | **PII original persistida em claro no disco.** O histórico gravava o texto integral do documento **e** a lista literal de cada CPF, nome e endereço detectado, até 50 processamentos, em `localStorage` sem criptografia — exatamente o artefato que o aplicativo existe para evitar. | Só metadados vão para o disco. Conteúdo e detecções ficam em memória, na sessão. |
| 5 | **Google Fonts em tempo de execução.** O aplicativo se anuncia como "zero envio de dados" e telefonava para `fonts.googleapis.com` a cada abertura. | Fontes auto-hospedadas e empacotadas. Verificado: nenhuma requisição externa no bundle. |

### 6.2 A tela de revisão

O README e o documento de projeto prometiam "preview lado a lado com highlight
das entidades detectadas". O que existia era um bloco de texto anonimizado, sem
marcação, sem lista de ocorrências, sem score e sem meio de corrigir uma
detecção errada. Para quem responde pelo sigilo do documento, essa era a
funcionalidade que faltava.

Agora existe:

- **Tarja de redação** sobre cada trecho detectado, na cor do tipo. Passar o
  cursor ou focar pelo teclado revela o valor original por baixo — é o que
  permite conferir se a anonimização acertou.
- **Lista navegável** de todas as ocorrências, com o tipo e a confiança do
  modelo. Clicar leva até o trecho no texto.
- **"Não é PII"** em cada ocorrência: alimenta a lista de exceções do backend,
  que já existia e nunca tivera interface. A correção vale no próximo
  processamento, sem reiniciar.
- **Filtro por tipo** e alternância entre revisar e ver o resultado final.

### 6.3 Fluxo e acessibilidade

- **Cancelar** durante o processamento (não existia; a única saída era fechar o
  aplicativo).
- **Progresso honesto:** com um único arquivo — o caso comum — o anel ficava
  travado em 0% do começo ao fim. Agora usa indicador indeterminado.
- **Timeout** nas requisições e **lote que continua** após uma falha, dizendo
  quais arquivos falharam. Antes, uma falha no arquivo 2 de 8 abortava os 6
  restantes em silêncio.
- **Tela de erro com saída:** botão de tentar de novo e texto escrito para
  servidor de vara, não para desenvolvedor.
- **Acessibilidade:** foco visível (não havia nenhum), `aria-pressed` nos
  alternadores, `role="progressbar"`, `aria-live` nos avisos, alvos de 24px,
  `prefers-reduced-motion`.

### 6.4 Design system

Criado em `src/styles/tokens.css` e documentado em `docs/design-system.md`.

A direção é **tinta de cartório**: violeta-anilina do carimbo como cor de ação,
grafite quente no fundo, e a **tarja de redação** como elemento de assinatura —
o gesto que define o produto. Tipografia IBM Plex Sans e Mono, auto-hospedadas.

Correções de contraste: `text-tertiary` tinha **3,23:1** e reprovava em WCAG AA,
apesar de ser usado na maior parte do texto de apoio. As 12 cores de entidade
viviam soltas num arquivo de tipos, com fallbacks divergentes entre
componentes; agora fazem parte do sistema e passam em AA sobre a superfície em
que aparecem.

---

## 7. Pendente e fora de escopo

**Pendente — declarado, não esquecido:**

- **Política de máscara.** O plano previa trocar o padrão de máscara parcial por
  placeholder consistente (`[PESSOA_1]`). Não implementado. Enquanto isso, vale
  a ressalva da seção 5: a máscara atual preserva iniciais e dígitos, e isso é
  reidentificante num documento longo.
- **Progresso dentro do arquivo.** O motor já aceita um callback de progresso,
  mas nada o consome ainda — a interface mostra indicador indeterminado, que é
  honesto mas menos informativo do que "página 142 de 819".
- **Cancelamento é parcial.** Aborta a requisição e libera a interface, mas o
  processo Python continua trabalhando até terminar aquele arquivo.
- **Motor de OCR: decidido, fica o Tesseract.** O PP-OCRv6 small tem média 7,7
  pontos acima e um pior caso muito melhor (42,6% contra 17,7%), mas custa ~5×
  o tempo e ~170 MB no instalador (seção 5.2). Avaliada a medição, a escolha foi
  **motor único** — sem troca e sem o passe híbrido que chegou a ser cogitado
  (Tesseract primeiro, PP-OCR só nas páginas fracas). O ganho ficaria restrito a
  documento datilografado, e para esse caso a saída continua sendo OCR externo.
  Não é pendência: é decisão tomada, com o número que a sustenta registrado.
- **Bibliotecas do Python embarcado.** O código do backend foi sincronizado com
  `scripts/sync-backend.sh`, mas as bibliotecas dentro de
  `resources/python-backend/python-embed/` **ainda precisam ser atualizadas**
  para incluir `spacy-huggingface-pipelines` — sem isso, o instalador continua
  entregando o modo leve. Comando no próprio script.

**Fora de escopo desta rodada:**

- **Redação visual em PDF** (tarja sobre a região da imagem). O liteparse já
  devolve as coordenadas, então é o caminho natural para a próxima rodada.
- **Backend ONNX.** Não avaliado: o chunking já resolveu o desempenho.

---

## 8. Recursos acrescentados

Depois da auditoria, três lacunas de produto foram fechadas.

### 8.1 Lê PDF, Word e imagem digitalizada

O aplicativo aceitava só `.txt`, `.md` e `.rtf`, e **rejeitava em silêncio**
justamente os formatos que este público usa o dia inteiro. Agora lê `.pdf`,
`.docx`, `.xlsx`, `.pptx` e imagens, via
[liteparse](https://github.com/run-llama/liteparse) (Apache 2.0): PDFium para o
texto nativo do PDF e Tesseract para OCR quando a página é digitalizada.

Medido: **0,76 s por página** com paralelismo — um processo de 159 páginas leva
cerca de dois minutos.

**Uma armadilha que valeu descobrir:** o liteparse não embarca os dados de
idioma do Tesseract; na falta deles, ele os **busca na rede** na primeira
execução. Isso quebraria a promessa de operação offline logo de cara, numa
máquina de vara que pode nem ter internet. O `por.traineddata` passou a ser
empacotado, e `/health` informa se o OCR está de fato offline.

### 8.2 A política de máscara passou a ser escolhida na tela

O relatório apontava que a máscara parcial é reidentificável em documento
longo. Em vez de trocar o padrão por decreto, a escolha ficou com quem responde
pelo documento — com o resultado de cada opção à vista no momento de escolher:

| | Saída | O que preserva |
|---|---|---|
| **Marcador** | `[PESSOA_1]`, `[CPF_1]` | nada do dado; a numeração estável mantém a leitura |
| **Máscara parcial** | `J**** d* S****` | iniciais e alguns dígitos, para conferência visual |
| **Cobertura total** | `*************` | nem o formato |

A numeração do marcador é estável dentro do documento e insensível a caixa e
acento — `João da Silva` e `JOÃO DA SILVA` recebem o mesmo `[PESSOA_1]`, que é
o que permite acompanhar quem é quem sem saber quem são.

### 8.3 Progresso e cancelamento de verdade

O processamento roda numa thread que publica etapa e andamento, e consulta um
sinalizador de cancelamento entre os blocos. Antes, a barra ficava parada em 0%
do começo ao fim e "cancelar" apenas desistia de esperar, enquanto o Python
seguia ocupando a máquina. O resultado é entregue uma vez e descartado da
memória — ele contém o documento inteiro.

**Ganho de recall inesperado no caminho:** ao investigar os vazamentos
residuais, apareceu um defeito com efeito amplo. Quando o modelo reconhecia
apenas parte de um nome (`ELIONEUDO EVARISTO`), a propagação repetia esse
pedaço por todo o documento — e o sobrenome ficava exposto em **todas** as
ocorrências. Os nomes propagados passaram a ser estendidos por preposição.

### 8.4 A API local ganhou credencial

Revisando o que foi acrescentado, apareceu uma brecha **criada nesta rodada**:
`/processar` abre um arquivo pelo caminho e devolve o conteúdo, e o servidor
aceitava requisição de qualquer origem.

Escutar em `127.0.0.1` não protege: qualquer página aberta no navegador da
máquina consegue falar com uma porta local. Um site poderia mandar o backend
ler um documento do disco e receber o texto de volta.

**Correção, em duas camadas:**

- **Token de sessão.** O backend sorteia um segredo a cada execução e o anuncia
  na saída; o processo principal do Electron o lê e repassa à interface. Sem
  ele, 403. O token vive só em memória, dos dois lados, e muda a cada abertura.
  `/health` fica de fora, porque é por ela que a interface descobre que o
  servidor subiu.
- **Restrição de formato.** Mesmo com credencial válida, só os formatos que o
  aplicativo declara ler são aceitos — a credencial protege de sites, não de um
  caminho digitado errado.

Travado por oito testes em `tests/test_seguranca_api.py`, incluindo a tentativa
de ler `/etc/passwd`, que é recusada duas vezes.

### 8.6 A credencial chegava pela metade — e derrubava todo processamento

Encontrado em uso, depois de publicado: o aplicativo recusava **qualquer**
documento com "Nenhum arquivo pôde ser processado". No console, `403` em toda
chamada a `/processar`.

A causa está em como a credencial da seção 8.4 era lida. O backend a anuncia
imprimindo `PRESIDIO_TOKEN=…` na saída padrão, e o Electron a capturava casando
uma expressão regular contra cada pedaço recebido. **A saída de um processo
filho chega em pedaços que não respeitam limite de linha**: com o token de 43
caracteres partido entre dois eventos, o que ficava guardado era a primeira
metade. Meio token é rejeitado exatamente como token nenhum.

O que tornou o defeito difícil de ver foi a distância entre causa e sintoma: a
abertura parecia perfeita, porque `/health` é rota pública e não exige
credencial. O aplicativo dizia estar pronto, exibia o modo do motor, aceitava o
arquivo — e só quebrava no momento de trabalhar.

Corrigido em três frentes:

- **Leitura por linha completa.** A saída é acumulada e só linhas fechadas são
  interpretadas. Extraída para `electron/saidaBackend.ts` para ser testável.
- **Testes** (`npm run test:electron`): sete de unidade — token partido em dois,
  partido caractere a caractere, com `\r\n` do Windows, marcador citado no meio
  de uma frase, e a garantia de que o segredo não vai para o log — e um de
  integração que sobe o backend de verdade, lê o token como o Electron lê e
  confirma que a rota protegida aceita, enquanto meio token e token vazio
  recebem 403.
- **Interface resiliente a timing.** A credencial passa a ser buscada sob
  demanda, com uma segunda tentativa diante de 403. Antes era buscada uma única
  vez na montagem: se `/health` respondesse "pronto" antes de o token chegar
  pelo IPC, o laço encerrava e nada mais funcionava até reabrir o aplicativo.

**Lição de interface, não só de código:** a mensagem "Nenhum arquivo pôde ser
processado" não dizia o motivo, e diagnosticar exigiu abrir o console do
desenvolvedor. Agora ela mostra a causa — com o `403` à vista, o caminho até
aqui teria sido curto.

### 8.5 O aviso de "lido por OCR" era sempre falso

O aplicativo mostra a etapa "Documento lido por OCR" para sinalizar que o texto
passou por reconhecimento — o momento em que a revisão humana mais importa,
porque é onde o conteúdo pode ter chegado incompleto (seção 5.1).

Esse aviso **nunca aparecia**. A detecção comparava dois campos que o liteparse
devolve (`markdown` e `text`) supondo que uma página escaneada viria sem o
primeiro. Ela vem com os dois preenchidos — o texto reconhecido chega pelos
mesmos campos do texto nativo, e o liteparse não expõe nenhuma flag de OCR. Em
sete PDFs 100% escaneados, a resposta foi `False` nas sete vezes.

A detecção agora é explícita: imagem é sempre OCR; `.docx`/`.xlsx`/`.pptx`
nunca são; e cada página de PDF é sondada com o OCR desligado para ver se traz
camada de texto própria. A sondagem é barata dos dois lados — numa página
escaneada não há nada para extrair, e num PDF nativo a extração de texto é a
parte rápida.

Três detalhes que decidem se o aviso é confiável:

- **A varredura é do documento inteiro, não de uma amostra.** O auto típico
  mistura petição nativa na frente com anexo digitalizado atrás; sondar as
  primeiras páginas declararia o conjunto todo nativo e perderia justamente o
  anexo, que é onde a revisão importa. O aviso passou a dizer a contagem:
  *"12 de 225 páginas lidas por OCR — confira o resultado"*.
- **O limiar de camada de texto é de 200 caracteres, não de um punhado.** O PJe
  estampa a tarja "Assinado eletronicamente por…" por cima do anexo
  digitalizado, e ela é texto nativo. Num limiar baixo, o carimbo faria a página
  escaneada se declarar nativa — escondendo que todo o conteúdo veio de OCR.
- **Folha em branco não conta.** A página só é contada se não tinha texto nativo
  **e** produziu texto depois do reconhecimento. Sem isso, todo PDF com
  separador vazio alegaria ter passado por OCR — e um aviso que dispara sempre
  deixa de ser lido.

Oito testes em `tests/test_deteccao_ocr.py`, um deles sobre matrícula
digitalizada real.

## 9. Situação do upstream

| | instalado antes | agora |
|---|---|---|
| presidio-analyzer | 2.2.362 | **2.2.364** |
| presidio-anonymizer | 2.2.362 | **2.2.364** |

`requirements.txt` usava `>=` — pisos, não versões fixas. O efeito era real: uma
instalação nova trazia 2.2.364 enquanto o instalador embarcava 2.2.362.
Anonimização é o tipo de coisa em que o resultado precisa ser o mesmo em toda
máquina, então as versões passaram a ser fixas.

**O backend do instalador foi sincronizado.** `resources/python-backend/` é
gitignored e vinha sendo atualizado à mão — drift silencioso garantido. Agora há
`scripts/sync-backend.sh`, com modo `--check` para uso em CI.

Novidades do upstream avaliadas: timeout configurável de regex (2.2.362+),
`HuggingFaceNerRecognizer` oficial, backend ONNX Runtime, batch na REST API.

### 9.1 O que o Python embarcado ainda traz de diferente

`sync-backend.sh` copia o código, não as bibliotecas: o Python embarcado é uma
instalação Windows de 1,6 GB atualizada por outro caminho. Conferido pacote a
pacote contra `requirements.txt`:

| Pacote | Fixado | No instalador |
|---|---|---|
| presidio-analyzer / anonymizer | 2.2.364 | **2.2.364** — atualizado agora |
| fastapi | 0.141.1 | 0.135.2 |
| spacy | 3.8.15 | 3.8.13 |
| torch | 2.13.0 | 2.11.0+cpu |

O Presidio foi alinhado porque é ele que decide o que é PII — rodar a
anonimização em versão diferente da que foi medida invalidaria os números desta
auditoria. Os wheels são `py3-none-any`, então a atualização não depende de
Windows, e os `predefined_recognizers` do instalador passaram a ser idênticos
aos do ambiente onde os 40 testes rodam.

As outras três ficaram para trás de propósito: `torch` e `spacy` trazem binários
compilados para Windows (torch sozinho passa de 800 MB), e atualizá-los às cegas
a partir do WSL — sem conseguir executar o resultado para conferir — trocaria
uma divergência conhecida por um risco não medido. Nenhuma delas participa da
decisão sobre o que é dado pessoal.

O `--check` do script cobre só o código. **Comparar as versões das bibliotecas
continua sendo passo manual**, e vale rodar antes de publicar instalador.

Achado à parte, não corrigido: quatro pacotes têm dois `.dist-info` no
embarcado (`numpy` 2.4.3 e 2.4.4, `regex`, `filelock`, `packaging`) — resíduo de
instalação sobreposta in-place. Não afeta a execução, mas torna `pip list`
pouco confiável ali.

---

## 10. Como reproduzir

```bash
python3 -m venv .venv
.venv/bin/pip install -r python-backend/requirements.txt -r python-backend/requirements-dev.txt
.venv/bin/python -m spacy download pt_core_news_lg

# suíte de regressão (24 testes, casos reais de OCR)
cd python-backend && PRESIDIO_NLP_MODE=spacy ../.venv/bin/python -m pytest tests -q

# acurácia sobre o corpus real
PRESIDIO_NLP_MODE=spacy ../.venv/bin/python -m eval.run_eval
../.venv/bin/python -m eval.agregar eval/depois_spacy.json
```

O corpus é apontado por `PRESIDIO_EVAL_CORPUS` (padrão: a pasta Downloads do
Windows). Os documentos não estão no repositório.
