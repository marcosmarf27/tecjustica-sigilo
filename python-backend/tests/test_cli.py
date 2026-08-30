"""
A CLI não pode destruir os autos que recebeu.

A anonimização produz **texto**, e o arquivo de entrada pode ser um PDF. Gravar
o resultado por cima da entrada não deixa um arquivo pior: deixa um arquivo que
nenhum leitor abre, no lugar do documento original, sem desfazer.

`--in-place` já era recusado para binário. Estes testes cobrem a porta dos
fundos que o Codex encontrou — `-o` apontando para a própria entrada faz
exatamente a mesma coisa e escapava da guarda, porque ela olhava para o nome da
opção em vez de olhar para o arquivo que ia ser aberto para escrita. A mensagem
de erro do `--in-place` chegava a **sugerir** `-o`.
"""

import cli


def _pdf(tmp_path, nome="autos.pdf"):
    caminho = tmp_path / nome
    caminho.write_bytes(b"%PDF-1.4\nconteudo original dos autos\n%%EOF\n")
    return caminho


def test_saida_apontando_para_a_entrada_binaria_e_recusada(tmp_path, capsys):
    autos = _pdf(tmp_path)
    antes = autos.read_bytes()

    codigo = cli.main(["anonimizar", str(autos), "-o", str(autos)])

    assert codigo == 1
    assert autos.read_bytes() == antes, "o PDF original foi tocado"
    assert "recusado" in capsys.readouterr().err


def test_recusa_vale_para_o_mesmo_arquivo_escrito_de_outro_jeito(tmp_path, capsys):
    """
    `./autos.pdf` e `autos.pdf` são o mesmo arquivo.

    Comparar strings deixaria passar caminho relativo, `..` no meio e — no
    Windows — só a diferença de maiúsculas. Por isso a checagem é `samefile`.
    """
    autos = _pdf(tmp_path)
    antes = autos.read_bytes()

    disfarcado = str(tmp_path / "subpasta" / ".." / "autos.pdf")
    (tmp_path / "subpasta").mkdir()

    codigo = cli.main(["anonimizar", str(autos), "-o", disfarcado])

    assert codigo == 1
    assert autos.read_bytes() == antes
    assert "recusado" in capsys.readouterr().err


def test_in_place_continua_recusado_para_binario(tmp_path, capsys):
    autos = _pdf(tmp_path)
    antes = autos.read_bytes()

    codigo = cli.main(["anonimizar", str(autos), "--in-place"])

    assert codigo == 1
    assert autos.read_bytes() == antes
    assert "--in-place recusado" in capsys.readouterr().err


def test_a_recusa_vem_antes_de_qualquer_trabalho(tmp_path, capsys):
    """
    Falhar cedo é parte do conserto.

    Validar depois de OCRizar 800 páginas cobraria minutos de CPU para só então
    dizer que a opção não valia. A guarda roda antes de resolver backend, exigir
    credencial ou carregar motor — e é por isso que este teste passa sem
    aplicativo aberto e sem `.venv` de motor carregado.
    """
    autos = _pdf(tmp_path)
    codigo = cli.main(["anonimizar", str(autos), "-o", str(autos)])
    assert codigo == 1
    assert "credencial" not in capsys.readouterr().err.lower()


def test_a_guarda_so_barra_a_colisao(tmp_path):
    """
    A comparação em si, sem rodar o comando.

    Chamar `cli.main` com um destino válido pediria backend e motor: o teste
    passaria a medir o ambiente (aplicativo aberto? credencial pareada?) em vez
    de medir a guarda, e levaria minutos quando não houvesse aplicativo. O que
    precisa estar certo aqui é só quando `_mesmo_arquivo` diz "sim".
    """
    autos = _pdf(tmp_path)
    (tmp_path / "subpasta").mkdir()

    assert cli._mesmo_arquivo(autos, autos)
    assert cli._mesmo_arquivo(tmp_path / "subpasta" / ".." / "autos.pdf", autos)
    assert not cli._mesmo_arquivo(tmp_path / "autos_anonimizado.md", autos)
    # Destino inexistente, comparado por caminho resolvido, e não por string.
    assert not cli._mesmo_arquivo(tmp_path / "outro.pdf", autos)
