; Hook de instalação do TecJustiça Sigilo.
;
; ## O problema que isto resolve
;
; A CLI existe desde a v1, mas só era instalada se o usuário encontrasse a tela
; "Conexões" e clicasse no botão. Quem instalava e ia direto usar o programa
; nunca descobria que `tecjustica-sigilo` existia — e o critério de aceitação
; desta versão é justamente: depois de instalar, `tecjustica-sigilo status` roda
; num `cmd` novo **sem** o usuário ter aberto a interface.
;
; ## As bibliotecas precisam ser incluídas, e o desinstalador quer as `un.`
;
; `${WordFind}` e `${WordReplace}` não são comandos do NSIS — vêm de
; `WordFunc.nsh`, e cada uma tem de ser declarada com `!insertmacro` antes de
; ser usada. Faltando isso, o `makensis` aborta a criação do instalador inteiro
; com `Error in macro customUnInstall`.
;
; E há uma segunda camada: **função usada no desinstalador precisa da variante
; com prefixo `un.`**, declarada por `!insertmacro un.WordReplace` e chamada
; como `${un.WordReplace}`. O NSIS compila instalador e desinstalador como dois
; binários separados, e o segundo não enxerga as funções do primeiro. Chamar a
; versão sem prefixo ali é o erro clássico desta linguagem — e foi exatamente
; onde este arquivo quebrou.
;
; Isso só apareceu quando o `build:dist` finalmente chegou ao passo NSIS: as
; tentativas anteriores morriam antes, e o arquivo nunca tinha sido compilado.
;
; ## Por que HKCU e não HKLM
;
; O alvo NSIS é por usuário: `perMachine` não está definido no
; `electron-builder.yml`, então a instalação vai para `%LOCALAPPDATA%` e não
; pede elevação. Mexer no PATH da máquina exigiria administrador e afetaria
; todos os perfis — errado nos dois sentidos.
;
; ## A propagação, que é a parte esquecida
;
; Escrever no registro não avisa ninguém. Sem o `WM_WININICHANGE`, o PATH novo
; só aparece depois de logout ou reboot, e o usuário conclui que a instalação
; falhou. O broadcast faz o Explorer reler o ambiente, e todo `cmd` aberto a
; partir dali já enxerga.

!include "WordFunc.nsh"
!include "WinMessages.nsh"

!insertmacro WordFind
!insertmacro un.WordReplace

!macro customInstall
  ; O diretório onde vive o `tecjustica-sigilo.cmd`, dentro da instalação.
  StrCpy $0 "$INSTDIR\resources\python-backend"

  ; Lê o PATH do usuário direto do registro, sem expandir variáveis.
  ReadRegStr $1 HKCU "Environment" "PATH"

  ; Já está lá? Instalar duas vezes não pode duplicar a entrada. Os dois lados
  ; vão entre ponto-e-vírgulas para que `C:\App` não case dentro de
  ; `C:\AppOutro` — comparar sem os delimitadores acha um prefixo qualquer.
  ClearErrors
  ${WordFind} ";$1;" ";$0;" "E+1{" $2
  IfErrors nao_esta_no_path caminho_ja_esta

  nao_esta_no_path:
  ; Acrescenta cuidando do separador: um PATH vazio não pode começar com `;`,
  ; e um que já termina em `;` não pode ganhar outro.
  StrCmp $1 "" 0 +3
    StrCpy $3 "$0"
    Goto grava
  StrCpy $4 "$1" 1 -1
  StrCmp $4 ";" 0 +3
    StrCpy $3 "$1$0"
    Goto grava
  StrCpy $3 "$1;$0"

  grava:
  WriteRegExpandStr HKCU "Environment" "PATH" "$3"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  caminho_ja_esta:
!macroend

!macro customUnInstall
  ; Tirar a entrada do PATH é parte de desinstalar. Deixá-la para trás acumula
  ; caminhos mortos no perfil de quem instala e desinstala algumas vezes.
  StrCpy $0 "$INSTDIR\resources\python-backend"
  ReadRegStr $1 HKCU "Environment" "PATH"
  StrCmp $1 "" fim_desinstalacao

  ; `un.` obrigatório aqui: o desinstalador é um binário separado e não enxerga
  ; as funções declaradas para o instalador.
  ;
  ; Remove nas três formas em que a entrada pode aparecer: no meio (`;dir;`),
  ; no fim (`;dir`) e sozinha (`dir`). A ordem importa — tratar o caso do meio
  ; primeiro evita que a remoção deixe dois separadores colados.
  ${un.WordReplace} "$1" ";$0;" ";" "+" $2
  ${un.WordReplace} "$2" ";$0" "" "+" $3
  ${un.WordReplace} "$3" "$0" "" "+" $4

  WriteRegExpandStr HKCU "Environment" "PATH" "$4"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  fim_desinstalacao:
  ; A credencial da CLI e o arquivo de sessão ficam no `userData`, que o
  ; desinstalador do electron-builder não apaga de propósito — junto com eles
  ; está o cofre, e apagar documentos do usuário sem perguntar seria pior que
  ; deixar rastro. Quem quer limpar tudo usa "Esvaziar o cofre" antes.
!macroend
