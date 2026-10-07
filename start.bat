@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not found on PATH.
  pause
  exit /b 1
)

REM Already running?
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3456/api/health; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Server is already running: http://127.0.0.1:3456
  start "" "http://127.0.0.1:3456"
  exit /b 0
)

echo Starting UPSC CSE Prelims Simulator...
start "UPSC Prelims Simulator" cmd /k node src\server.js

REM Wait for the server, then open the browser.
powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:3456/api/health; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 250 } exit 1" >nul
if errorlevel 1 (
  echo [ERROR] Server did not start - check the "UPSC Prelims Simulator" window for errors.
  pause
  exit /b 1
)

echo Server running: http://127.0.0.1:3456
echo Close it with stop.bat or by typing Ctrl+C in the server window.
start "" "http://127.0.0.1:3456"
endlocal
