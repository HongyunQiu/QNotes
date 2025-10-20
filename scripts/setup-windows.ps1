Param(
    [switch]$Start,
    [switch]$ForceFromSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-CommandSafe([scriptblock]$Script, [string]$Description) {
    Write-Host "==> $Description"
    & $Script
    if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Description"
    }
}

function Ensure-Winget() {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'winget not found. Please install "App Installer" from Microsoft Store and try again.'
    }
}

function Install-BuildTools() {
    $args = @(
        'install',
        '--id','Microsoft.VisualStudio.2022.BuildTools',
        '--source','winget',
        '--silent',
        '--override','--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart'
    )
    Write-Host '==> Installing/Confirming Visual Studio 2022 Build Tools (with C++ workload)'
    winget @args
}

function Stop-NodeAndCleanModule() {
    Write-Host '==> Stopping potentially occupied node processes'
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    $modulePath = Join-Path -Path (Get-Location) -ChildPath 'node_modules/better-sqlite3'
    if (Test-Path $modulePath) {
        Write-Host '==> Cleaning up residual better-sqlite3 module directory'
        Remove-Item -Recurse -Force $modulePath -ErrorAction SilentlyContinue
    }
}

function Ensure-Dependencies() {
    Write-Host '==> Installing project dependencies (npm install)'
    $env:npm_config_fund = 'false'
    $env:npm_config_audit = 'false'
    $env:npm_config_network_timeout = '600000'
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

function Install-BetterSqlite3() {
    $env:npm_config_network_timeout = '600000'
    if ($ForceFromSource) {
        Write-Host '==> Force building better-sqlite3 from source'
        $env:npm_config_msvs_version = '2022'
        $env:npm_config_build_from_source = 'true'
        & npm i better-sqlite3@latest
        if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 source build installation failed' }
        return
    }

    Write-Host '==> Attempting to install better-sqlite3 precompiled binary'
    Remove-Item -Recurse -Force node_modules/better-sqlite3 -ErrorAction SilentlyContinue
    & npm i better-sqlite3@latest
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host '==> Precompiled installation failed, falling back to source build'
    $env:npm_config_msvs_version = '2022'
    $env:npm_config_build_from_source = 'true'
    & npm i better-sqlite3@latest
    if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 source build installation failed' }
}

try {
    Ensure-Winget
    Install-BuildTools
    Stop-NodeAndCleanModule
    Ensure-Dependencies
    Install-BetterSqlite3

    Write-Host '✅ Installation completed. You can run: npm start'
    if ($Start) {
        Write-Host '==> Starting service (npm start)'
        & npm start
    }
}
catch {
    Write-Error $_
    exit 1
}