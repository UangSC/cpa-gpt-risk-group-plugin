<p align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="cpa-gpt-risk-group-plugin logo" />
</p>

<h1 align="center">Codex 风控检测与分类插件</h1>

<p align="center">
  <a href="https://go.dev/"><img src="https://img.shields.io/badge/Go-1.23+-00ADD8?style=flat&logo=go&logoColor=white" alt="Go" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-087EA4?style=flat&logo=react&logoColor=white" alt="React" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://github.com/router-for-me/CLIProxyAPI"><img src="https://img.shields.io/badge/CLIProxyAPI-Plugin-2496ED?style=flat" alt="CLIProxyAPI" /></a>
</p>

面向 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)（CPA）的 Codex 凭证风控检测与分组管理原生动态库插件（`cpa-gpt-risk-group-plugin`）。支持通过糖果题校验或模型指纹巡检凭证输出质量与异常状态，默认采用「仅检测」模式不改动凭证配置，也可按需自动写入模型前缀或调度优先级。

## 功能特性

- **多方式巡检**：支持手动、批量与定时巡检，内置糖果题校验与三次采样模型指纹归因；每轮任务冻结配置，支持并发控制与退避重试。
- **快捷模型与策略切换**：首页直接切换检测模型、思考等级（低 / 中 / 高）与分组写入策略（`仅检测` / `模型前缀` / `仅优先级`）。
- **凭证管理与多视图**：支持同步启停 CPA 凭证、手动移入免检排除池、账号名脱敏、单凭证权重调节（加权轮询），以及双栏、列表与自适应列数卡片三种视图。
- **额度与异常保护**：支持主动刷新当前页凭证额度；支持配置全局及定时巡检独立的剩余额度门槛、活跃会话限制与频繁 502/503/429 风控判定规则。
- **可追溯证据与多日统计**：按批次记录题目、回答摘要、请求耗时与同步结果，点击近况灯可查看完整判定依据；统计近 7 / 14 / 30 个北京时间自然日的巡检覆盖率与风控占比。
- **内嵌同源控制台**：原生共享库内嵌 React 单页管理界面，复用 CPA 管理密钥鉴权与内核 Codex CLI 请求头配置，无需额外部署独立后端。

## 控制台预览

截图中的凭证、额度与巡检状态为演示数据。

<p align="center">
  <img src="assets/preview.png" alt="Codex 风控检测与分类插件控制台双栏预览（演示数据）" width="760" />
</p>

## 安装与启用

需要支持原生插件 **C ABI 1** 与管理接口 **RPC Schema 6** 的 CPA 宿主。插件 ID 为 `cpa-gpt-risk-group-plugin`，动态库的操作系统与架构须与 CPA 进程一致。

### 通过插件商店安装

在 **CPA 管理面板 → 插件商店** 中搜索 **Codex 风控检测与分类** 并安装。若商店中未收录该插件，可将本仓库商店清单加入 `plugins.store-sources`：

```yaml
plugins:
  enabled: true
  store-sources:
    - "https://raw.githubusercontent.com/UangSC/cpa-gpt-risk-group-plugin/main/store/registry.json"
```

插件商店会按宿主平台选择归档，并通过 `checksums.txt` 校验安装包。

### 手动安装

