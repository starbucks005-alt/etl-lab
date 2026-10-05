@echo off
rem Sets Dr. O's owner bypass in the browsers on this laptop, once.
rem Put this file and a file called key.txt (one line, the key, nothing else) together on the flash drive.
rem The key is NOT stored in this file or in the repository.
setlocal
cd /d "%~dp0"

if not exist "key.txt" (
  echo key.txt is not in this folder. Put it next to this file and try again.
  pause
  exit /b 1
)

set "KEY="
set /p KEY=<"key.txt"
if "%KEY%"=="" (
  echo key.txt is empty. Put the key on the first line and try again.
  pause
  exit /b 1
)

echo.
echo Setting the bypass in each browser on this laptop.
echo Each browser will open four pages for a moment. Let them load, then close them.
echo.

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "FIREFOX=%ProgramFiles%\Mozilla Firefox\firefox.exe"
set "DONE=0"

if exist "%EDGE%" (
  echo Edge found.
  start "" "%EDGE%" "https://emerging-tech-lab.com/studio.html?key=%KEY%" "https://emerging-tech-lab.com/good-company/index.html?key=%KEY%" "https://emerging-tech-lab.com/almost-human.html?key=%KEY%" "https://emerging-tech-lab.com/app.html?event=1"
  set "DONE=1"
)
if exist "%CHROME%" (
  echo Chrome found.
  start "" "%CHROME%" "https://emerging-tech-lab.com/studio.html?key=%KEY%" "https://emerging-tech-lab.com/good-company/index.html?key=%KEY%" "https://emerging-tech-lab.com/almost-human.html?key=%KEY%" "https://emerging-tech-lab.com/app.html?event=1"
  set "DONE=1"
)
if exist "%FIREFOX%" (
  echo Firefox found.
  start "" "%FIREFOX%" "https://emerging-tech-lab.com/studio.html?key=%KEY%" "https://emerging-tech-lab.com/good-company/index.html?key=%KEY%" "https://emerging-tech-lab.com/almost-human.html?key=%KEY%" "https://emerging-tech-lab.com/app.html?event=1"
  set "DONE=1"
)

if "%DONE%"=="0" (
  echo I did not find Edge, Chrome or Firefox in the usual places.
  echo Open a browser yourself and go to https://emerging-tech-lab.com/studio.html?key=  followed by the key.
)

echo.
echo When the pages have loaded, close the browsers. Then take the flash drive out.
pause
endlocal
