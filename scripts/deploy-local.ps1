param(
    [Parameter(Mandatory)][string]$CoreDir,
    [string]$ApiBase = 'http://127.0.0.1:8317',
    [string]$ManagementKey = $(if ($env:CPA_RISK_GROUP_MANAGEMENT_KEY) { $env:CPA_RISK_GROUP_MANAGEMENT_KEY } else { $env:CPA_DOWNSHIFT_MANAGEMENT_KEY }),
    [string]$GuiConfig,
    [string]$Artifact
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
$taskPluginId = $taskPackage.name
$taskVersion = $taskPackage.version
$taskFileName = $taskPluginId + '-v' + $taskVersion + '.dll'
if (!$Artifact) { $Artifact = Join-Path $taskRoot ('build\windows\amd64\' + $taskFileName) }
if ([IO.Path]::GetFileName($Artifact) -ne $taskFileName) { throw '部署产物名称与当前 package.json 版本不匹配。' }
$taskCore = (Resolve-Path -LiteralPath $CoreDir).Path
$taskBinary = Join-Path $taskCore 'cli-proxy-api.exe'
$taskConfig = Join-Path $taskCore 'config.yaml'
foreach ($taskFile in @($Artifact,$taskBinary,$taskConfig)) { if (!(Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw ('文件不存在：' + $taskFile) } }
$taskUri = [Uri]$ApiBase
$taskIp = $null
if ($taskUri.Scheme -ne 'http' -or ![Net.IPAddress]::TryParse($taskUri.Host,[ref]$taskIp) -or ![Net.IPAddress]::IsLoopback($taskIp)) { throw '部署只允许本机回环 HTTP API 地址。' }
if (!$ManagementKey -and $GuiConfig) {
    $taskGuiLine = Get-Content -LiteralPath $GuiConfig -Encoding utf8 | Where-Object { $_ -match '^management-secret-key\s*=' } | Select-Object -First 1
    if ($taskGuiLine -match '^management-secret-key\s*=\s*(".*")\s*$') { $ManagementKey = $Matches[1] | ConvertFrom-Json }
}
if (!$ManagementKey) { throw '缺少管理密钥，请设置 CPA_RISK_GROUP_MANAGEMENT_KEY（兼容 CPA_DOWNSHIFT_MANAGEMENT_KEY）或指定 -GuiConfig。' }
$taskHandler = [Net.Http.HttpClientHandler]::new()
$taskHandler.UseProxy = $false; $taskHandler.AllowAutoRedirect = $false
$taskHttp = [Net.Http.HttpClient]::new($taskHandler)
$taskHttp.Timeout = [TimeSpan]::FromSeconds(15)
$taskHttp.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$ManagementKey)
function Invoke-CpaRequest([string]$Method,[string]$Path,[object]$Body,[string]$ETag) {
    $taskRequest = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method),$ApiBase.TrimEnd('/')+$Path)
    try {
        if ($null -ne $Body) { $taskRequest.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 30 -Compress),[Text.Encoding]::UTF8,'application/json') }
        if ($ETag) { [void]$taskRequest.Headers.TryAddWithoutValidation('If-Match',$ETag) }
        $taskResponse = $taskHttp.SendAsync($taskRequest).GetAwaiter().GetResult()
        try {
            $taskText = $taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (!$taskResponse.IsSuccessStatusCode) { throw ('CPA 接口 ' + $Path + ' 返回 HTTP ' + [int]$taskResponse.StatusCode) }
            $taskParsed = if ($taskText) { $taskText | ConvertFrom-Json } else { $null }
            return @{ Data=$taskParsed; ETag=[string]$taskResponse.Headers.ETag }
        } finally { $taskResponse.Dispose() }
    } finally { $taskRequest.Dispose() }
}
try {
    $taskBefore = (Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash
    $taskListing = (Invoke-CpaRequest 'GET' '/v0/management/plugins' $null $null).Data
    $taskExistingIds = @($taskListing.plugins | Where-Object registered | ForEach-Object id)
    $taskRead = Invoke-CpaRequest 'GET' '/v8/management/config/plugins/configs' $null $null
    $taskBackup = Join-Path $taskCore ('backups\risk-group-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
    Copy-Item -LiteralPath $taskConfig -Destination (Join-Path $taskBackup 'config.yaml')
    Set-Acl -LiteralPath (Join-Path $taskBackup 'config.yaml') -AclObject (Get-Acl -LiteralPath $taskConfig)
    $taskPreviousState = Join-Path $taskCore ('plugin-data\' + $taskPluginId + '\state.json')
    if (Test-Path -LiteralPath $taskPreviousState -PathType Leaf) {
        $taskStateBackup = Join-Path $taskBackup 'state-before-upgrade.json'
        Copy-Item -LiteralPath $taskPreviousState -Destination $taskStateBackup
        Set-Acl -LiteralPath $taskStateBackup -AclObject (Get-Acl -LiteralPath $taskPreviousState)
    }
    $taskPluginsRoot = [IO.Path]::GetFullPath((Join-Path $taskCore 'plugins'))
    $taskPlatformDir = [IO.Path]::GetFullPath((Join-Path $taskPluginsRoot 'windows\amd64'))
    $taskTargetDir = $taskPlatformDir
    $taskActive = $taskListing.plugins | Where-Object { $_.id -eq $taskPluginId -and $_.registered }
    if ($taskActive -and $taskActive.metadata.version -eq $taskVersion) {
        $taskActivePath = if ([IO.Path]::IsPathRooted($taskActive.path)) { [IO.Path]::GetFullPath($taskActive.path) } else { [IO.Path]::GetFullPath((Join-Path $taskCore $taskActive.path)) }
        $taskActiveDir = [IO.Path]::GetDirectoryName($taskActivePath)
        if ($taskActiveDir -ne $taskPluginsRoot -and $taskActiveDir -ne $taskPlatformDir) { throw '已加载插件位于预期槽位之外，停止自动替换。' }
        if (Test-Path -LiteralPath $taskActivePath) {
            if ((Get-FileHash -LiteralPath $taskActivePath).Hash -eq (Get-FileHash -LiteralPath $Artifact).Hash) { $taskTargetDir = $taskActiveDir }
            elseif ($taskActiveDir -eq $taskPlatformDir) { $taskTargetDir = $taskPluginsRoot }
        }
    }
    # 同版本的新代码使用另一合法路径，使宿主真正重开 DLL，而非仅重配旧实例。
    New-Item -ItemType Directory -Path $taskTargetDir -Force | Out-Null
    $taskTargetDir = [IO.Path]::GetFullPath($taskTargetDir)
    $taskTarget = Join-Path $taskTargetDir ([IO.Path]::GetFileName($Artifact))
    if (Test-Path -LiteralPath $taskTarget) { Copy-Item -LiteralPath $taskTarget -Destination $taskBackup }
    Copy-Item -LiteralPath $Artifact -Destination $taskTarget -Force
    if ((Get-FileHash -LiteralPath $taskTarget).Hash -ne (Get-FileHash -LiteralPath $Artifact).Hash) { throw '插件复制后校验失败。' }
    # CPA 默认选择同 ID 的最高版本。归档其它版本，使降号后也只发现当前产物。
    $taskArchived = @()
    $taskArchiveDir = Join-Path $taskBackup 'previous-plugins'
    New-Item -ItemType Directory -Path $taskArchiveDir -Force | Out-Null
    $taskPattern = '^' + [regex]::Escape($taskPluginId) + '-v\d+\.\d+\.\d+\.dll$'
    $taskCandidates = @(Get-ChildItem -LiteralPath $taskPluginsRoot -File)
    if (Test-Path -LiteralPath $taskPlatformDir) { $taskCandidates += @(Get-ChildItem -LiteralPath $taskPlatformDir -File) }
    foreach ($taskCandidate in $taskCandidates) {
        if ($taskCandidate.FullName -eq $taskTarget -or $taskCandidate.Name -notmatch $taskPattern) { continue }
        $taskOldPath = [IO.Path]::GetFullPath($taskCandidate.FullName)
        $taskOldDir = [IO.Path]::GetDirectoryName($taskOldPath)
        if ($taskOldDir -ne $taskPluginsRoot -and $taskOldDir -ne $taskPlatformDir) { throw '旧插件路径超出预期目录。' }
        $taskArchiveSlot = Join-Path $taskArchiveDir $(if ($taskOldDir -eq $taskPlatformDir) { 'windows-amd64' } else { 'root' })
        New-Item -ItemType Directory -Path $taskArchiveSlot -Force | Out-Null
        $taskArchivedPath = Join-Path $taskArchiveSlot $taskCandidate.Name
        Move-Item -LiteralPath $taskOldPath -Destination $taskArchivedPath
        $taskArchived += @{ Source=$taskOldPath; Backup=$taskArchivedPath }
    }
    $taskStateDir = Join-Path $taskCore ('plugin-data\' + $taskPluginId)
    # 修订号仅触发目录重读；实际版本选择由唯一 DLL 和下方严格校验保证。
    $taskNewConfig = @{ enabled=$true; api_base=$ApiBase.TrimEnd('/'); management_key=$ManagementKey; state_dir=$taskStateDir; deployment_revision=[guid]::NewGuid().ToString('N') }
    $taskPriorConfig = $taskRead.Data.PSObject.Properties[$taskPluginId].Value
    if ($taskPriorConfig.store) {
        $taskStore = @{}
        foreach ($taskProperty in $taskPriorConfig.store.PSObject.Properties) { $taskStore[$taskProperty.Name] = $taskProperty.Value }
        $taskStore['version'] = $taskVersion
        $taskStore['release-tag'] = 'v' + $taskVersion
        $taskNewConfig['store'] = $taskStore
    }
    # 只更新本插件的配置节点；If-Match 防止覆盖其他会话同时保存的配置。
    try {
        $null = Invoke-CpaRequest 'PUT' ('/v8/management/config/plugins/configs/' + $taskPluginId) $taskNewConfig $taskRead.ETag
    } catch {
        foreach ($taskArchivedFile in $taskArchived) {
            if (!(Test-Path -LiteralPath $taskArchivedFile.Source)) { Move-Item -LiteralPath $taskArchivedFile.Backup -Destination $taskArchivedFile.Source }
        }
        throw
    }
    $taskSnapshot = $null
    for ($taskAttempt=1; $taskAttempt -le 3; $taskAttempt++) {
        try {
            $taskAfterListing = (Invoke-CpaRequest 'GET' '/v0/management/plugins' $null $null).Data
            $taskLoaded = $taskAfterListing.plugins | Where-Object { $_.id -eq $taskPluginId -and $_.registered }
            $taskLoadedPath = if ($taskLoaded) { if ([IO.Path]::IsPathRooted($taskLoaded.path)) { [IO.Path]::GetFullPath($taskLoaded.path) } else { [IO.Path]::GetFullPath((Join-Path $taskCore $taskLoaded.path)) } } else { '' }
            if (!$taskLoaded -or $taskLoaded.metadata.version -ne $taskVersion -or $taskLoadedPath -ne [IO.Path]::GetFullPath($taskTarget)) { throw 'CPA 尚未完成本次插件版本与路径切换。' }
            $taskSnapshot = (Invoke-CpaRequest 'GET' ('/v0/management/plugins/' + $taskPluginId + '/snapshot') $null $null).Data
            break
        }
        catch { if ($taskAttempt -eq 3) { throw ('连续三次读取新插件快照失败，已停止自动部署验证。原因：' + $_.Exception.Message + '。备份和插件文件已保留。') }; Start-Sleep -Seconds 2 }
    }
    if (!$taskLoaded -or $taskSnapshot.source -ne 'live') { throw '插件尚未注册为实时模式。' }
    if ($taskLoaded.metadata.version -ne $taskVersion -or [IO.Path]::GetFileName($taskLoaded.path) -ne $taskFileName) { throw 'CPA 注册的插件版本或实际加载路径与本次产物不一致。' }
    foreach ($taskId in $taskExistingIds) { if (!($taskAfterListing.plugins | Where-Object { $_.id -eq $taskId -and $_.registered })) { throw ('原有插件注册状态发生变化：' + $taskId) } }
    if ((Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash -ne $taskBefore) { throw 'CPA 内核二进制哈希发生变化。' }
    Write-Output ('插件已接入 CPA：' + $taskPluginId)
    Write-Output ('实际注册版本：' + $taskLoaded.metadata.version)
    Write-Output ('真实 Codex 凭证数量：' + @($taskSnapshot.credentials).Count)
    Write-Output ('当前 CPA 调度策略：' + $taskSnapshot.capabilities.routingStrategy)
    Write-Output ('插件页面：' + $ApiBase.TrimEnd('/') + '/v0/resource/plugins/' + $taskPluginId + '/ui')
    Write-Output ('恢复备份：' + $taskBackup)
    Write-Output ('CPA 内核 SHA-256 保持一致：' + $taskBefore)
} finally { $taskHttp.Dispose(); $taskHandler.Dispose(); $ManagementKey = $null }
