@echo off
rem Long Novel MCP one-click installer (Windows).
rem Double-click this file. It runs install-windows.ps1 next to it.
rem (All Chinese messages live in the .ps1, which is UTF-8 with BOM.)
if not exist "%~dp0install-windows.ps1" (
  echo Cannot find install-windows.ps1.
  echo Please put install-windows.bat and install-windows.ps1 in the same folder, then double-click install-windows.bat.
  echo.
  echo Press any key to close...
  pause >nul
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
echo Installer finished. Press any key to close...
pause >nul
