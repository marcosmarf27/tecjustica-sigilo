; Hook de instalação do TecJustiça Sigilo.
;
; ## O problema que isto resolve
;
; A CLI existe desde a v1, mas só era instalada se o usuário encontrasse a tela
; "Linha de Comando" e clicasse no botão. Quem instalava e ia direto usar o
; programa nunca descobria que `tecjustica-sigilo` existia — e o critério de
; aceitação desta versão é justamente: depois de instalar, `tecjustica-sigilo
; status` roda num `cmd` novo **sem** o usuário ter aberto a interface.
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
; Escrever no registro não avisa ninguém. Sem o `WM_SETTINGCHANGE`, o PATH novo
; só aparece depois de logout ou reboot, e o usuário conclui que a instalação
; falhou. O broadcast faz o Explorer reler o ambiente, e todo `cmd` aberto a
; partir dali já enxerga.

!macro customInstall
  ; O diretório onde vive o `tecjustica-sigilo.cmd`, dentro da instalação.
  StrCpy $0 "$INSTDIR\resources\python-backend"

  ; Lê o PATH do usuário direto do registro. `EnvVarUpdate` e afins expandem
  ; variáveis e truncam em 1024 caracteres; aqui se lê o valor cru.
  ReadRegStr $1 HKCU "Environment" "PATH"

  ; Já está lá? Instalar duas vezes não pode duplicar a entrada.
  ${WordFind} "$1" "$0" "E+1{" $2
  StrCmp $2 "$1" 0 caminho_ja_esta

  ; Acrescenta, cuidando do ponto-e-vírgula: um PATH vazio não pode começar com
  ; separador, e um que já termina em `;` não pode ganhar outro.
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

  ; Avisa o sistema. Sem isto, só depois de reiniciar a sessão.
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  caminho_ja_esta:
!macroend

!macro customUnInstall
  ; Tirar a entrada do PATH é parte de desinstalar. Deixá-la para trás acumula
  ; caminhos mortos no perfil de quem instala e desinstala algumas vezes.
  StrCpy $0 "$INSTDIR\resources\python-backend"
  ReadRegStr $1 HKCU "Environment" "PATH"

  ; Remove nas três formas em que a entrada pode aparecer: no meio (`;dir;`),
  ; no fim (`;dir`) e sozinha (`dir`).
  ${WordReplace} "$1" ";$0;" ";" "+" $2
  ${WordReplace} "$2" ";$0" "" "+" $3
  ${WordReplace} "$3" "$0" "" "+" $4

  WriteRegExpandStr HKCU "Environment" "PATH" "$4"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; A credencial da CLI e o arquivo de sessão ficam no `userData`, que o
  ; desinstalador do electron-builder não apaga de propósito — junto com eles
  ; está o cofre, e apagar documentos do usuário sem perguntar seria pior que
  ; deixar rastro. Quem quer limpar tudo usa "Esvaziar o cofre" antes.
!macroend
