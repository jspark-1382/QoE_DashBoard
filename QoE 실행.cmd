@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-qoe.ps1" %*
set "qoe_exit=%ERRORLEVEL%"
if not "%qoe_exit%"=="0" pause
exit /b %qoe_exit%
