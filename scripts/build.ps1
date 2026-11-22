param(
    [string]$GoExe = $(if ($env:CPA_RISK_GROUP_GO) { $env:CPA_RISK_GROUP_GO } else { $env:CPA_DOWNSHIFT_GO }),
    [string]$Compiler = $env:CC,
    [ValidateSet('amd64', 'arm64')][string]$Architecture
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
$taskVersion = $taskPackage.version
$taskPluginId = $taskPackage.name
if ($taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw '插件版本必须是标准三段版本号。' }
if ($taskPluginId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw '插件 ID 不符合 CLIProxyAPI 插件规范。' }
$taskSource = Get-Content -LiteralPath (Join-Path $taskRoot 'cmd/downshift/plugin.go') -Raw -Encoding utf8
foreach ($taskEntry in @{ pluginID = $taskPluginId; version = $taskVersion }.GetEnumerator()) {
    $taskPattern = '(?m)^const ' + $taskEntry.Key + ' = "' + [regex]::Escape($taskEntry.Value) + '"\r?$'
    if ($taskSource -notmatch $taskPattern) { throw ('Go 插件注册的 ' + $taskEntry.Key + ' 与 package.json 不一致。') }
}
$taskRegistry = Get-Content -LiteralPath (Join-Path $taskRoot 'store/registry.json') -Raw -Encoding utf8 | ConvertFrom-Json
$taskStorePlugin = $taskRegistry.plugins[0]
if ($taskRegistry.schema_version -ne 1 -or $taskStorePlugin.id -ne $taskPluginId) {
    throw 'store/registry.json 的 schema_version 或插件 ID 与 package.json 不一致。'
}
$taskExpectedRepo = [string]$taskStorePlugin.repository
$taskPackageRepo = ([string]$taskPackage.repository.url) -replace '^git\+', '' -replace '\.git$', ''
if ($taskPackageRepo -ne $taskExpectedRepo -or $taskSource -notmatch ('"GitHubRepository": "' + [regex]::Escape($taskExpectedRepo) + '"')) {
    throw 'GitHub 仓库地址在 package.json、store/registry.json 与 Go 注册元数据中不一致。'
}
$taskLogoPath = Join-Path $taskRoot 'assets/logo.svg'
if (!(Test-Path -LiteralPath $taskLogoPath -PathType Leaf)) {
    throw '缺少插件 Logo 文件 assets/logo.svg。'
}
$taskExpectedLogo = [string]$taskStorePlugin.logo
if ($taskExpectedLogo -and $taskSource -notmatch ('"Logo": "' + [regex]::Escape($taskExpectedLogo) + '"')) {
    throw 'store/registry.json 的 logo 与 Go 注册元数据 Logo 不一致。'
}
$taskServiceSource = Get-Content -LiteralPath (Join-Path $taskRoot 'internal/classifier/service.go') -Raw -Encoding utf8
$taskExpectedPrefix = '/v0/management/plugins/' + $taskPluginId
if ($taskServiceSource -notmatch ('(?m)^const apiPrefix = "' + [regex]::Escape($taskExpectedPrefix) + '"\r?$')) {
    throw 'internal/classifier/service.go 中的 apiPrefix 与插件 ID 不一致。'
}
$taskContractSource = Get-Content -LiteralPath (Join-Path $taskRoot 'src/api/contract.ts') -Raw -Encoding utf8
if ($taskContractSource -notmatch ("(?m)^export const PLUGIN_ID = '" + [regex]::Escape($taskPluginId) + "'\r?$")) {
    throw 'src/api/contract.ts 中的 PLUGIN_ID 与插件 ID 不一致。'
}
if (!$GoExe) { $GoExe = (Get-Command go -ErrorAction SilentlyContinue).Source }
if (!$Compiler) { $Compiler = (Get-Command gcc -ErrorAction SilentlyContinue).Source }
if (!$GoExe -or !(Test-Path -LiteralPath $GoExe -PathType Leaf)) { throw '找不到 Go，请通过 -GoExe 指定已有工具。' }
if (!$Compiler -or !(Test-Path -LiteralPath $Compiler -PathType Leaf)) { throw '找不到 CGO 编译器，请通过 -Compiler 指定已有编译器。' }
$taskPlatform = if ($IsLinux) { 'linux' } elseif ($env:OS -eq 'Windows_NT') { 'windows' } else { throw '当前仅支持 Windows 和 Linux。' }
if (!$Architecture) {
    $Architecture = (& $GoExe env GOHOSTARCH)
    if ($LASTEXITCODE -ne 0) { throw '无法识别构建主机架构。' }
}
if ($Architecture -notin @('amd64', 'arm64') -or ($taskPlatform -eq 'windows' -and $Architecture -ne 'amd64')) {
    throw '仅支持 Linux amd64、Linux arm64 与 Windows amd64。'
}
$taskExtension = if ($IsLinux) { '.so' } else { '.dll' }
$taskDirectory = Join-Path $taskRoot "build/$taskPlatform/$Architecture"
$taskOldLocation = Get-Location
$taskPreviousEnv = @{}
foreach ($taskName in @('CC','CGO_ENABLED','GOOS','GOARCH')) { $taskPreviousEnv[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
try {
    Set-Location -LiteralPath $taskRoot
    if (!(Test-Path -LiteralPath 'node_modules')) { throw '缺少前端依赖，请先运行 pnpm install --frozen-lockfile。' }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
    $taskEmbedded = [IO.Path]::GetFullPath((Join-Path $taskRoot 'web/dist'))
    $taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskRoot 'web')) + [IO.Path]::DirectorySeparatorChar
    if (!$taskEmbedded.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase)) { throw '嵌入资源目录超出项目边界。' }
    if (Test-Path -LiteralPath $taskEmbedded) { Remove-Item -LiteralPath $taskEmbedded -Recurse -Force }
    New-Item -ItemType Directory -Path $taskEmbedded -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $taskRoot 'dist') -Force | Copy-Item -Destination $taskEmbedded -Recurse -Force
    $env:CC = $Compiler; $env:CGO_ENABLED = '1'; $env:GOOS = $taskPlatform; $env:GOARCH = $Architecture
    & $GoExe vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go 静态检查失败。' }
    New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
    $taskArtifact = Join-Path $taskDirectory ($taskPackage.name + '-v' + $taskVersion + $taskExtension)
    & $GoExe build -trimpath -buildmode=c-shared -ldflags='-s -w' -o $taskArtifact ./cmd/downshift
    if ($LASTEXITCODE -ne 0) { throw 'Go 原生插件构建失败。' }
    $taskHash = Get-FileHash -LiteralPath $taskArtifact -Algorithm SHA256
    ($taskHash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($taskArtifact)) | Set-Content -LiteralPath ($taskArtifact + '.sha256') -Encoding utf8
    Write-Output ('插件已构建：' + $taskArtifact)
    Write-Output ('SHA-256：' + $taskHash.Hash)
} finally {
    foreach ($taskName in $taskPreviousEnv.Keys) { [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnv[$taskName], 'Process') }
    Set-Location -LiteralPath $taskOldLocation.Path
}
