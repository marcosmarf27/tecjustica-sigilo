# API local — como um programa externo usa o motor

Este documento é o contrato para quem for escrever um cliente: uma extensão de
navegador para o PJe, um script, um agente MCP, um plugin de editor.

O TecJustiça Sigilo roda um servidor HTTP em `127.0.0.1` enquanto o aplicativo
está aberto. Ele existe para que **o documento não precise sair da máquina**:
em vez de mandar autos para um serviço na nuvem, o cliente manda para a porta
local e recebe o texto já mascarado.

---

## As três coisas que você precisa saber antes de codificar

**1. A porta é dinâmica.** O aplicativo procura a primeira porta livre a partir
de 8123. Com 8123 ocupada, ele sobe em 8124. Não crave a porta.

**2. Você precisa de credencial.** Toda rota, menos `GET /v1/info` e o
pareamento, exige o cabeçalho `X-Presidio-Token`. Ela se obtém por pareamento,
que exige aprovação humana.

**3. Você não vai conseguir ler arquivos do disco do usuário.** Isso é
proposital e não tem contorno. Cliente externo **envia** o conteúdo; quem abre
arquivo por caminho é só a janela do aplicativo.

---

## Descoberta: onde o motor está

Leia `sessao.json` no diretório de dados do aplicativo:

| Sistema | Caminho |
|---|---|
| Windows | `%APPDATA%\tecjustica-sigilo\sessao.json` |
| Windows (alternativa) | `%APPDATA%\TecJustiça Sigilo\sessao.json` |
| macOS | `~/Library/Application Support/tecjustica-sigilo/sessao.json` |
| macOS (alternativa) | `~/Library/Application Support/TecJustiça Sigilo/sessao.json` |
| Linux | `~/.config/tecjustica-sigilo/sessao.json` |
| Linux (alternativa) | `~/.config/TecJustiça Sigilo/sessao.json` |

> **Procure nos dois nomes, sempre.** A pasta vem de `app.getName()`, que lê o
> `package.json` **embarcado**: `productName` se existir lá, senão `name`. Hoje
> o `productName` mora só na configuração do empacotador, então **a versão
> instalada usa `tecjustica-sigilo`** — a mesma do desenvolvimento. Isso foi
> medido rodando o app do instalador 1.3.0, e esta tabela afirmava o contrário
> até 30/08/2026. Mover uma linha de configuração inverte a resposta sem que
> você fique sabendo; um cliente que crava um nome quebra num dia qualquer.

```json
{ "versao": 1, "porta": 8123, "pid": 27780, "api": "habilitada" }
```

**Não há token aqui, e essa é a peça central do desenho.** Uma página aberta no
navegador alcança `127.0.0.1` mas **não lê arquivos**; um programa local lê. A
descoberta chega a quem tem motivo legítimo e não chega a quem não tem, sem
criptografia nenhuma envolvida — só a escolha do canal.

O arquivo é apagado quando o aplicativo encerra — mas não numa queda de energia
nem quando o processo é morto pelo gerenciador de tarefas. Então o arquivo pode
existir apontando para uma porta que outro programa tomou.

> **Confira a identidade antes de mandar qualquer conteúdo.** Chame
> `GET /v1/info` e só siga se a resposta trouxer `"produto": "TecJustiça Sigilo"`
> e `"api": 1`. **Status 200 não basta:** qualquer servidor que tenha ficado com
> a porta responde 200, e o passo seguinte de um cliente é um POST com o texto
> dos autos. Um cliente que confia no código de status manda documento judicial
> para um programa desconhecido.

O `pid` continua publicado para quem quiser um sinal a mais, mas não é a
checagem principal: o sistema recicla pid. E cuidado com o idioma POSIX
`os.kill(pid, 0)` — no Windows ele chama `TerminateProcess` e **mata** o
aplicativo em vez de perguntar por ele.

---

> **O `nome` que você manda no pareamento fica em claro no perfil do usuário.**
> O registro de clientes guarda `nome`, `origem`, escopos e datas legíveis —
> só o token é guardado como hash. Use um nome de **programa** ("Extensão PJe",
> "Robô de autuação"), nunca o nome de uma pessoa. É o nome que aparece na tela
> de Conexões para o usuário aprovar, então ele também precisa ser reconhecível.

---

## `GET /v1/info` — pública

A única rota sem credencial. Serve para o cliente saber com o que está falando
antes de pedir pareamento.

