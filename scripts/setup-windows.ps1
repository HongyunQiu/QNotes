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
        throw 'winget 未找到。请从 Microsoft Store 安装 "App Installer"，再重试。'
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
    Write-Host '==> 安装/确认 Visual Studio 2022 Build Tools（含 C++ 工作负载）'
    winget @args
}

function Stop-NodeAndCleanModule() {
    Write-Host '==> 停止可能占用的 node 进程'
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    $modulePath = Join-Path -Path (Get-Location) -ChildPath 'node_modules/better-sqlite3'
    if (Test-Path $modulePath) {
        Write-Host '==> 清理残留 better-sqlite3 模块目录'
        Remove-Item -Recurse -Force $modulePath -ErrorAction SilentlyContinue
    }
}

function Ensure-Dependencies() {
    Write-Host '==> 安装项目依赖（npm install）'
    $env:npm_config_fund = 'false'
    $env:npm_config_audit = 'false'
    $env:npm_config_network_timeout = '600000'
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
}

function Install-BetterSqlite3() {
    $env:npm_config_network_timeout = '600000'
    if ($ForceFromSource) {
        Write-Host '==> 强制从源码构建 better-sqlite3'
        $env:npm_config_msvs_version = '2022'
        $env:npm_config_build_from_source = 'true'
        & npm i better-sqlite3@latest
        if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 源码构建安装失败' }
        return
    }

    Write-Host '==> 尝试安装 better-sqlite3 预编译二进制'
    Remove-Item -Recurse -Force node_modules/better-sqlite3 -ErrorAction SilentlyContinue
    & npm i better-sqlite3@latest
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host '==> 预编译安装失败，回退为源码构建'
    $env:npm_config_msvs_version = '2022'
    $env:npm_config_build_from_source = 'true'
    & npm i better-sqlite3@latest
    if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 源码构建安装失败' }
}

try {
    Ensure-Winget
    Install-BuildTools
    Stop-NodeAndCleanModule
    Ensure-Dependencies
    Install-BetterSqlite3

    Write-Host '✅ 安装完成。你可以运行：npm start'
    if ($Start) {
        Write-Host '==> 启动服务 (npm start)'
        & npm start
    }
}
catch {
    Write-Error $_
    exit 1
}

