@echo off
rem ---------------------------------------------------------------------------
rem DSH Desktop Instance Hub - one-click launcher (thin shell)
rem
rem All real work lives in scripts\hub-doctor.ps1, which diagnoses, repairs,
rem launches, verifies against real process state, and retries once on failure.
rem
rem ASCII only: cmd.exe uses the OEM code page, so non-ASCII text here garbles -
rem the same class of bug that made a non-ASCII .ps1 abort with a bogus error.
rem ---------------------------------------------------------------------------
title DSH Hub Launcher
if defined DSH_HUB_ROOT (set "HUB_ROOT=%DSH_HUB_ROOT%") else (set "HUB_ROOT=%~dp0..")
for %%I in ("%HUB_ROOT%") do set "HUB_ROOT=%%~fI"

rem Electron inherits this from a DSH host shell and would then run as plain Node,
rem rejecting its own switches with "bad option: --user-data-dir".
set "ELECTRON_RUN_AS_NODE="

echo ============================================================
echo   DSH Desktop Instance Hub - starting
echo   hub root: %HUB_ROOT%
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HUB_ROOT%\scripts\hub-doctor.ps1" -HubRoot "%HUB_ROOT%"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo ------------------------------------------------------------
  echo   START FAILED ^(exit code %RC%^)
  echo   The launcher already tried to repair everything it knows how to.
  echo   Diagnostics were written to: %HUB_ROOT%\logs\
  echo   Read section 11 of the usage guide on your Desktop next.
  echo ------------------------------------------------------------
  echo.
  pause
  exit /b %RC%
)

rem Give the user a moment to read the summary, then close automatically.
ping -n 6 127.0.0.1 >nul
exit /b 0
