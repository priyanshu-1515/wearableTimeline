@echo off
echo Initializing Git Repository...
echo.

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed!
    echo.
    echo Please install Git first:
    echo 1. Download from: https://git-scm.com/download/win
    echo 2. Install with default settings
    echo 3. Restart this script
    echo.
    pause
    exit /b 1
)

echo Git found! Initializing repository...
echo.

REM Initialize Git
git init

echo.
echo Repository initialized!
echo.
echo Now you can:
echo 1. Open GitHub Desktop
echo 2. Add this repository (File -^> Add Local Repository)
echo 3. Publish to GitHub
echo.
pause
