@echo off
chcp 65001 >nul
title DataInfra-RedactionEverything Dev
cd /d "%~dp0"
where wsl.exe >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%i in ('wsl.exe wslpath -a "%cd%"') do set WSL_CWD=%%i
  echo Starting local dev by reusing healthy services when possible...
  echo If this fails, run in WSL: npm run doctor
  echo Next commands: npm run setup ^| npm run dev:attach ^| docker compose up -d ^| docker compose --profile gpu up -d
  wsl.exe --cd "%WSL_CWD%" -- /usr/bin/bash scripts/start-dev-services.sh
  if errorlevel 1 (
    echo WSL --cd failed; retrying with an explicit bash cd...
    wsl.exe -- /usr/bin/bash -lc "cd '%WSL_CWD%' && bash scripts/start-dev-services.sh"
  )
) else (
  echo WSL not found. PaddlePaddle GPU 3.3.0 local dev is configured for WSL/Linux venv.
  echo Browser UI/API smoke without local GPU setup: docker compose up -d
  echo GPU full stack with Docker: docker compose --profile gpu up -d
  echo Local full dev: open WSL in this repo and run npm run doctor, then npm run setup and npm run dev:attach
  pause
)
