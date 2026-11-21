@echo off
rem A PORTA da bancada da IEADESPA: de DOIS CLIQUES neste arquivo, num computador novo ou para atualizar.
rem  - Sem a bancada no computador: baixa o repositorio privado IEADESPA/bancada em C:\MCP\bancada (git clone). O login
rem    do GitHub abre no navegador: quem faz e a pessoa.
rem  - Com a bancada: atualiza (git pull --ff-only; mudanca local nunca e atropelada).
rem  - Nos dois casos, chama o instalador da bancada, que pergunta antes de cada mudanca. Repasse -SoTestar (so mostra
rem    o que faria; sem a bancada, baixa numa pasta temporaria so para mostrar) ou -Sim (com a licenca da pessoa).
rem Modelo desta porta: C:\MCP\bancada\porta (o aviso de inicio avisa quando esta copia fica velha).
chcp 65001 >nul
setlocal
if defined BANCADA_BASE (set "BASE=%BANCADA_BASE%") else (set "BASE=C:\MCP")
if defined BANCADA_URL (set "URL=%BANCADA_URL%") else (set "URL=https://github.com/IEADESPA/bancada.git")
set "BANCADA=%BASE%\bancada"
for %%P in ("%~dp0..\..") do set "PROJETO=%%~fP"
set "SOTESTAR="
for %%A in (%*) do if /i "%%~A"=="-SoTestar" set "SOTESTAR=1"
for %%A in (%*) do if /i "%%~A"=="-Simular" set "SOTESTAR=1"
set CODIGO=1

where git >nul 2>nul
if errorlevel 1 (
  echo Falta o Git. Instale com:  winget install Git.Git
  echo Depois feche e abra esta janela e de dois cliques de novo.
  goto :fim
)
where node >nul 2>nul
if errorlevel 1 (
  echo Falta o Node.js 22 ou mais novo. Instale com:  winget install OpenJS.NodeJS.LTS
  echo Depois feche e abra esta janela, e tambem o VS Code, e de dois cliques de novo.
  goto :fim
)

if exist "%BANCADA%\.git" goto :atualizar
if defined SOTESTAR goto :testar_sem_bancada

echo Baixando a bancada em %BANCADA% (o login do GitHub pode abrir no navegador)...
if not exist "%BASE%" mkdir "%BASE%"
git clone "%URL%" "%BANCADA%"
if errorlevel 1 (
  echo Nao consegui baixar a bancada. Confira a internet e o login do GitHub (a conta precisa de acesso a IEADESPA/bancada^).
  goto :fim
)
goto :instalar

:atualizar
echo Atualizando a bancada em %BANCADA%...
git -C "%BANCADA%" pull --ff-only
if errorlevel 1 echo Aviso: nao atualizei a bancada (mudanca local ou sem internet^). Sigo com a que esta no computador.
goto :instalar

:testar_sem_bancada
echo [so testar] baixaria a bancada em %BANCADA% (git clone %URL%).
echo [so testar] Para mostrar o resto, baixo numa pasta temporaria, que depois apago:
set "TEMPB=%TEMP%\bancada-so-testar-%RANDOM%"
git clone --quiet "%URL%" "%TEMPB%"
if errorlevel 1 (
  echo Nao consegui baixar a bancada nem para testar. Confira a internet e o login do GitHub.
  goto :fim
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMPB%\instalar.ps1" -Projeto "%PROJETO%" -Base "%BASE%" %*
set CODIGO=%ERRORLEVEL%
rmdir /s /q "%TEMPB%"
goto :fim

:instalar
powershell -NoProfile -ExecutionPolicy Bypass -File "%BANCADA%\instalar.ps1" -Projeto "%PROJETO%" -Base "%BASE%" %*
set CODIGO=%ERRORLEVEL%

:fim
echo.
if "%~1"=="" pause
exit /b %CODIGO%
