@echo off
cd /d "%~dp0"
echo ============================================================
echo   WSU Predatory Journal Scan
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "node '%~dp0wsu_predatory_scan.js'; if ($LASTEXITCODE -eq 0) { Start-Process '%~dp0wsu_predatory_report.html' } else { Write-Host 'Scan did not complete. See error above.' -ForegroundColor Red }"
echo.
pause