```json
{
  "produto": "TecJustiça Sigilo",
  "api": 1,
  "motor": {
    "pronto": true,
    "modo_nlp": "transformer",
    "modo_solicitado": "transformer",
    "motivo_fallback": null
  },
  "politicas": ["placeholder", "parcial", "total"],
  "politica_padrao": "placeholder",
  "formatos": [".pdf", ".docx", ".xlsx", ".png", "..."],
  "ocr": { "offline": true, "motor": "PP-OCRv6 small" },
  "escopos_pareaveis": ["anonimizar", "documento", "ocr"]
}
```

⚠ **Confira `motivo_fallback` antes de confiar no resultado.** Quando não é
nulo, o motor pedido não subiu e caiu para o modo leve — que encontra **menos
nomes e locais**. O documento sai com a mesma aparência de sempre, e a diferença
não aparece em lugar nenhum além deste campo. Um cliente sério avisa o usuário.

---

## Pareamento

O ciclo tem três passos e uma pessoa no meio.

### 1. Peça

```http
POST /v1/parear
Content-Type: application/json

{ "nome": "Extensão PJe", "escopos": ["anonimizar", "documento"] }
```

```json
{
  "pedido": "kR3f…",
  "codigo": "D8J92C",
  "escopos_concedidos": ["anonimizar", "documento"],
  "expira_em": 180,
  "instrucao": "Confira o código na janela do TecJustiça Sigilo e aprove."
}
```

### 2. Mostre o código ao usuário

**Isto não é opcional.** Exiba `codigo` na sua interface. O mesmo código aparece
no diálogo do aplicativo, e é conferindo os dois que a pessoa distingue "eu
autorizei o programa que acabei de abrir" de "cliquei em permitir num pedido que
apareceu sozinho". Um cliente que esconde o código destrói a única defesa contra
aprovação às cegas.

### 3. Espere a decisão

```http
GET /v1/parear/{pedido}
```

| Código | Significado |
|---|---|
| `202` | ainda pendente — continue perguntando, ~1 s de intervalo |
| `200` | aprovado, com `{"token": "…"}` |
| `403` | recusado pelo usuário |
| `404` | expirou, não existe, **ou o token já foi entregue** |

O token sai **uma vez só**. Numa segunda consulta o pedido responde `404`. Se
você perdeu o token, pareie de novo — deixar a credencial disponível para
releitura transformaria o id do pedido, que trafega em URL, numa segunda
credencial.

Guarde o token no perfil do usuário e mande-o em `X-Presidio-Token` daí em
diante. Ele vale até ser revogado na tela de Conexões.

---

## Escopos

| Escopo | Rota | O que permite |
|---|---|---|
| `anonimizar` | `POST /v1/anonimizar` | mandar texto, receber texto mascarado |
| `ocr` | `POST /v1/ocr` | mandar imagem, receber o texto reconhecido |
| `documento` | `POST /v1/documento` | enviar PDF/DOCX/imagem, receber o texto |
| `arquivo-local` | — | **nunca concedido** |

Peça só o que for usar. Pedir `arquivo-local` não é erro — o escopo é
simplesmente descartado, você recebe o pareamento sem ele, e leva `403` se
tentar usá-lo.

Uma credencial fora do escopo recebe `403`, igual a nenhuma credencial. Isso é
proposital: um cliente não descobre quais rotas existem sondando.

---

## Rotas de trabalho

### `POST /v1/anonimizar`

```json
{ "texto": "Requerente: João da Silva, CPF 529.982.247-25",
  "entidades": ["PERSON", "CPF_BR"],
  "politica": "placeholder" }
```

`entidades` vazio ou ausente = todas. Resposta:

```json
{
  "texto_anonimizado": "Requerente: [PESSOA_1], CPF [CPF_1]",
  "ocorrencias": [
    { "type": "PERSON", "text": "João da Silva", "start": 12, "end": 25, "score": 0.99 }
  ],
  "politica": "placeholder",
  "valores_distintos": 2
}
```

As três políticas, e o compromisso de cada uma:

| Política | Saída | Compromisso |
|---|---|---|
| `placeholder` | `[PESSOA_1]`, `[CPF_1]` | nada permanece; a numeração é estável |
| `parcial` | `J**** d* S****` | dá para conferir de relance, mas fragmentos somados podem reidentificar |
| `total` | `*************` | esconde até o formato do dado |

