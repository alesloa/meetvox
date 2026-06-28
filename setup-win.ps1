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
       Pass -FetchBinaries to download them from official sources automatically.

  After it finishes, run the app with `npm run dev` (or build with
  `npx electron-builder --win nsis`).

.PARAMETER FetchBinaries
  Download whisper-cli.exe (whisper.cpp latest release) and ffmpeg.exe (gyan.dev
  static build) into resources\win-x64\. Without this switch the script only checks
  for them and prints where to get them.

.PARAMETER SkipInstall
  Skip `npm install` + the native rebuild (use when deps are already set up and you
  only want the binary check/fetch).
#>
param(
  [switch]$FetchBinaries,
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

function Fetch-Whisper {
  Info "Fetching whisper.cpp Windows release"
  $api = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'
  $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'meetvox-setup' }
  $asset = $rel.assets | Where-Object { $_.name -match 'win.*x64.*\.zip$|whisper-bin-x64.*\.zip$' } | Select-Object -First 1
  if (-not $asset) { throw "No win-x64 zip in the latest whisper.cpp release. Build from source (see resources\win-x64\README.md)." }
  $zip = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
  $tmp = Join-Path $env:TEMP ('whisper_' + [System.IO.Path]::GetFileNameWithoutExtension($asset.name))
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force

  # The CLI is whisper-cli.exe (recent) or main.exe (older). Copy it + every DLL next
  # to it (whisper.dll / ggml*.dll) so the exe resolves its deps from its own folder.
  $cli = Get-ChildItem $tmp -Recurse -File | Where-Object { $_.Name -in 'whisper-cli.exe', 'main.exe' } | Select-Object -First 1
  if (-not $cli) { throw "whisper-cli.exe not found in the release zip." }
  Copy-Item $cli.FullName $whisper -Force
  Get-ChildItem $cli.Directory -Filter '*.dll' | ForEach-Object { Copy-Item $_.FullName (Join-Path $winDir $_.Name) -Force }
  Ok "whisper-cli.exe (+ DLLs) -> resources\win-x64\"
}

function Fetch-Ffmpeg {
  Info "Fetching ffmpeg static (gyan.dev essentials)"
  $url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  $zip = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip
  $tmp = Join-Path $env:TEMP 'ffmpeg_extract'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem $tmp -Recurse -File | Where-Object { $_.Name -eq 'ffmpeg.exe' } | Select-Object -First 1
  if (-not $exe) { throw "ffmpeg.exe not found in the gyan.dev zip." }
  Copy-Item $exe.FullName $ffmpeg -Force
  Ok "ffmpeg.exe -> resources\win-x64\"
}

if ($FetchBinaries) {
  if (Test-Path $whisper) { Ok "whisper-cli.exe already present" } else { Fetch-Whisper }
  if (Test-Path $ffmpeg)  { Ok "ffmpeg.exe already present" }      else { Fetch-Ffmpeg }
} else {
  Info "Checking bundled binaries"
  if (Test-Path $whisper) { Ok "whisper-cli.exe present" } else { Warn "MISSING whisper-cli.exe  (re-run with -FetchBinaries, or see resources\win-x64\README.md)" }
  if (Test-Path $ffmpeg)  { Ok "ffmpeg.exe present" }      else { Warn "MISSING ffmpeg.exe  (re-run with -FetchBinaries, or see resources\win-x64\README.md)" }
}

# --- Summary ---------------------------------------------------------------
Write-Host ""
Info "Done. Next:"
Write-Host "    npm run dev                      # run the app"
Write-Host "    npx electron-builder --win nsis  # build the installer"
Write-Host ""
Write-Host "System audio: install VB-Cable (https://vb-audio.com/Cable/), set it as the"
Write-Host "Windows default OUTPUT, and pick 'CABLE Output (VB-Audio)' as System Audio in"
Write-Host "the app. The 1 GB model auto-downloads on first transcribe to %USERPROFILE%\.meetvox\models\."
