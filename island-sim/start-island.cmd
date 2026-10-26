@echo off
setlocal
cd /d "%~dp0"
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell is unavailable.
  pause
  exit /b 1
)

echo [1] Start Island Sim
echo [2] Stop a verified Island Sim server
echo [3] Reboot a verified Island Sim server
choice /c 123 /t 5 /d 1 /n /m "Choose an action (defaults to Start in 5 seconds): "
if errorlevel 4 goto invalid_choice
if errorlevel 3 goto reboot
if errorlevel 2 goto stop

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0island-launcher.ps1" -Action Start
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"
goto finish

:reboot
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0island-launcher.ps1" -Action Stop
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"
if not "%LAUNCHER_EXIT_CODE%"=="0" goto finish
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0island-launcher.ps1" -Action Start
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"
goto finish

:stop
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0island-launcher.ps1" -Action Stop
set "LAUNCHER_EXIT_CODE=%ERRORLEVEL%"

:finish
if not "%LAUNCHER_EXIT_CODE%"=="0" call :show_failure
if "%LAUNCHER_EXIT_CODE%"=="0" call :show_completion
exit /b %LAUNCHER_EXIT_CODE%

:invalid_choice
echo Could not read a valid launcher action.
exit /b 1

:show_completion
echo.
echo Press any key to close this launcher window.
pause >nul
exit /b 0

:show_failure
echo.
powershell.exe -NoLogo -NoProfile -Command "$message = -join [char[]](0x555F,0x52D5,0x5931,0x6557,0xFF1A,0x8ACB,0x67E5,0x770B,0x4E0A,0x65B9,0x932F,0x8AA4,0x8A0A,0x606F,0x3002); Write-Host $message -ForegroundColor Red"
pause >nul
exit /b 0
