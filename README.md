<p align="center">
  <img src="assets/logo.jpg" alt="TecJustiça Sigilo" width="180" />
</p>

<h1 align="center">TecJustiça Sigilo</h1>

<p align="center">
  <strong>Anonimizador desktop de PII para textos jurídicos brasileiros.</strong><br/>
  100% local · LGPD-friendly · feito para quem mexe com processo judicial todo dia.
</p>

<p align="center">
  <a href="https://github.com/marcosmarf27/tecjustica-sigilo/releases/latest"><img src="https://img.shields.io/badge/download-Windows%20x64-0066cc?style=for-the-badge&logo=windows" alt="Download" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/grátis-para%20sempre-ff4081?style=for-the-badge" alt="Grátis" />
  <img src="https://img.shields.io/badge/open%20source-%E2%9D%A4-red?style=for-the-badge" alt="Open Source" />
</p>

<p align="center">
  <img src="assets/hero.jpg" alt="Anonimização de documentos jurídicos" width="100%" />
</p>

## 💚 Grátis, livre e para todo mundo

Este projeto é **open source sob licença MIT**. Você pode:

- ✅ **Baixar e usar** gratuitamente, para sempre — no trabalho, no escritório, em casa.
- ✅ **Alterar o código** como quiser, adaptar para o seu tribunal/vara/escritório.
- ✅ **Redistribuir**, até mesmo comercialmente, desde que mantenha o aviso de licença.
- ✅ **Compartilhar** com colegas que lidam com dados sensíveis — quanto mais gente usando anonimização local, melhor.

Sem cadastro, sem assinatura, sem telemetria, sem pagar nada em momento nenhum.
Se ajudar seu dia a dia, deixe uma ⭐ no repositório — é o único "pagamento" que o projeto aceita.

## Por que existe

Ferramentas genéricas de anonimização erram muito em textos jurídicos: perdem
nomes escritos em CAIXA ALTA, marcam "Ministério Público" como pessoa, não
entendem número CNJ, não validam CPF. O resultado é vazamento de dados ou
mascaramento excessivo que inutiliza o documento.

O TecJustiça Sigilo foi montado com o **contexto certo para o tribunal brasileiro**:
modelo NER treinado em jurisprudência, regex dos documentos oficiais com
**validação de dígito verificador**, e deny list de expressões jurídicas que
nenhum servidor, advogado ou magistrado quer ver mascarada.

## Diferenciais

