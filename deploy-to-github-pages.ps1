# GitHub Pages Deployment Script
# Run this script after installing Git

Write-Host "🚀 GitHub Pages Deployment Script" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check if Git is installed
Write-Host "Checking for Git installation..." -ForegroundColor Yellow
$gitInstalled = Get-Command git -ErrorAction SilentlyContinue

if (-not $gitInstalled) {
    Write-Host "❌ Git is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Git first:" -ForegroundColor Yellow
    Write-Host "1. Download from: https://git-scm.com/download/win" -ForegroundColor White
    Write-Host "2. Install with default settings" -ForegroundColor White
    Write-Host "3. Restart PowerShell" -ForegroundColor White
    Write-Host "4. Run this script again" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use GitHub Desktop (easier):" -ForegroundColor Yellow
    Write-Host "Download from: https://desktop.github.com/" -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Git is installed!" -ForegroundColor Green
Write-Host ""

# Check if already initialized
if (Test-Path .git) {
    Write-Host "✅ Git repository already initialized" -ForegroundColor Green
} else {
    Write-Host "Initializing Git repository..." -ForegroundColor Yellow
    git init
    Write-Host "✅ Git repository initialized" -ForegroundColor Green
}

Write-Host ""

# Check if remote exists
$remoteExists = git remote -v 2>$null | Select-String "origin"

if ($remoteExists) {
    Write-Host "✅ Remote repository already configured" -ForegroundColor Green
} else {
    Write-Host "⚠️  Remote repository not configured" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please complete these steps:" -ForegroundColor Cyan
    Write-Host "1. Create a new repository on GitHub:" -ForegroundColor White
    Write-Host "   https://github.com/new" -ForegroundColor White
    Write-Host "2. Repository name: WearableOverlayTimeline" -ForegroundColor White
    Write-Host "3. Make it Public or Private (your choice)" -ForegroundColor White
    Write-Host "4. DO NOT initialize with README" -ForegroundColor White
    Write-Host "5. Click 'Create repository'" -ForegroundColor White
    Write-Host ""
    
    $username = Read-Host "Enter your GitHub username"
    
    Write-Host ""
    Write-Host "Adding remote repository..." -ForegroundColor Yellow
    git remote add origin "https://github.com/$username/WearableOverlayTimeline.git"
    Write-Host "✅ Remote repository added" -ForegroundColor Green
}

Write-Host ""

# Stage all files
Write-Host "Staging files..." -ForegroundColor Yellow
git add .

# Check if there are changes to commit
$status = git status --porcelain

if ($status) {
    Write-Host "Creating commit..." -ForegroundColor Yellow
    git commit -m "Initial commit: Wearable Timeline App"
    Write-Host "✅ Commit created" -ForegroundColor Green
} else {
    Write-Host "✅ No changes to commit" -ForegroundColor Green
}

Write-Host ""

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
Write-Host "(You may be prompted to sign in)" -ForegroundColor Gray

$branch = git branch --show-current
if (-not $branch) {
    git branch -M main
    $branch = "main"
}

git push -u origin $branch

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Pushed to GitHub successfully!" -ForegroundColor Green
} else {
    Write-Host "⚠️  Push failed. You may need to:" -ForegroundColor Yellow
    Write-Host "  - Sign in to GitHub" -ForegroundColor White
    Write-Host "  - Configure Git credentials" -ForegroundColor White
    Write-Host "  - Use GitHub Desktop instead (easier)" -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to continue anyway"
}

Write-Host ""

# Deploy to GitHub Pages
Write-Host "Building and deploying to GitHub Pages..." -ForegroundColor Yellow
npm run deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Go to your repository on GitHub" -ForegroundColor White
    Write-Host "2. Click 'Settings' tab" -ForegroundColor White
    Write-Host "3. Click 'Pages' in the left sidebar" -ForegroundColor White
    Write-Host "4. Under 'Branch', select 'gh-pages' and click Save" -ForegroundColor White
    Write-Host "5. Wait 2-3 minutes" -ForegroundColor White
    Write-Host ""
    Write-Host "Your app will be live at:" -ForegroundColor Cyan
    
    $username = git config user.name
    if (-not $username) {
        $username = "YOUR_USERNAME"
    }
    
    Write-Host "https://$username.github.io/WearableOverlayTimeline/" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    Write-Host "Please check the error messages above" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
