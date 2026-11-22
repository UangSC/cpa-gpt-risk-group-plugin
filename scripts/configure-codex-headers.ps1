param(
    [Parameter(Mandatory)][string]$CoreDir,
    [Parameter(Mandatory)][string]$UserAgent,
    [string]$ApiBase = 'http://127.0.0.1:8317',
    [string]$ManagementKey = $(if ($env:CPA_RISK_GROUP_MANAGEMENT_KEY) { $env:CPA_RISK_GROUP_MANAGEMENT_KEY } else { $env:CPA_DOWNSHIFT_MANAGEMENT_KEY }),
    [string]$GuiConfig
)
$ErrorActionPreference = 'Stop'
$taskCore = (Resolve-Path -LiteralPath $CoreDir).Path
$taskUri = [Uri]$ApiBase
$taskIp = $null
if ($taskUri.Scheme -ne 'http' -or ![Net.IPAddress]::TryParse($taskUri.Host,[ref]$taskIp) -or ![Net.IPAddress]::IsLoopback($taskIp)) { throw '只允许本机 CPA 回环地址。' }
if (!$UserAgent -or $UserAgent -match '[\r\n\x00]' -or $UserAgent.Length -gt 4096) { throw 'Codex CLI User-Agent 无效。' }
if (!$ManagementKey -and $GuiConfig) {
    $taskLine = Get-Content -LiteralPath $GuiConfig -Encoding utf8 | Where-Object { $_ -match '^management-secret-key\s*=' } | Select-Object -First 1
    if ($taskLine -match '^management-secret-key\s*=\s*(".*")\s*$') { $ManagementKey = $Matches[1] | ConvertFrom-Json }
}
if (!$ManagementKey) { throw '缺少现有管理密钥。' }
$taskHandler = [Net.Http.HttpClientHandler]::new()
$taskHandler.UseProxy=$false; $taskHandler.AllowAutoRedirect=$false
$taskHttp=[Net.Http.HttpClient]::new($taskHandler)
$taskHttp.Timeout=[TimeSpan]::FromSeconds(15)
$taskHttp.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$ManagementKey)
function Invoke-CodexConfig([string]$Method,[string]$Path,[object]$Body,[string]$ETag) {
    $taskRequest=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method),$ApiBase.TrimEnd('/')+'/v8/management/config'+$Path)
    try {
        if ($null -ne $Body) { $taskRequest.Content=[Net.Http.StringContent]::new(($Body|ConvertTo-Json -Compress -Depth 30),[Text.Encoding]::UTF8,'application/json') }
        if ($ETag) { [void]$taskRequest.Headers.TryAddWithoutValidation('If-Match',$ETag) }
        $taskResponse=$taskHttp.SendAsync($taskRequest).GetAwaiter().GetResult()
        try {
            $taskText=$taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (!$taskResponse.IsSuccessStatusCode) { throw ('CPA Codex 配置接口返回 HTTP '+[int]$taskResponse.StatusCode) }
            return @{Data=($taskText|ConvertFrom-Json);ETag=[string]$taskResponse.Headers.ETag}
        } finally { $taskResponse.Dispose() }
    } finally { $taskRequest.Dispose() }
}
try {
    $taskBackup=Join-Path $taskCore ('backups\codex-cli-headers-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
    $taskConfig=Join-Path $taskCore 'config.yaml'
    Copy-Item -LiteralPath $taskConfig -Destination (Join-Path $taskBackup 'config.yaml')
    Set-Acl -LiteralPath (Join-Path $taskBackup 'config.yaml') -AclObject (Get-Acl -LiteralPath $taskConfig)
    $taskRead=Invoke-CodexConfig 'GET' '' $null $null
    $null=Invoke-CodexConfig 'PUT' '/oauth/providers/codex/header-defaults/user-agent' $UserAgent $taskRead.ETag
    $taskRead=Invoke-CodexConfig 'GET' '' $null $null
    $null=Invoke-CodexConfig 'PUT' '/upstream/codex/disable-codex-cloaking' $true $taskRead.ETag
    $taskAgent=(Invoke-CodexConfig 'GET' '/oauth/providers/codex/header-defaults/user-agent' $null $null).Data
    $taskCloak=(Invoke-CodexConfig 'GET' '/upstream/codex/disable-codex-cloaking' $null $null).Data
    if ($taskAgent -ne $UserAgent -or $taskCloak -ne $true) { throw 'Codex 默认请求头配置回读不一致。' }
    Write-Output ('CPA Codex 默认 User-Agent 已设置：'+$taskAgent)
    Write-Output 'CPA Codex 将保留请求及凭证规则指定的 CLI 头，不再替换为旧内置身份。'
    Write-Output ('原配置备份：'+$taskBackup)
} finally { $taskHttp.Dispose();$taskHandler.Dispose();$ManagementKey=$null }