从 [GitHub Releases](https://github.com/UangSC/cpa-gpt-risk-group-plugin/releases) 下载对应平台的归档包，使用同一版本的 `checksums.txt` 核对 SHA-256 后，将共享库放入 CPA 插件目录：

| 运行平台 | 架构 | 共享库 |
| --- | --- | --- |
| Linux | amd64（x86-64） | `.so` |
| Linux | arm64（AArch64） | `.so` |
| Windows | amd64（x64） | `.dll` |

参照 [插件配置示例](examples/plugin-config.yaml) 在 CPA 配置中启用插件，并按需填写管理密钥：

```yaml
plugins:
  configs:
    cpa-gpt-risk-group-plugin:
      enabled: true
      api_base: http://127.0.0.1:8317
      management_key: ""
      state_dir: ""
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

## 使用方法

### 访问控制台

插件启用后，可通过 CPA 管理界面插件入口打开，或访问当前 CPA 实例下的固定路径（使用 **CPA 管理密钥** 登录）：

```text
http://<CPA地址>:8317/v0/resource/plugins/cpa-gpt-risk-group-plugin/ui
```

### 巡检与判定说明

- **糖果题与模型指纹**：默认使用糖果题校验回答质量；切换至模型指纹模式后，每次从题库无放回抽取 3 题完成采样，要求目标参考匹配且目标概率严格大于 `0.90` 方判定正常。
- **默认请求头兼容**：未配置插件请求头覆盖时，模型巡检直接沿用 CPA 内核的 Codex CLI 请求头配置；需要自定义时支持可视化键值与 JSON 直接编辑。
- **独立状态隔离**：401/403 认证失效、本地剩余额度不足与宿主冷却均保留独立状态，不混同风控判定；真实 502/503/429 达到配置的单轮请求阈值或连续失败轮数阈值时按设置归为风控。

### 分组写入与日常管理

- **三种分组写入策略**：支持 `仅检测`（默认，不改写凭证）、`模型前缀` 与 `仅优先级`（支持负优先级）；执行写入或开启定时巡检前需核对并确认当前配置版本。
- **凭证启停与路由调节**：可在主列表同步启停 CPA 凭证、将凭证移入或移出免检排除池（不影响原分类与历史），并在加权轮询下按单凭证独立调节权重。
- **多视图、证据与统计**：「概览」支持双栏、列表及随窗口宽度自适应列数的卡片视图（卡片默认 12 个并自动对齐满行）；点击凭证近况灯可查看该轮完整回答依据与耗时；「历史」与「统计」分别提供批次记录回溯与近 7 / 14 / 30 个北京时间自然日的覆盖率及风控占比分析。

## 配置说明

宿主 `plugins.configs.cpa-gpt-risk-group-plugin` 下支持以下配置项；巡检模型、写入策略、额度门槛与定时计划等运行期设置则在控制台中保存至独立的 `state.json`：

| 配置键 | 默认值 | 说明 |
| --- | --- | --- |
| `api_base` | `http://127.0.0.1:8317` | 本机 CPA 官方管理接口地址，仅允许回环 HTTP 地址 |
| `management_key` | 空 | CPA 管理密钥，仅在插件服务端使用；留空时可由环境变量 `CPA_RISK_GROUP_MANAGEMENT_KEY` 提供 |
| `state_dir` | 自动选择 | 插件独立状态目录；留空时读取 `CPA_RISK_GROUP_STATE_DIR`，未设置则使用 CPA 可执行文件旁的 `plugin-data/cpa-gpt-risk-group-plugin/` |

若从旧插件名 `cpa-codex-downshift-classifier` 升级，保留原 `state_dir` 或将原 `plugin-data/cpa-codex-downshift-classifier/` 目录迁移至 `plugin-data/cpa-gpt-risk-group-plugin/` 即可继承历史记录与设置。

## 开发与构建

### 从源码构建

需准备 PowerShell 7、Go 1.23+、支持 CGO 的 C 编译器，以及符合 [package.json](package.json) 要求的 Node.js 与 pnpm，在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
./scripts/build.ps1
```

产物及 SHA-256 校验文件默认输出至 `build/<平台>/<架构>/`。完整交叉构建、打包与本机部署步骤见 [开发与部署](docs/development.md)。

### 目录结构

```text
cmd/downshift/          插件 C ABI 入口、生命周期、配置解析与管理路由
internal/
  classifier/           巡检任务编排、糖果题、模型指纹归因、定时与分组策略
  cpa/                  CPA 官方接口适配、响应流解析、请求头与额度刷新
  fingerprint/          模型指纹检测器与参考数据
src/                    内嵌 React + TypeScript 控制台前端源码
web/                    前端构建产物 embed 入口
scripts/                本地构建、发布打包与部署辅助脚本
store/                  CPA 插件商店清单（registry.json）
docs/                   开发部署、架构扩展与管理 API 文档
examples/               插件配置示例
```

## 项目文档

- [开发与部署](docs/development.md)
- [架构与扩展](docs/architecture.md)
- [管理 API](docs/api.md)
- [第三方代码、参考数据与许可证](THIRD_PARTY_NOTICES.md)
- [GitHub Releases](https://github.com/UangSC/cpa-gpt-risk-group-plugin/releases)

## 致谢与第三方说明

本项目的宿主契约、检测算法与参考数据衍生或参考自以下开源项目，许可证与详细信息见 [第三方代码、参考数据与许可证](THIRD_PARTY_NOTICES.md)：

- **[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)**：CPA 宿主原生插件 C ABI 与管理接口契约。
- **[UangSC/cpa-plugin-codex-candy-eval](https://github.com/UangSC/cpa-plugin-codex-candy-eval)**：Go 检测算法移植、数字解析与参考挑战组织。
- **[Ikaleio/lm-detector](https://github.com/Ikaleio/lm-detector)**：模型指纹冻结排序器、校准、挑战题与模型参考库。
