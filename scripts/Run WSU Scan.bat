@echo off
cd /d "%~dp0"
echo ============================================================
echo   WSU Predatory Journal Scan
echo ============================================================
echo.
node wsu_predatory_scan.js
if %errorlevel% equ 0 (
  echo.
  echo Opening report in browser...
  start "" "wsu_predatory_report.html"
) else (
  echo.
  echo Scan did not complete. See error above.
)
echo.
pause