### `POST /v1/documento` — `multipart/form-data`

| Campo | |
|---|---|
| `file` | o arquivo (obrigatório) |
| `entidades` | lista separada por vírgula |
| `politica` | uma das três |
| `anonimizar_texto` | `true` (padrão) ou `false` |

```json
{
  "texto": "…",
  "texto_anonimizado": "…",
  "ocorrencias": [ … ],
  "ocr": { "houve_ocr": true, "paginas_ocr": 14, "paginas_com_erro": 0,
           "erros": [], "total_paginas": 14 }
}
```

⚠ **`paginas_com_erro` não pode ser escondido do usuário.** São páginas que
precisavam de OCR e não voltaram. O texto delas **não está** no resultado — e o
que não está no resultado não foi anonimizado nem revisado. Um cliente que
mostra o texto sem esse aviso está entregando um documento mutilado com cara de
completo.

### `POST /v1/ocr` — `multipart/form-data`

`file` e `language` (padrão `pt`). Devolve `{"results": [{text, bbox, confidence}]}`.

---

## Administração (só a janela do aplicativo)

`GET /v1/clientes`, `DELETE /v1/clientes/{id}`, `GET /v1/pedidos` e
`POST /v1/pedidos/{id}/decidir` exigem o **token de sessão**, que só o processo
do Electron conhece. Nenhum cliente pareado os alcança, nem para administrar a
si mesmo.

---

## Extensão de navegador

O CORS aceita **exatamente** uma forma de origem:

```
chrome-extension://[a-p]{32}
```

Nenhuma origem `http://` de página comum é aceita, nem em desenvolvimento. Uma
página web comum não vai conseguir usar esta API pelo navegador — e não deve.

No `manifest.json`, declare a permissão de host:

```json
{ "host_permissions": ["http://127.0.0.1/*"] }
```

Como a porta é dinâmica e uma extensão **não lê arquivos do disco**, ela não
consegue ler o `sessao.json` sozinha. Duas saídas:

1. **Varredura curta** de 8123 a 8133, chamando `GET /v1/info` em cada uma —
   é público e barato. Aceite só a porta cuja resposta traga
   `"produto": "TecJustiça Sigilo"`: numa varredura você vai bater em servidores
   alheios, e o primeiro 200 não é necessariamente este aplicativo;
2. **Peça a porta ao usuário** uma vez, mostrando o valor que aparece na tela
   de Conexões, e guarde.

> **CORS não é autorização.** Ele só decide quem pode *ler* a resposta; não
> impede a requisição de chegar. Quem protege este backend é o token.

---

## MCP

O aplicativo traz um servidor MCP embutido, para agentes:

```json
{
  "mcpServers": {
    "tecjustica-sigilo": { "command": "tecjustica-sigilo", "args": ["mcp"] }
  }
}
```

Quatro ferramentas: `anonimizar_texto`, `ler_documento`, `ocr_imagem` e
`status`. Diferente da API HTTP, `ler_documento` **aceita caminho de arquivo** —
um servidor MCP em stdio já roda com os privilégios de quem o levantou, e o
agente que o chama é o próprio programa do usuário. A fronteira que a API HTTP
protege é outra: a de uma página de navegador alcançando a porta local.

---

## Erros

| Código | Quando |
|---|---|
| `202` | pedido de pareamento aberto ou pendente |
| `400` | corpo inválido, arquivo vazio |
| `403` | sem credencial, credencial revogada, ou fora do escopo |
| `404` | pedido expirado, já entregue, ou cliente inexistente |
| `413` | arquivo acima do limite |
| `415` | formato não suportado — não adianta repetir |
| `422` | política desconhecida |
| `503` | o motor ainda está subindo — **vale tentar de novo** |

A distinção entre `415` e `503` importa para quem escreve retry: `415` é erro
seu e continua errado para sempre; `503` é temporário.

---

## Checklist para um cliente bem-comportado

- [ ] Descobre a porta em vez de cravá-la
- [ ] Mostra o código de pareamento ao usuário
- [ ] Guarda o token no perfil, não no código
- [ ] Trata `403` refazendo o pareamento, sem laço infinito
- [ ] Avisa quando `motivo_fallback` não é nulo
- [ ] Avisa quando `paginas_com_erro > 0`
- [ ] Pede só os escopos que usa
- [ ] Não repete requisição em `415`
