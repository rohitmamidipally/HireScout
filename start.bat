@echo off
:: HireScout — Windows startup script
:: Double-click this file to launch HireScout

echo.
echo   HireScout — Hiring Outreach Agent
echo   ===================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo   ERROR: Node.js not found.
  echo.
  echo   Install it from: https://nodejs.org  ^(LTS version^)
  echo   Then double-click this file again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   Node.js %NODE_VER% detected
echo.

:: Check app file
if not exist "hiring-agent.html" (
  echo   ERROR: hiring-agent.html not found.
  echo   Make sure server.js and hiring-agent.html are in the same folder.
  echo.
  pause
  exit /b 1
)

echo   hiring-agent.html found
echo.
echo   Starting proxy server on port 3747...
echo.

:: Start server in background and open browser
start "" /B node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3747"

echo   Server running at http://localhost:3747
echo   Close this window to stop the server.
echo.
pause
