@echo off
REM Wrapper que chama o Python embutido do instalador com cli.py.
REM
REM Uso:
REM   tecjustica-sigilo.cmd arquivo.txt
REM   tecjustica-sigilo.cmd arquivo.txt -o saida.txt
REM   type arquivo.txt | tecjustica-sigilo.cmd
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
