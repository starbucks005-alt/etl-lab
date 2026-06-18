@echo off
cd /d "%~dp0"
echo ============================================================
echo   WSU Predatory Journal Scan
echo ============================================================
echo.

:: ── Find node.exe ──────────────────────────────────────────────
set "NODE="

where node >nul 2>&1
if %errorlevel% equ 0 set "NODE=node"

if "%NODE%"=="" (
  if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
)
if "%NODE%"=="" (
  if exist "%~dp0.wsu_node\node.exe" set "NODE=%~dp0.wsu_node\node.exe"
)

:: ── Download portable node.exe if still not found (~30MB, once) ──
if "%NODE%"=="" (
  echo Node.js not found. Downloading portable version -- one time, about 30MB...
  echo.
  if not exist "%~dp0.wsu_node" mkdir "%~dp0.wsu_node"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/win-x64/node.exe', '%~dp0.wsu_node\node.exe'); Write-Host 'Download complete.' } catch { Write-Host ('Download failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
  if not exist "%~dp0.wsu_node\node.exe" (
    echo.
    echo Download failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  set "NODE=%~dp0.wsu_node\node.exe"
  echo.
)

:: ── Run scan ───────────────────────────────────────────────────
echo Running scan ^(first run takes 3-5 minutes^)...
echo.
"%NODE%" "%~dp0wsu_predatory_scan.js"

if %errorlevel% equ 0 (
  echo.
  echo Opening report in browser...
  start "" "%~dp0wsu_predatory_report.html"
) else (
  echo.
  echo Scan did not complete. See error above.
)
echo.
pause
