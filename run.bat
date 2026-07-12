@echo off
REM Lanzador de Cuadernillo para Windows sin tocar la Execution Policy.
REM Ejecuta run.ps1 con Bypass solo para esta llamada.
REM   Doble clic  -> tarea "dev" (arranca en desarrollo)
REM   run.bat build / setup / release 0.1.2  -> pasa los argumentos al script
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
