@echo off
echo ============================================
echo   Solar Tracker Dashboard - Starting...
echo ============================================
echo.
echo Installing dependencies...
call npm install
echo.
echo Starting Solar Tracker Dashboard...
start http://localhost:3000
node server.js
pause
