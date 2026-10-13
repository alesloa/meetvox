<#
.SYNOPSIS
  One-shot Windows setup for Meetvox: installs deps, rebuilds the native audio addon
  for Electron, and checks (or fetches) the bundled binaries.

.DESCRIPTION
  Run this from the repo root in PowerShell on a Windows x64 machine:

      powershell -ExecutionPolicy Bypass -File .\setup-win.ps1

  Steps:
    1. Verify Node + npm.
    2. npm install.
    3. Rebuild naudiodon2 (the PortAudio addon) for the Electron ABI.
    4. Check resources\win-x64\ for whisper-cli.exe + ffmpeg.exe.
       Pass -BuildBinaries to build them from pinned sources.

  After it finishes, run the app with `npm run dev` (or build the installer with
  `npm run dist:win`).

.PARAMETER BuildBinaries
  Build whisper-cli.exe (+ its DLLs) and ffmpeg.exe into resources\win-x64\ by running
  scripts/binaries/build.sh through bash (WSL). Inside WSL that needs either Docker or:
      sudo apt install g++-mingw-w64-x86-64-posix cmake make git curl xz-utils
  Without this switch the script only checks for them. You can also run
  `npm run binaries:win` on a Mac or Linux machine and copy resources\win-x64\ here.

.PARAMETER SkipInstall
  Skip `npm install` + the native rebuild (use when deps are already set up and you
  only want the binary check/fetch).
#>
param(
  [switch]$BuildBinaries,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$winDir = Join-Path $root 'resources\win-x64'
$whisper = Join-Path $winDir 'whisper-cli.exe'
$ffmpeg = Join-Path $winDir 'ffmpeg.exe'

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !! $m" -ForegroundColor Yellow }

# --- 0. Sanity -------------------------------------------------------------
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw "setup-win.ps1 is for Windows. Run it on a Windows x64 machine."
}
Info "Meetvox Windows setup (root: $root)"

# --- 1. Node + npm ---------------------------------------------------------
Info "Checking Node + npm"
foreach ($tool in 'node', 'npm') {
  $cmd = Get-Command $tool -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$tool not found. Install Node.js LTS from https://nodejs.org and re-run." }
}
Ok "node $(node --version), npm $(npm --version)"

# --- 2 + 3. Install + native rebuild --------------------------------------
if ($SkipInstall) {
  Warn "Skipping npm install + native rebuild (-SkipInstall)"
} else {
  Info "npm install"
  npm install
  Ok "dependencies installed"

  Info "Rebuilding native deps (naudiodon2) for the Electron ABI"
  # electron-builder install-app-deps rebuilds native addons against Electron's ABI,
  # the same step the Mac side uses. Without it, naudiodon2 loads against system Node
  # and throws NODE_MODULE_VERSION mismatch at runtime.
  npx electron-builder install-app-deps
  Ok "naudiodon2 rebuilt for Electron"
}

# --- 4. Binaries -----------------------------------------------------------
New-Item -ItemType Directory -Force -Path $winDir | Out-Null

function Build-Binaries {
  # Both are built from pinned sources with mingw-w64 (see scripts\binaries\). That
  # avoids the Visual C++ runtime the official whisper.cpp build needs, and keeps
  # ffmpeg LGPL (the gyan.dev builds are GPL).
  if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
    throw "bash not found. Install WSL (wsl --install), or run 'npm run binaries:win' on a Mac or Linux machine and copy resources\win-x64\ here."
  }
  Info "Building whisper-cli.exe + ffmpeg.exe (scripts/binaries/build.sh win)"
  bash scripts/binaries/build.sh win
  if ($LASTEXITCODE -ne 0) { throw "Building the binaries failed (see the output above)." }
  Ok "whisper-cli.exe (+ DLLs) and ffmpeg.exe -> resources\win-x64\"
}

if ($BuildBinaries -and -not ((Test-Path $whisper) -and (Test-Path $ffmpeg))) {
  Build-Binaries
}
Info "Checking bundled binaries"
if (Test-Path $whisper) { Ok "whisper-cli.exe present" } else { Warn "MISSING whisper-cli.exe  (re-run with -BuildBinaries, or see resources\win-x64\README.md)" }
if (Test-Path $ffmpeg)  { Ok "ffmpeg.exe present" }      else { Warn "MISSING ffmpeg.exe  (re-run with -BuildBinaries, or see resources\win-x64\README.md)" }

# --- Summary ---------------------------------------------------------------
Write-Host ""
Info "Done. Next:"
Write-Host "    npm run dev                      # run the app"
Write-Host "    npm run dist:win                 # build the installer"
Write-Host ""
Write-Host "System audio: install VB-Cable (https://vb-audio.com/Cable/), set it as the"
Write-Host "Windows default OUTPUT, and pick 'CABLE Output (VB-Audio)' as System Audio in"
Write-Host "the app. The Whisper model you pick (574 MB by default) downloads on first"
Write-Host "transcribe to %USERPROFILE%\.meetvox\models\."
