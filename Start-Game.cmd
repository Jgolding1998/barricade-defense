@echo off
rem Start Barricade Defense on this computer only (127.0.0.1).
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
start "" http://127.0.0.1:8792/
%PY% serve.py --port 8792
if errorlevel 1 pause
