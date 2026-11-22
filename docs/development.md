# 开发与部署

插件版本以 [package.json](../package.json) 中的三段版本号为准，Go 注册版本、包名和正式发布标签使用同一版本。

## 准备环境

需要 Go 1.23+、支持 CGO 的 C 编译器、Node.js 20.19+（20.x）或 22.12+ 和 pnpm。项目不绑定开发者的绝对路径，也不会安装 SDK 或更改全局环境。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
```

`pnpm dev` 只启动页面开发服务器。正式页面嵌入 CPA 并通过同源管理接口获取真实数据；本项目不提供模拟后端或测试账号。

## 原生构建

```powershell
./scripts/build.ps1 -Architecture amd64
```

支持 Windows amd64、Linux amd64 和 Linux arm64。在 Linux ARM64 主机上使用 `-Architecture arm64`，也可以省略参数以使用当前 Go 工具链的主机架构。交叉构建时通过 `-Compiler` 指定目标平台的 C 编译器。工具未加入 PATH 时，可通过 `-GoExe`、`-Compiler` 或 `CPA_RISK_GROUP_GO`（兼容 `CPA_DOWNSHIFT_GO`）、`CC` 进程变量指定路径。脚本会：

1. 核对 Go 的插件 ID、注册版本与包配置，执行 TypeScript 检查和 Vite 构建。
2. 将页面产物准备到 `web/dist/`，供 `go:embed` 使用。
3. 运行 `go vet` 并生成当前平台的共享库。
4. 在 `build/<平台>/<架构>/` 写入本地产物和 SHA-256 文件。

`dist/`、`web/dist/` 和 `build/` 均为生成目录，不提交到源码仓库。直接运行 Go 构建或静态检查前，应先通过构建脚本准备嵌入资源。

## 安装包与版本

发布构建使用 Go 1.26.10，从版本标签指向的干净 Git 提交构建三个目标。标签采用 `v<版本号>`，版本号取自 `package.json`。构建时间保留在 Git 的构建元数据中。

```powershell
$tag = 'v' + (node -p "require('./package.json').version")
python scripts/package_release.py --platform linux --arch amd64 --tag $tag
python scripts/package_release.py --platform linux --arch arm64 --tag $tag
python scripts/package_release.py --platform windows --arch amd64 --tag $tag
python scripts/package_release.py --checksums --tag $tag
```

安装包和 `checksums.txt` 输出至 `build/release/<版本号>/`。推送版本标签会触发三平台构建和 GitHub Release 发布。

## 配置与部署

参考 [配置示例](../examples/plugin-config.yaml)。`api_base` 只允许本机回环 HTTP 地址，`management_key` 使用已有 CPA 管理密钥；`state_dir` 留空时使用 CPA 可执行文件旁的 `plugin-data/cpa-gpt-risk-group-plugin/`。若从旧插件名 `cpa-codex-downshift-classifier` 升级，保留原 `state_dir` 或将原 `plugin-data/cpa-codex-downshift-classifier/` 目录迁移至 `plugin-data/cpa-gpt-risk-group-plugin/` 即可继承历史记录与设置。

```powershell
./scripts/deploy-local.ps1 -CoreDir <CPA核心目录> -GuiConfig <EasyCLIProxyAPI配置文件>
```

未使用 EasyCLIProxyAPI 时，可通过 `CPA_RISK_GROUP_MANAGEMENT_KEY`（兼容 `CPA_DOWNSHIFT_MANAGEMENT_KEY`）进程变量提供管理密钥，然后运行同一部署脚本。脚本仅通过官方配置 API 更新本插件节点，使用 `If-Match` 避免覆盖并发配置修改，并保留配置、原插件与状态备份。同版本重新构建会切换合法加载路径，以保证 CPA 实际重新加载新 DLL。

部署完成会输出已加载版本、页面地址和备份位置，并验证 CPA 内核哈希及其它插件注册状态。备份属于本机运行数据，不应加入源码提交。回退需要恢复对应备份中的插件文件、插件配置和状态，不能只替换 DLL。

## Codex 请求头

请求头默认策略在 `internal/cpa/request_headers.go` 中维护：未设置插件覆盖时，模型巡检仅传递基础内容协商头（`Content-Type` / `Accept`），直接沿用 CPA 内核的 Codex CLI 请求头配置；主动额度刷新优先读取 CPA 配置中的 `codex-header-defaults` / `header-defaults`，仅在 CPA 未配置时使用 Codex CLI `0.170.0` 兜底基线。巡检接收 SSE，额度查询接收 JSON，认证、账号和传输控制头由 CPA 管理。

CPA 自带的 Codex 身份重设可能覆盖调用方的 User-Agent。需要调整宿主配置时，可显式运行：

```powershell
./scripts/configure-codex-headers.ps1 -CoreDir <CPA核心目录> -GuiConfig <EasyCLIProxyAPI配置文件> -UserAgent <Codex-CLI-User-Agent>
```

该工具通过官方接口更新 Codex OAuth 默认 UA 并关闭旧内置身份重设，先备份宿主配置。凭证中的非插件请求头规则保持原值；规则冲突会返回错误。

模型巡检固定选中目标凭证，并按该凭证的 CPA 前缀提交模型名。巡检通过宿主内部接口进入 CPA 模型执行器。每次模型请求通过 `host.model.execute_stream` 指定目标凭证。部分 CPA 版本会把后台调用写入用量队列，但缺少 `request_id`、入口和客户端标识。此时 EasyCPA 会将记录保留在采集收件箱并标为 `decode_failed`，错误为 `CPA usage record must contain request_id`。宿主需要为独立后台模型调用生成请求 ID，EasyCPA 才能将记录纳入使用历史。

## 提交范围

提交源代码、锁文件、文档、配置示例和必要构建工具。凭证、管理密钥、完整本机配置、状态、日志、截图、依赖、二进制、缓存、本地测试脚本和合成测试数据不提交。`.gitignore` 已包含相应规则；提交前仍应检查暂存区文件清单和差异。
