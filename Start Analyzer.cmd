@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js could not be found.
    echo Install Node.js 22 or newer, then run this file again.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Project dependencies are missing.
  echo Run pnpm install before starting the analyzer.
  pause
  exit /b 1
)

echo Starting Scan and Fourier Analyzer...
echo Keep this window open while using the application.
echo.
"%NODE_EXE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort --open

if errorlevel 1 (
  echo.
  echo The analyzer stopped because of the error shown above.
  pause
)
