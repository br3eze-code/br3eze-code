@echo off
title AgentOS Control Panel
cd /d C:\path\to\br3eze-code
echo ========================================
echo AgentOS Fleet Control Panel
echo ========================================
echo.
echo [1] Start AgentOS Server
echo [2] Stop AgentOS Server
echo [3] View Logs
echo [4] Open VSCode Extension
echo [5] Open Chrome Extension Folder
echo [6] Memory Dump
echo [7] Onboard All Routers
echo [8] Brand All Hotspots
echo [9] Exit
echo.
set /p choice="Select option: "

if "%choice%"=="1" start "AgentOS" cmd /k "npm start"
if "%choice%"=="2" pm2 stop agentos
if "%choice%"=="3" start "Logs" cmd /k "pm2 logs agentos"
if "%choice%"=="4" code extensions\vscode-agentos
if "%choice%"=="5" explorer extensions\chrome-agentos
if "%choice%"=="6" start "" http://localhost:3000/api/memory?token=YOUR_TOKEN
if "%choice%"=="7" start "" http://localhost:3000/api/onboard?target=all&token=YOUR_TOKEN
if "%choice%"=="8" start "" http://localhost:3000/api/hotspot-brand?target=all&token=YOUR_TOKEN
if "%choice%"=="9" exit

pause
goto :eof