### 🎯 NER jurídico brasileiro de fato
Usa [`pierreguillou/ner-bert-large-cased-pt-lenerbr`](https://huggingface.co/pierreguillou/ner-bert-large-cased-pt-lenerbr) — BERT fine-tuned no
dataset **LeNER-Br** (jurisprudência real de vários tribunais BR), F1 ≈ 0.91.
Reconhece nomes em `CAIXA ALTA`, `Title Case` e `minúsculas` sem gambiarra de
pré-processamento, além de entidades específicas como `LEGISLAÇÃO` e
`JURISPRUDÊNCIA`.

### 🔢 Documentos BR com validação de checksum
Não é só regex. CPF, CNPJ, PIS/NIT e número de processo CNJ passam pelo
**dígito verificador**. Candidato com DV inválido (ex: `00000000000`) é
**descartado**; candidato válido tem o score **elevado** para 0.95+. Efeito:
menos falso positivo, mais recall em variações como CPF sem formatação.

### 🧠 Deny list jurídica acoplada
Termos como `Ministério Público`, `Tribunal de Justiça`, `Caixa Econômica`,
`Banco do Brasil`, `Código de Processo Penal`, `Juíza de Direito`, etc.
**não** são mascarados — mesmo quando o modelo insiste em classificá-los
como pessoa/local. Configurável via `config/deny_list.json` sem recompilar.

### 🔍 Tela de revisão — dá para conferir o que foi mascarado
Anonimizar sem poder auditar é fé, não garantia. Cada trecho detectado aparece
como **tarja de redação**; passar o cursor (ou focar pelo teclado) revela o
valor original por baixo. A lista lateral traz **todas as ocorrências com o
grau de confiança**, e um clique leva até o trecho no texto.

Achou um falso positivo? **"Não é PII"** grava a exceção e ela vale já no
próximo processamento, sem reiniciar o app.

### 📄 Lê PDF, Word e imagem digitalizada
Arraste os autos como eles saem do PJe. Páginas digitalizadas passam por
reconhecimento de texto **na sua máquina** — PDFium para o texto nativo e
**PP-OCRv6** para o resto, rodando em CPU comum, com os modelos empacotados
junto para não depender de internet nem na primeira execução.

Formatos: `.pdf`, `.docx`, `.xlsx`, `.pptx`, imagens (`.png`, `.jpg`, `.tif`…),
além de `.txt`, `.md` e `.rtf`.

**Quanto demora.** Página com texto nativo é instantânea — só as digitalizadas
passam pelo reconhecimento, e essas custam **alguns segundos cada** num notebook
comum. Uma procuração de 12 páginas escaneadas leva minutos, não segundos, e a
tela informa em que página está (“página 3 de 12”) justamente para você
distinguir lento de travado. Um processo inteiro é trabalho de café.

Se quiser ajustar ao seu processador, `PRESIDIO_OCR_THREADS` define quantas
threads o reconhecedor usa. **Mais não é mais rápido**: o padrão é 4 porque
medir mostrou que subir disso chega a piorar cinco vezes em CPU com núcleos de
eficiência (os E-cores dos Intel recentes). O porquê está no cabeçalho de
`THREADS_PADRAO`, em `python-backend/ocr_engine.py`.

### 🎚️ Você escolhe como substituir
Três políticas, com o resultado à vista na hora de escolher:

| | Saída | Quando usar |
|---|---|---|
| **Marcador** | `[PESSOA_1]`, `[CPF_1]` | Nada do dado permanece. A numeração é estável, então dá para acompanhar quem é quem. |
| **Máscara parcial** | `J**** d* S****` | Conferência visual rápida — ao custo de manter iniciais e dígitos. |
| **Cobertura total** | `*************` | Esconde inclusive o formato. |

### 💻 Interface que respeita o fluxo do operador
- **Arraste e solte** múltiplos arquivos (até 10).
- **Progresso real** e **cancelar** que interrompe o trabalho de verdade.
- **Cancelar** a qualquer momento; um arquivo que falha não derruba o lote.
- **Um botão de salvar** grava `nome_anonimizado.txt` ao lado do original,
  pedindo confirmação antes de substituir.
- **Toggle de entidades**: escolha mascarar só CPF, ou só nomes, ou tudo.
- **Histórico** com o que foi processado — sem guardar o documento em disco
  (veja abaixo).

### ⌨️ CLI nativa (Windows + WSL)
O instalador põe `tecjustica-sigilo` no PATH do `cmd` / `PowerShell` e no
**WSL bash** (shim em `~/.local/bin`). Uma instalação, dois ambientes.

```bash
tecjustica-sigilo autos.pdf                    # PDF, DOCX, XLSX, imagem — com OCR
tecjustica-sigilo processo.txt -o saida.md
cat peticao.txt | tecjustica-sigilo -e PERSON,CPF_BR
tecjustica-sigilo autos/*.pdf --output-dir ./anonimizados
tecjustica-sigilo termo.txt -f json            # para agentes e pipelines
```

**Subcomandos:**

| | |
|---|---|
| `anonimizar <arquivo>…` | mascara os dados pessoais (é o padrão, pode omitir) |
| `ler <arquivo>…` | extrai o texto com OCR, **sem** anonimizar |
| `ocr <imagem>` | reconhece o texto de uma imagem |
| `status` | o aplicativo está aberto? em que modo está o motor? |
| `conectar` | autoriza esta CLI junto ao aplicativo |
| `mcp` | servidor MCP em stdio, para agentes |

**A CLI é cliente fino.** Com o aplicativo aberto, ela delega para o motor que
já está quente — a resposta é imediata. Fechado, carrega o motor no próprio
processo e avisa o custo, que é de segundos a minutos. `--offline` força o
local; `--remoto` falha em vez de esperar.

Para usar o motor do aplicativo, autorize uma vez:

```bash
tecjustica-sigilo conectar     # mostra um código; confira e aprove na janela
```

### 🤖 Servidor MCP

O mesmo comando expõe o motor como ferramenta de agente:

```json
{
  "mcpServers": {
    "tecjustica-sigilo": { "command": "tecjustica-sigilo", "args": ["mcp"] }
  }
}
```

Quatro ferramentas: `anonimizar_texto`, `ler_documento`, `ocr_imagem` e
`status`. Resolve o problema óbvio de um agente que lê autos — o conteúdo é
sigiloso e mandá-lo para um modelo na nuvem é o que este produto existe para
evitar. O agente manda o documento para cá e recebe o texto **já mascarado**.

### 🔌 API local

Enquanto o aplicativo está aberto, ele mantém um servidor em `127.0.0.1` para
que extensões de navegador e outros programas usem o motor sem que o documento
saia da máquina. Cada cliente é autorizado **individualmente**, com um código
conferido nos dois lados, e pode ser revogado na tela **Conexões**.

Ler arquivo do disco por caminho **nunca** é concedido a cliente externo: ele
envia o conteúdo, e quem abre arquivo do seu computador continua sendo só a
janela do aplicativo.

📄 Contrato completo: [`docs/api-local.md`](docs/api-local.md)

### 🔒 Zero envio de dados
Tudo roda como processo local na sua máquina. Nenhuma chamada para serviço
externo, nem no caminho da anonimização nem em qualquer outro: até as fontes da
interface são empacotadas junto. O modelo BERT é baixado apenas **uma vez**
(HuggingFace) na primeira execução; depois disso, offline.

### 🗄️ O que fica no disco, e como

Versões anteriores prometiam que nada do documento tocava o disco. **Isso mudou,
e vale ser exato sobre o que mudou.**

Para que a revisão possa ser reaberta depois de fechar o programa — o histórico
antigo prometia isso e não cumpria —, existe agora um **cofre**. Ele guarda o
texto original, a lista de ocorrências encontradas e o texto anonimizado.

| | |
|---|---|
| **Vem desligado** | nada é gravado até você consentir, uma vez, num aviso que diz exatamente o que passa a ficar no disco |
| **Cifrado em repouso** | com a proteção de dados do Windows (DPAPI), atrelada à sua conta de usuário |
| **Falha fechada** | onde o sistema não oferece cifragem, o cofre **recusa gravar** — nunca grava em claro |
| **Apaga sozinho** | prazo de guarda configurável, 30 dias por padrão; dá para apagar item a item ou esvaziar tudo |
| **O índice também é cifrado** | nome de arquivo em processo judicial carrega nome de pessoa |

**O que a cifragem protege:** outra pessoa usando esta máquina com outra conta,
e a leitura do disco fora do sistema — se o computador for levado ou o HD
montado em outro lugar.

**O que ela não protege:** um programa malicioso rodando com a sua própria
conta, agora. Para o sistema, ele é você — e recebe os dados decifrados se
pedir. Nenhuma cifragem atrelada à conta do usuário protege contra isso.

Com o cofre desligado, o comportamento é o de antes: o texto e as ocorrências
existem só na memória enquanto o programa está aberto. O arquivo anonimizado que
você salva é seu, fica em claro onde você escolher, e é seguro por construção —
os dados pessoais já não estão nele.

## 📥 Baixar

**Windows (10/11 x64):**
👉 **[Baixar `TecJustiça Sigilo Setup.exe` (último release)](https://github.com/marcosmarf27/tecjustica-sigilo/releases/latest)**

O instalador tem ~660 MB porque já traz Python embutido + `transformers` +
`torch` CPU. Na primeira execução baixa o modelo BERT (~1.7 GB) — requer
internet só nesse momento. Depois funciona 100% offline.

Linux/Mac: rode em modo dev (abaixo). Build nativo sob demanda.

## Entidades reconhecidas

| Tipo | Exemplo | Técnica |
|---|---|---|
| `PERSON` | nomes próprios | NER BERT + regex de fallback |
| `CPF_BR` | `123.456.789-09`, `12345678909` | regex + DV |
| `CNPJ_BR` | `12.345.678/0001-90`, `12345678000190` | regex + DV |
| `RG_BR` | `12.345.678-9` | regex |
| `NIT_PIS_PASEP` | `120.45678.90-0` | regex + DV |
| `NUMERO_PROCESSO_CNJ` | `0001234-56.2023.8.06.0001` | regex + checksum CNJ |
| `OAB_BR` | `OAB/CE 45.678` | regex |
| `PHONE_NUMBER_BR` | `(85) 99876-5432`, `+55 85…` | regex |
| `EMAIL_ADDRESS` | `joao@exemplo.com` | regex padrão Presidio |
| `ENDERECO_BR` | `Rua Cassiano Correia, 4, Boa Esperança` | regex de logradouro + âncora |
| `CEP_BR` | `62755-000` | regex + âncora de endereço |
| `LOCATION` | cidades, topônimos | NER BERT |
| `DATE_OF_BIRTH` | `15/03/1985` | regex + contexto |
| `CONTA_BANCARIA` | `Ag 1234 CC 56789-0` | regex |

Cada entidade tem uma **máscara própria** que preserva parte do valor para
auditoria (ex: `CPF 123.***.***-09`, `nome J*** d* S****`) — configurável em
`python-backend/mask_config.py`.

## Stack

- **Desktop**: Electron 41 + React 19 + TypeScript + Tailwind 4.
- **Leitura de documentos**: [liteparse](https://github.com/run-llama/liteparse)
  (Apache 2.0) para o texto nativo, via PDFium.
- **OCR**: [PP-OCRv6](https://github.com/PaddlePaddle/PaddleOCR) da PaddlePaddle
  (Apache 2.0), pesos oficiais em ONNX, executados por
  [RapidOCR](https://github.com/RapidAI/RapidOCR) sobre ONNX Runtime em CPU.
  Sem GPU e sem rede.
- **Design system**: tokens em `src/styles/tokens.css`, documentados em
  [`docs/design-system.md`](docs/design-system.md). Fontes auto-hospedadas.
- **Backend**: FastAPI + [Microsoft Presidio](https://microsoft.github.io/presidio/).
- **NER default**: BERT fine-tuned LeNER-Br (F1 ≈ 0.91).
- **NER fallback**: `pt_core_news_lg` (modo `PRESIDIO_NLP_MODE=spacy`).

## Rodar em desenvolvimento

Pré-requisitos: Node 20+, Python 3.12 ou 3.13 — **de 64 bits**. `torch`,
`onnxruntime` e `spacy` não publicam wheel de 32 bits nem sdist nas versões
pinadas, e num Python `win32` a instalação falha com uma mensagem que parece
outra coisa. Confira com `python -c "import sysconfig;
print(sysconfig.get_platform())"`: tem de dizer `win-amd64`.

**No Windows, siga [`docs/desenvolvimento-windows.md`](docs/desenvolvimento-windows.md).**
É um aplicativo Windows, e é lá que ele deve ser desenvolvido — pelo WSL o
`python.exe` embarcado é lido pela ponte de rede e cada carregamento de modelo
leva dezenas de segundos que não existem no produto real.

```bash
npm install

python3 -m venv .venv
.venv/bin/pip install -r python-backend/requirements.txt
.venv/bin/python -m spacy download pt_core_news_lg

# Modelos do OCR (~31 MB), com SHA-256 conferido contra o MANIFESTO.json.
# Sem eles o backend recusa a primeira página escaneada em vez de baixar
# modelo da rede em silêncio.
scripts/fetch-ocr-models.sh

npm run dev:electron
```

Para gerar o instalador é preciso montar antes o Python embarcado, que não está
no git: `scripts/setup-python-embed.sh`, depois `npm run build:dist`.

Para usar o modo leve (sem baixar BERT):
```bash
PRESIDIO_NLP_MODE=spacy npm run dev:electron
```

## Testes e medição de acurácia

Três suítes, três runners, por motivos diferentes:

```bash
npm test              # renderer (vitest) — funções puras da interface
npm run test:electron # processo principal (node --test) — cofre, token, sessão
cd python-backend && ../.venv/Scripts/python.exe -m pytest -q
```

O `npm test` entra no `npm run build`, junto do typecheck: os dois primeiros
defeitos que ele pegou eram invisíveis para o TypeScript — uma numeração de
ocorrência que divergia entre a lista e o texto, e um lote que morria sem
mensagem. Nenhum dos dois é erro de tipo.

O `test:electron` roda contra o JavaScript **compilado** e intercepta o módulo
`electron` no `require`; o vitest fica recortado a `src/` por isso mesmo
(`vitest.config.ts`).


O interpretador do venv está em `../.venv/Scripts/python.exe` no Windows e em
`../.venv/bin/python` no resto — os exemplos abaixo usam o primeiro, já que o
desenvolvimento acontece no Windows.

```bash
cd python-backend
PRESIDIO_NLP_MODE=spacy ../.venv/Scripts/python.exe -m pytest tests -q
```

A suíte tem casos de regressão vindos de **OCR real de processo**: entidade
partida entre linhas, número grudado na palavra seguinte, dígito trocado por
letra parecida. São esses os casos que separam 86% de 99% de recall.

Para medir acurácia sobre um corpus seu:

```bash
PRESIDIO_EVAL_CORPUS=/caminho/para/o/corpus \
  ../.venv/Scripts/python.exe -m eval.run_eval
../.venv/Scripts/python.exe -m eval.agregar eval/depois_bert.json
```

O harness constrói o gabarito de forma independente do detector e reporta
recall por ocorrência **e** proteção por valor único, com o inventário dos
vazamentos.

`PRESIDIO_EVAL_CORPUS` não tem valor padrão, e é de propósito: sem ela o gate
não reprova, ele é **pulado** — e teste pulado passa por teste aprovado em log
corrido. Confira no cabeçalho da saída que os documentos foram lidos.

Resultados da última medição em [`docs/relatorio-situacao-2026-08-14.md`](docs/relatorio-situacao-2026-08-14.md).

## Configuração por JSON (sem recompilar)

- `python-backend/config/deny_list.json` — termos que **nunca** devem ser
  mascarados, separados por tipo (`PERSON`, `LOCATION`, `ORGANIZATION`).
- `python-backend/config/context_words.json` — palavras que, quando próximas
  de um candidato regex, **elevam** o score (ex: `cpf`, `processo`, `oab`).

Edite, salve, reinicie o app — ou chame `POST /config/deny-list` para recarga a quente.

## Licença

MIT.
