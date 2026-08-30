"""
Configuração compartilhada da suíte.

## Por que o token vive aqui

`server.py` lê `TOKEN_SESSAO` de `PRESIDIO_TOKEN` **na carga do módulo** — uma
vez por processo, porque em produção o token é sorteado no boot e vale para a
execução inteira. Numa suíte, isso significa que o **primeiro** arquivo de teste
a importar `server` congela o token para todos os outros.

Enquanto todos os arquivos usavam o mesmo literal, ninguém percebeu. Quando um
arquivo novo escolheu outro valor, os testes anteriores passaram a mandar uma
credencial que não batia e recebiam `403` onde esperavam `404` — um sintoma que
aponta para o middleware, e não para a fixture, que é onde o problema estava.

Definir aqui, antes de qualquer import de `server`, tira a ordem de importação
da equação: só existe um token, e ele não depende de quem importou primeiro.
"""

import os

TOKEN = "token-de-teste"

# Antes de qualquer import de `server` por qualquer módulo de teste. O conftest
# é carregado pelo pytest antes dos arquivos de teste, que é exatamente a janela
# necessária.
os.environ["PRESIDIO_TOKEN"] = TOKEN

# spaCy por padrão na suíte: o BERT leva minutos para carregar e os testes
# medem comportamento de rota, não qualidade de detecção. O gate de acurácia,
# esse sim, roda em `transformer`.
os.environ.setdefault("PRESIDIO_NLP_MODE", "spacy")
