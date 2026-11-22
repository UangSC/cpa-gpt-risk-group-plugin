import { useMemo } from 'react'
import { useStore } from '../store/store'
import { resyncCredential, startInspection } from '../store/actions'
import { attentionOf, routedModelName } from '../lib/derive'
import { formatClockPrecise, formatDateTime, formatDateTimePrecise, formatDuration, formatSeconds } from '../lib/format'
import { countRetries, REASON_DESC, REASON_LABEL, VERDICT_LABEL, testLabel } from '../lib/rules'
import { Chip, Collapse, Icon, Modal, SecretName } from '../components/ui'
import { routingFor } from '../lib/routing'
import { methodLabel } from '../inspection'
import { FingerprintEvidencePanel } from './FingerprintEvidencePanel'
import type { RequestAttempt } from '../types'

export function RequestAttempts({ attempts }: { attempts: RequestAttempt[] }) {
  return <table className="attempts">
    <thead>
      <tr>
        <th style={{ width: 46 }}>次序</th>
        <th style={{ width: 74 }}>状态</th>
        <th style={{ width: 150 }}>时间 / 耗时</th>
        <th style={{ width: 96 }}>重试等待</th>
        <th>说明</th>
      </tr>
    </thead>
    <tbody>
      {attempts.map((attempt) => (
        <tr key={attempt.index}>
          <td>#{attempt.index}</td>
          <td><span className={`badge-code ${attempt.status === 200 ? 'is-ok' : typeof attempt.status === 'number' ? 'is-err' : ''}`}>{attempt.status}</span></td>
          <td className="mono" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
            <div>开始 <time dateTime={attempt.at} aria-label={formatDateTimePrecise(attempt.at)}>{formatClockPrecise(attempt.at)}</time></div>
            <div>结束 {attempt.finishedAt ? <time dateTime={attempt.finishedAt} aria-label={formatDateTimePrecise(attempt.finishedAt)}>{formatClockPrecise(attempt.finishedAt)}</time> : '—'}</div>
            <div>耗时 {formatDuration(attempt.durationMs)}</div>
          </td>
          <td>{attempt.waitMs ? formatSeconds(attempt.waitMs) : '—'}</td>
          <td style={{ color: 'var(--text-3)' }}>
            {attempt.localState ? 'CPA 本地冷却 / 未发送上游' : attempt.test
              ? `${methodLabel(attempt.test)} · 第 ${attempt.challengeIndex} 题 · ${attempt.retryIndex ? `共用重试 #${attempt.retryIndex}` : '首次请求'}${attempt.validResponse === false && attempt.status === 200 ? ' · 无效回答' : ''}`
              : attempt.index === 1 ? '首次请求' : attempt.status === 200 ? '重试成功' : '服务错误'}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
}

export function EvidenceSheet() {
  const detail = useStore((s) => s.detail)
  const targets = useStore((s) => s.targets)
  const credentials = useStore((s) => s.credentials)
  const settings = useStore((s) => s.settings)
  const connection = useStore((s) => s.connection)
  const starting = useStore((s) => s.starting)
  const tasks = useStore((s) => s.tasks)
  const syncing = useStore((s) => s.syncing)
  const openDetail = useStore((s) => s.openDetail)
  const closeDetail = useStore((s) => s.closeDetail)
  const target = detail ? targets.find((t) => t.id === detail.targetId) : undefined
  const credential = target ? credentials.find((c) => c.id === target.credentialId) : undefined

  const rounds = target?.rounds ?? []
  const index = useMemo(() => {
    if (!detail) return 0
    if (!detail.roundId) return 0
    const found = rounds.findIndex((r) => r.id === detail.roundId)
    return found < 0 ? 0 : found
  }, [detail, rounds])

  const round = rounds[index]
  const attempts = round?.evidence.attempts ?? []
  const retries = countRetries(attempts)
  const prev = rounds[index + 1]
  const next = index > 0 ? rounds[index - 1] : undefined

  if (!detail || !target) return null

  const attention = credential ? attentionOf(credential) : []
  const groupedModels = credential?.models.length ?? 1
  const syncIssue = attention.find((a) => a.kind === 'sync')
  const routingValues = credential ? routingFor(credential, settings.routing) : null

  return (
    <Modal
      open
      wide
      onClose={closeDetail}
      title={
        <span className="inline" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 14 }}>
            {target.model}
          </span>
          <span className={`verdict verdict-${target.verdict}`}>
            <span className={`dot dot-${target.verdict === 'untested' ? 'empty' : target.verdict}`} />
            {VERDICT_LABEL[target.verdict]}
          </span>
        </span>
      }
      sub={
        <span>
          {credential ? <SecretName name={credential.name} /> : '凭证已删除'}
          {round ? ` · 第 ${rounds.length - index} 轮 / 共 ${rounds.length} 轮 · ${formatDateTime(round.finishedAt)}` : ' · 暂无检测记录'}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!prev}
            onClick={() => prev && openDetail(target.id, prev.id)}
          >
            更早一轮
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!next}
            onClick={() => next && openDetail(target.id, next.id)}
          >
            更新一轮
          </button>
          <span className="spacer" />
          {syncIssue && (
            <button type="button" className="btn btn-sm btn-danger" disabled={connection !== 'connected' || !!credential && syncing.includes(credential.id)} onClick={() => credential && void resyncCredential(credential.id)}>
              重试同步
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={closeDetail}>
            关闭
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!credential || connection !== 'connected' || starting || tasks.some((task) => task.status === 'running' && task.items.some((item) => item.targetId === target.id)) || credential.auth === 'expired'}
            onClick={() => {
              closeDetail()
              startInspection('manual', [target.id])
            }}
          >
            <Icon.Refresh />
            再测一轮
          </button>
        </>
      }
    >
      {!round ? (
        <div className="empty" style={{ padding: '32px 16px' }}>
          <h3>还没有检测记录</h3>
          <p>这个模型尚未执行过检测，因此没有结论、证据或分组变更。</p>
        </div>
      ) : (
        <>
          <div className="ev-grid">
            <div className="ev-cell">
              <div className="k">本轮结论</div>
              <div className="v">
                {round.outcome === 'cancelled'
                  ? '已取消（未形成结论）'
                  : round.outcome === 'blocked'
                    ? '未能检测（状态问题）'
                    : VERDICT_LABEL[round.outcome as 'normal' | 'downshift' | 'uncertain']}
              </div>
            </div>
            <div className="ev-cell">
              <div className="k">判定依据</div>
              <div className="v">{REASON_LABEL[round.reasonCode]}</div>
            </div>
            <div className="ev-cell">
              <div className="k">测试方式</div>
              <div className="v">{testLabel(round.tests)}</div>
            </div>
            <div className="ev-cell">
              <div className="k">耗时 / 尝试</div>
              <div className="v">
                {formatDuration(round.evidence.durationMs)} · {attempts.length} 次
                {retries > 0 ? `（重试 ${retries} 次）` : ''}
              </div>
            </div>
          </div>

          <div className="ev-section">
            <h4>
              说明
              {round.outcome === 'downshift' && <Chip tone="downshift">风控</Chip>}
              {round.outcome === 'uncertain' && <Chip tone="uncertain">不确定</Chip>}
              {round.outcome === 'normal' && <Chip tone="normal">正常</Chip>}
            </h4>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
              {round.reason}。{REASON_DESC[round.reasonCode]}
            </p>
          </div>

          {round.evidence.candy && (
            <div className="ev-section">
              <h4>糖果题</h4>
              <dl className="kv">
                <dt>期望答案</dt>
                <dd>
                  含独立的 <b className="mono">21</b>（允许其它文字表述）
                </dd>
                <dt>实际回答</dt>
                <dd>{round.evidence.candy.matched ? '通过' : '不符'}</dd>
              </dl>
              <pre
                className={`answer ${
                  round.evidence.candy.matched ? 'is-match' : 'is-mismatch'
                }`}
              >
                {round.evidence.candy.answer || '（空回答）'}
              </pre>
              <p className="note">
                <b>判定说明：</b>
                {round.evidence.candy.formatNote}
              </p>
              {round.evidence.candy.question && (
                <Collapse title="题目原文" hint="默认折叠">
                  <pre className="question">{round.evidence.candy.question}</pre>
                </Collapse>
              )}
            </div>
          )}

          {round.evidence.fingerprint && <FingerprintEvidencePanel evidence={round.evidence.fingerprint} />}

          {round.evidence.method && (
            <div className="ev-section">
              <h4>{round.evidence.method.label}</h4>
              <dl className="kv">{round.evidence.method.details.map((entry, entryIndex) => (
                <div className="ev-method-entry" key={entryIndex}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>
              ))}</dl>
            </div>
          )}

          {round.evidence.serviceError && (
            <div className="ev-section">
              <h4>
                频繁请求异常
                <Chip tone={round.outcome === 'downshift' ? 'downshift' : 'uncertain'}>
                  {round.evidence.serviceError.trigger === 'attempts'
                    ? `本轮 ${round.evidence.serviceError.errorAttempts ?? round.evidence.serviceError.codes.length} 次异常`
                    : `连续 ${round.evidence.serviceError.errorRoundsInWindow}/${round.evidence.serviceError.windowSize} 轮`}
                </Chip>
              </h4>
              <p className="note" style={{ marginTop: 0 }}>
                本轮观察到的状态码：
                {round.evidence.serviceError.codes.map((code, index) => (
                  <span className="badge-code is-err" key={`${code}-${index}`} style={{ marginLeft: 5 }}>
                    {code}
                  </span>
                ))}
                。502、503、429 混合计入同一类频繁异常。
                {round.evidence.serviceError.trigger === 'attempts' && ` 本轮达到 ${round.evidence.serviceError.requestThreshold ?? 3} 次门槛，直接归入风控。`}
              </p>
            </div>
          )}

          <div className="ev-section">
            <h4>请求与重试</h4>
            <RequestAttempts attempts={attempts} />
            <p className="note">
              本轮选定检测方式的所有题目共用重试次数，成功题不重复。
              {round.evidence.usage
                ? `本轮消耗约 ${round.evidence.usage.inputTokens.toLocaleString('zh-CN')} 输入 / ${round.evidence.usage.outputTokens.toLocaleString('zh-CN')} 输出 token。`
                : ''}
            </p>
            {round.evidence.errors.length > 0 && (
              <p className="note">
                <b>错误记录：</b>
                {round.evidence.errors.map((e) => `${e.code} ${e.message}（${formatDateTimePrecise(e.at)}）`).join('；')}
              </p>
            )}
          </div>

          <div className="ev-section">
            <h4>
              分组配置
              <Chip
                tone={
                  round.sync?.status === 'failed'
                    ? 'downshift'
                    : round.sync?.status === 'synced'
                      ? 'normal'
                      : 'plain'
                }
              >
                {round.sync?.status === 'failed'
                  ? '同步失败'
                  : round.sync?.status === 'synced'
                    ? '已同步'
                    : '未变更'}
              </Chip>
            </h4>
            <dl className="kv">
              <dt>当前分组方式</dt>
              <dd>
                {settings.routing.mode === 'none'
                  ? '仅检测'
                  : settings.routing.mode === 'prefix'
                    ? '模型前缀'
                    : '仅优先级'}
              </dd>
              <dt>原始模型名</dt>
              <dd className="mono">{target.model}</dd>
              <dt>本轮思考程度</dt>
              <dd>{round.reasoningEffort ? ({ low: '低 (low)', medium: '中 (medium)', high: '高 (high)' } as const)[round.reasoningEffort] : '旧记录未注明'}</dd>
              <dt>当前生效</dt>
              <dd className="mono">
                {credential
                  ? routedModelName(credential, target.model, settings)
                  : `${target.model}（原始名称）`}
              </dd>
              <dt>凭证分组</dt>
              <dd>
                {typeof credential?.prefix === 'string'
                  ? `${credential.group === 'normal' ? '正常' : credential.group === 'downshift' ? '风控' : '未分组'} · 当前前缀 ${credential.prefix || '无前缀'} · 优先级 ${routingValues?.priority ?? 0} · 权重 ${credential.routing?.weight ?? '未知'}`
                  : settings.routing.mode !== 'prefix'
                  ? `${credential?.group === 'normal' ? '正常' : credential?.group === 'downshift' ? '风控' : '未分组'} · 优先级 ${routingValues?.priority ?? 0} · 权重 ${credential?.routing?.weight ?? '未知'}`
                  : credential?.group === 'normal'
                  ? settings.prefixes.normal
                    ? `正常组 ${settings.prefixes.normal}（全部 ${groupedModels} 个模型）`
                    : `正常组不加前缀（全部 ${groupedModels} 个模型保持原始名称）`
                  : credential?.group === 'downshift'
                    ? `风控组 ${settings.prefixes.downshift}（全部 ${groupedModels} 个模型）`
                    : '未分组'}
              </dd>
              <dt>本轮目标</dt>
              <dd>
                {round.sync?.mode === 'none'
                  ? '仅检测（未修改分组或优先级）'
                  : round.sync?.desiredGroup === 'normal'
                    ? `写入正常组；${round.sync.mode === 'priority' ? '按该组优先级调度' : '该凭证的全部模型一起切换'}`
                    : round.sync?.desiredGroup === 'downshift'
                      ? `写入风控组；${round.sync.mode === 'priority' ? '按该组优先级调度' : '该凭证的全部模型一起切换'}`
                      : '本轮不改变分组'}
              </dd>
            </dl>
            {round.sync?.status === 'failed' && (
              <p className="note" style={{ color: 'var(--danger)' }}>
                <b>需要处理：</b>
                {round.sync.message ?? '写入凭证文件失败'}。判定结论已经完成，但分组没有生效，可点击“重试同步”。
              </p>
            )}
            {round.outcome === 'uncertain' && (
              <p className="note">
                本轮没有形成可靠结论，因此分组保持不变（当前为
                {credential?.group === 'normal' ? '正常组' : credential?.group === 'downshift' ? '风控组' : '未分组'}）。
              </p>
            )}
            <p className="note">
              判定按凭证聚合：只要该凭证下有任一模型的最近一轮结论为风控，整个凭证都会留在风控组，
              直到该模型的新一轮检测完整通过。
            </p>
          </div>

          <div className="disclaimer">
            行为测试只能说明“本轮回答与参考分布的接近程度”，不能确认底层实际模型身份。结论用于分流与排查，
            不构成对服务方模型路由的最终判定。认证失效和本地额度预检不计入频繁异常；实际巡检中的重复 502/503/429 按异常规则分组。
          </div>
        </>
      )}
    </Modal>
  )
}


