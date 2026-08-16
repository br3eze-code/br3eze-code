# AgentOS user-local Windows installer
# Recommended remote usage:
#   Invoke-WebRequest https://br3eze.africa/install.ps1 -OutFile $env:TEMP\agentos-install.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\agentos-install.ps1
[CmdletBinding()]
param(
  [string]$Ref = $(if ($env:AGENTOS_REF) { $env:AGENTOS_REF } else { 'main' }),
  [string]$Profile = $(if ($env:AGENTOS_PROFILE) { $env:AGENTOS_PROFILE } else { 'default' }),
  [string]$InstallDir = $(if ($env:AGENTOS_INSTALL_DIR) { $env:AGENTOS_INSTALL_DIR } else { Join-Path $HOME '.agentos\app' }),
  [switch]$Desktop,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoUrl = if ($env:AGENTOS_REPO_URL) { $env:AGENTOS_REPO_URL } else { 'https://github.com/br3eze-code/br3eze-code.git' }
$ProfileDir = if ($Profile -eq 'default') { Join-Path $HOME '.agentos' } else { Join-Path $HOME ".agentos-$Profile" }
$BinDir = Join-Path $HOME '.agentos\bin'

function Info([string]$Message) { Write-Host "[AgentOS] $Message" -ForegroundColor Green }
function Fail([string]$Message) { throw "[AgentOS] $Message" }

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js 22 or newer is required. Install it from https://nodejs.org/.' }
if (-not $npm) { Fail 'npm is required.' }
if (-not $git) { Fail 'git is required.' }
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) { Fail "Node.js 22 or newer is required; found $(& node --version)." }

New-Item -ItemType Directory -Force -Path $ProfileDir, $BinDir | Out-Null
if (Test-Path (Join-Path $InstallDir '.git')) {
  Info "Updating existing AgentOS checkout at $InstallDir"
  & git -C $InstallDir fetch --depth 1 origin $Ref
  & git -C $InstallDir checkout --force FETCH_HEAD
} elseif (Test-Path $InstallDir) {
  $items = Get-ChildItem -Force $InstallDir -ErrorAction SilentlyContinue
  if ($items -and -not $Force) { Fail "Install directory is not empty: $InstallDir (use -Force only if disposable)" }
  if ($items) { Remove-Item -Recurse -Force $InstallDir }
  Info "Cloning AgentOS ref $Ref"
  & git clone --depth 1 --branch $Ref $RepoUrl $InstallDir
} else {
  Info "Cloning AgentOS ref $Ref"
  & git clone --depth 1 --branch $Ref $RepoUrl $InstallDir
}

Push-Location $InstallDir
try {
  Info 'Installing production dependencies from the lockfile'
  & npm ci --omit=dev --ignore-scripts
  & node scripts/installer-init.mjs --profile $Profile --install-dir $InstallDir | Out-Null

  $cmdPath = Join-Path $BinDir 'agentos.cmd'
  @("@echo off", "set AGENTOS_PROFILE=$Profile", "node `"$InstallDir\bin\agentos.js`" %*") | Set-Content -Encoding ASCII $cmdPath

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }
  if (-not ($entries | Where-Object { $_ -ieq $BinDir })) {
    [Environment]::SetEnvironmentVariable('Path', (($entries + $BinDir) -join ';'), 'User')
  }
  $env:Path = "$BinDir;$env:Path"

  if ($Desktop) {
    Info 'Building the Electron directory package'
    & npm install --include=dev --ignore-scripts
    & npm run desktop:pack
  }
} finally {
  Pop-Location
}

Info "Installed AgentOS at $InstallDir"
Info "Profile: $ProfileDir"
Info "CLI: $cmdPath"
Info 'Open a new PowerShell session, then run: agentos onboard'
Info 'Authenticate with: agentos login'
Info 'The installer did not write API keys or credentials to PowerShell profiles.'
