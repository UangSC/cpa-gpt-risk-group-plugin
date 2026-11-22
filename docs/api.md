# 管理 API

基路径：`/v0/management/plugins/cpa-codex-downshift-classifier`。所有请求由 CPA 校验 `Authorization: Bearer <管理密钥>`，浏览器客户端固定使用当前 CPA 来源。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/snapshot` | 凭证、目标、历史、任务、设置和能力 |
| POST | `/checks` | 启动手动或批量巡检 |
| GET | `/tasks?id=<taskId>` | 读取任务 |
| POST | `/tasks/cancel?id=<taskId>` | 取消任务 |
| POST | `/history/clear` | 清空历史巡检批次与检测证据 |
| POST | `/sync` | 重试待同步分组 |
| PUT | `/settings` | 保存完整设置 |
| PUT | `/routing` | 编辑或重置凭证优先级 |
| POST | `/exclusions` | 保存是否参与巡检 |
| POST | `/quota/refresh` | 主动刷新明确提交的当前页凭证额度 |

宿主只支持固定管理路由，任务 ID 使用查询参数。JSON 类型见后端 `internal/classifier/types.go` 与页面 `src/types.ts`。

## 启动巡检

```json
{
  "credentialIds": ["<凭证ID>"],
  "model": "gpt-6.1-sol",
  "method": "candy",
  "scope": "manual",
  "acknowledgeConfigChanges": true,
  "configChangesMode": "prefix",
  "configChangesRevision": "<当前快照的配置版本>"
}
```

省略 `credentialIds` 时选择全部符合条件的凭证，仍排除不参与巡检的凭证。外部请求只使用 `manual` 或 `batch`；定时任务由后台调度并检查已保存的授权。

配置可能写入凭证前缀或优先级，因此手动请求必须提交确认、当前写入模式和配置版本。版本变化、已有运行任务或选中凭证均被排除时返回 409。成功返回 `taskId`，后续从快照或任务接口读取进度。

`method` 支持 `candy` 与 `fingerprint`，并且必须与已保存的检测方式一致。指纹模式需先保存设置、取得新的确认版本；它采集三份有效结果后才计算目标参考概率，正常要求严格大于 0.90。认证、额度、网络或样本不足不能被伪装为指纹概率。

## 设置与路由

`PUT /settings` 保存完整设置对象，草稿应基于当前快照。配置包括前缀、写入模式、分组优先级、检测模型、重试、额度策略、并发、思考程度、头覆盖、定时和界面偏好。

开启或改变影响定时执行的设置时，本次提交需临时附带 `acknowledgeScheduledConfigChanges: true`；确认字段不作为页面普通设置保存。后台保存授权指纹，旧授权不能覆盖新的检测和写入规则。

`PUT /routing` 接收 `{credentialId, priority?, weight?, reset?}`；`POST /sync` 接收 `{credentialId}`。权重默认读取 CPA 当前值，加权轮询下可显式提交 0～9999 的单凭证权重。重置仅恢复分组默认优先级。

设置可能已经保存，但部分凭证同步失败；此时接口返回 409，客户端应刷新真实状态并保留设置草稿。单次设置更新不构成跨凭证事务。

## 排除凭证

```json
{
  "credentialIds": ["<凭证ID>"],
  "excluded": true
}
```

只保存参与状态，不禁用 CPA 凭证、不改写路由和历史。运行中尚未完成的凭证不能移入排除池。恢复参与不会自动启动巡检。

CPA 已停用的凭证自动进入不参与巡检池。快照中的 `disabled: true` 表示 CPA 停用，`inspectionExcluded` 表示实际是否排除。重新启用后，只有此前手动排除过的凭证仍留在池中。对停用凭证提交恢复会返回 409。

## 快照与判定

快照的 `source` 为 `live`，同时返回 `configChangesRevision`、`requestHeaderProfile`、凭证、检测目标、任务、设置与能力。缺少可靠的额度、会话或指纹信息时返回未知，不补造数据。

每轮证据记录实际题目、答案、尝试状态、错误、用量、耗时和配置同步结果。只有完整模型响应才能进入答案判定；401/403、CPA 本地冷却与网络问题保持独立原因。真实 502/503/429 默认单轮累计 3 次即降档并停止继续请求；未达单轮门槛时，连续 2 轮未完成检测且出现这些错误也会降档，成功或其它原因中断连续累计。

轮次包含 `taskId` 和 `batchStartedAt`，任务包含 `method`，用于历史和进行中任务按同一批次展示。状态版本 8 保留旧设置与历史，并加入频繁错误门槛和主动额度。旧默认重试等待迁移为 5 秒、10 秒，默认巡检并发迁移为 4；自定义重试保留，旧定时授权因判定规则变化失效，需要重新确认。任务超出保留数量后，轮次仍保留独立的批次身份和开始时间。

指纹证据包括 `challengeCount`、`validSamples`、各次回答、`requestedProbability`（目标参考概率）、`probability`（最高候选概率）、`candidates`、`threshold` 与 `referenceBank`。缺少可靠概率时字段为 `null`；成功题不重跑，失败尝试计入统一重试预算。

`failureRule.requestThreshold` 支持 2～5，默认 3；`failureRule.windowRounds` 为连续失败轮数门槛。`concurrency.maxObjects` 支持 1～9，默认 4。尝试证据增加 `finishedAt` 和可选 `localState`，任务条目增加 `lastStatus` 与 `retryAt`；历史中的 `waitMs` 为该次请求前实际完成的计划等待。等待取配置退避、宿主传递的 `Retry-After` 和官方 `next_retry_after` 冷却期限中最长者，超过 120 秒则停止本轮重试。当前原生 RPC 错误信封不含响应头，错误后通过官方运行态读取冷却期限；冷却到期后再请求，不改写宿主冷却状态。已有真实异常后的本地冷却不冒充新的上游 429，也不抹去真实异常证据。

## 清空历史巡检

`POST /history/clear` 要求明确提交 `{"confirm":true}`，缺少确认返回 400，仍有巡检在运行或收尾时返回 409。成功返回 `{"ok":true}`。历史批次、结论和检测依据会永久删除，历史统计与跨轮异常计数从后续巡检重新累积。已生效的凭证分组、路由及插件设置继续使用。

## 刷新额度

`POST /quota/refresh` 接收 `{credentialIds: ["<凭证ID>"]}`，只刷新明确提交的 Codex 凭证，同时最多执行四个额度查询。上游地址固定为 Codex 额度接口，认证令牌由 CPA 代换。额度查询与模型巡检共用已保存的请求头覆盖，使用 JSON 响应类型。浏览器不能在额度刷新请求中传入上游地址或请求头。此操作不启动模型巡检、不改变凭证分类。

成功返回 `{refreshedIds: ["<凭证ID>"], failed: [{credentialId: "<凭证ID>", error: "<安全错误说明>"}]}`。部分失败保持对应凭证此前的额度；成功额度持久保存，随后读取快照更新卡片。`capabilities.quotaRefreshAvailable` 表示当前适配器是否支持此操作。额度包含可选 `observedAt`，用于选择更新的主动或被动数据，过期窗口不继续显示为有效额度。
