<p align="left">
  <img src="assets/logo.svg" width="52" height="52" alt="cpa-gpt-risk-group-plugin logo" />
</p>

# Codex 风控检测与分类插件

适用于 CLIProxyAPI（CPA）的 Codex 凭证风控检测与分组插件（`cpa-gpt-risk-group-plugin`）。支持通过糖果题或模型指纹巡检凭证输出质量与异常状态，默认「仅检测」不改动凭证配置，也可按需自动写入模型前缀或调度优先级。

<p align="center">
  <img src="assets/preview.png" alt="插件首页双栏预览（演示数据）" width="760" />
</p>

## 核心功能

| 功能 | 说明 |
| --- | --- |
| 多方式巡检 | 支持手动、批量与定时巡检，内置糖果题校验与三次采样模型指纹归因 |
| 模型与思考配置 | 在首页快捷切换检测模型、思考等级（低 / 中 / 高）与分组策略（`仅检测` / `模型前缀` / `仅优先级`） |
| 凭证启停与免检管理 | 支持同步启停 CPA 凭证、手动免检移入排除池、账号名脱敏，以及双栏、列表、自适应卡片视图 |
| 分组策略与路由控制 | 支持按「正常 / 风控 / 待分组」写入模型前缀或优先级（含负优先级），加权轮询下支持单凭证权重调节 |
| 批次历史与多日统计 | 按批次记录每轮问题、回答摘要、请求耗时与同步结果；统计近 7 / 14 / 30 个北京时间自然日的覆盖率与风控占比 |

## 使用概要

- **三种视图与布局**：在「概览」支持双栏、列表及随窗口宽度自适应列数的卡片视图（卡片默认 12 个并自动对齐满行）。
- **额度与异常保护**：可主动刷新当前页凭证额度；支持配置全局及定时巡检独立的剩余额度门槛、并发会话限制与连续异常退避规则。
- **默认请求头兼容**：未配置插件请求头覆盖时，默认直接沿用 CPA 内核的 Codex CLI 请求头配置；需要自定义时支持可视化键值与 JSON 直接编辑。
- **独立证据可追溯**：点击凭证近况灯可查看该轮完整回答依据与耗时统计；401/403 认证失效、额度不足与宿主冷却保留独立状态，不混同风控判定。

## 安装与启用

### 宿主环境与平台

CPA 宿主需支持原生插件 **C ABI 1** 与管理接口 **RPC Schema 6**。公开安装包见 [GitHub Releases](https://github.com/UangSC/cpa-gpt-risk-group-plugin/releases)，安装包架构须与 CPA 进程一致：

| 运行平台 | 架构 | 共享库 |
| --- | --- | --- |
| Linux | amd64（x86-64） | `.so` |
| Linux | arm64（AArch64） | `.so` |
| Windows | amd64（x64） | `.dll` |

### 从源码构建

需准备 PowerShell 7、Go 1.23+、支持 CGO 的 C 编译器，以及符合 [package.json](package.json) 要求的 Node.js 与 pnpm，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
./scripts/build.ps1
```

产物及 SHA-256 校验文件默认输出至 `build/<平台>/<架构>/`。完整交叉构建、打包与部署步骤见 [开发与部署](docs/development.md)。

### 配置与访问入口

将共享库放入 CPA 插件目录并参照 [插件配置示例](examples/plugin-config.yaml) 启用后，即可在 CPA 管理界面插件入口打开，或访问当前 CPA 实例下的固定路径（使用 CPA 管理密钥登录）：

```text
/v0/resource/plugins/cpa-gpt-risk-group-plugin/ui
```

### 使用 AI 助手快速安装

可将以下提示词复制给能够操作目标机器的 AI 助手协助部署：

```text
请协助我在现有的 CLIProxyAPI（CPA）实例中安装 Codex 风控检测与分类插件。
项目仓库为 https://github.com/UangSC/cpa-gpt-risk-group-plugin 。

1. 识别目标 CPA 实例、配置路径、运行平台与进程架构，确认宿主支持原生插件 C ABI 1 和管理接口 RPC Schema 6。
2. 优先使用仓库 Releases 中与平台、架构及版本匹配的安装包，核对 checksums.txt 中的 SHA-256；若需源码构建，按 docs/development.md 执行。
3. 安装前备份原配置、插件文件与状态目录；Windows 本机可使用 scripts/deploy-local.ps1，Linux 按 CPA 插件加载器配置启用，管理密钥在本机读取或由我提供，勿输出至日志。
4. 启用后确认插件 cpa-gpt-risk-group-plugin 注册状态与版本无误，并给出可打开的管理页面路径与备份位置。
```

## 项目文档

- [开发与部署](docs/development.md)
- [架构与扩展](docs/architecture.md)
- [管理 API](docs/api.md)
- [第三方代码、参考数据与许可证](THIRD_PARTY_NOTICES.md)
- [GitHub Releases](https://github.com/UangSC/cpa-gpt-risk-group-plugin/releases)
