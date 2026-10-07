@echo off
setlocal
echo Stopping UPSC CSE Prelims Simulator...

powershell -NoProfile -Command "$n = 0; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'src[\\/]server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; if ($n -gt 0) { Write-Output ('Stopped ' + $n + ' server process(es).') } else { Write-Output 'No running server process found.' }"

powershell -NoProfile -Command "Start-Sleep -Seconds 1"

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3456/api/health | Out-Null; Write-Output 'WARNING: port 3456 still responding - something else may be using it.' } catch { Write-Output 'Port 3456 is free.' }"
endlocal
