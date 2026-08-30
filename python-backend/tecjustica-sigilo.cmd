@echo off
REM Wrapper que chama o Python embutido do instalador com cli.py.
REM
REM O `%*` repassa a linha de comando inteira, então os subcomandos funcionam
REM sem que este arquivo precise conhecê-los:
REM
REM   tecjustica-sigilo.cmd autos.pdf              (PDF, DOCX, imagem — com OCR)
REM   tecjustica-sigilo.cmd arquivo.txt -o saida.md
REM   type arquivo.txt | tecjustica-sigilo.cmd
REM   tecjustica-sigilo.cmd ler autos.pdf          (extrai sem anonimizar)
REM   tecjustica-sigilo.cmd ocr pagina.png
REM   tecjustica-sigilo.cmd status                 (app no ar? em que modo?)
REM   tecjustica-sigilo.cmd conectar               (autoriza esta CLI)
REM   tecjustica-sigilo.cmd mcp                    (servidor MCP em stdio)
REM   tecjustica-sigilo.cmd --help
REM
REM Onde encontrar este .cmd depois de instalar o app:
REM   %LOCALAPPDATA%\Programs\TecJustica Sigilo\resources\python-backend\tecjustica-sigilo.cmd
REM
setlocal
set "ROOT=%~dp0"
set "PYTHON=%ROOT%python-embed\python.exe"
set "CLI=%ROOT%cli.py"
"%PYTHON%" "%CLI%" %*
endlocal
