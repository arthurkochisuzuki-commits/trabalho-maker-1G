@echo off
title BioPhysio MedTech - Servidor Local
cd /d "%~dp0"
echo =======================================================
echo    Iniciando BioPhysio MedTech...
echo =======================================================
node server.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Node.js nao encontrado, abrindo diretamente no navegador...
    start "" "index.html"
)
pause
