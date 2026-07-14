@echo off
setlocal enabledelayedexpansion

set SCRIPT_NAME=server.js
set RESTART_COUNT=0

:loop
echo.
echo ============================================================
echo  [%date% %time%] Menjalankan %SCRIPT_NAME% ...
echo  Buka browser ke http://localhost:3000 setelah ini jalan
echo ============================================================
echo.

node "%SCRIPT_NAME%"
set EXIT_CODE=%ERRORLEVEL%
set /a RESTART_COUNT+=1

echo.
echo  [%date% %time%] Server berhenti dengan exit code %EXIT_CODE%. Restart ke-%RESTART_COUNT%...
echo.

if %EXIT_CODE% EQU 0 (
    echo Server berhenti normal, tidak di-restart.
    pause
    exit /b 0
)

timeout /t 5 /nobreak > nul
goto loop