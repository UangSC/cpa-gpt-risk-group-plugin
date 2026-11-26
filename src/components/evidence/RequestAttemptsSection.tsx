import type { Credential, InspectionRound, RequestAttempt, Settings, Target } from '../../types'
import { routedModelName } from '../../lib/derive'
import { formatClockPrecise, formatDateTimePrecise, formatDuration, formatSeconds } from '../../lib/format'
import { routingFor } from '../../lib/routing'
import { methodLabel } from '../../inspection'
import { Chip } from '../ui'

export function RequestAttempts({ attempts }: { attempts: RequestAttempt[] }) {
  return (
    <table className="attempts">
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
            <td>
              <span
                className={`badge-code ${
                  attempt.status === 200 ? 'is-ok' : typeof attempt.status === 'number' ? 'is-err' : ''
                }`}
              >
                {attempt.status}
              </span>
            </td>
            <td className="mono" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
              <div>
                开始{' '}
                <time dateTime={attempt.at} aria-label={formatDateTimePrecise(attempt.at)}>
                  {formatClockPrecise(attempt.at)}
                </time>
              </div>
              <div>
                结束{' '}
                {attempt.finishedAt ? (
                  <time dateTime={attempt.finishedAt} aria-label={formatDateTimePrecise(attempt.finishedAt)}>
                    {formatClockPrecise(attempt.finishedAt)}
                  </time>
                ) : (
                  '—'
                )}
              </div>
              <div>耗时 {formatDuration(attempt.durationMs)}</div>
            </td>
            <td>{attempt.waitMs ? formatSeconds(attempt.waitMs) : '—'}</td>
            <td style={{ color: 'var(--text-3)' }}>
              {attempt.localState
                ? 'CPA 本地冷却 / 未发送上游'
                : attempt.test
                  ? `${methodLabel(attempt.test)} · 第 ${attempt.challengeIndex} 题 · ${
                      attempt.retryIndex ? `共用重试 #${attempt.retryIndex}` : '首次请求'
                    }${attempt.validResponse === false && attempt.status === 200 ? ' · 无效回答' : ''}`
                  : attempt.index === 1
                    ? '首次请求'
                    : attempt.status === 200
                      ? '重试成功'
                      : '服务错误'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RequestAndSyncSections({
  round,
  target,
  credential,
  settings,
}: {
  round: InspectionRound
  target: Target
  credential: Credential | undefined
  settings: Settings
}) {
  const attempts = round.evidence.attempts
  const groupedModels = credential?.models.length ?? 1
  const routingValues = credential ? routingFor(credential, settings.routing) : null

  return (
    <>
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
            {round.evidence.serviceError.trigger === 'attempts' &&
              ` 本轮达到 ${round.evidence.serviceError.requestThreshold ?? 3} 次门槛，直接归入风控。`}
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
          <p className="note" style={{ color: 'var(--danger)' }}>
            <b>错误记录：</b>
            {round.evidence.errors
              .map((e) => `${e.code ? `HTTP ${e.code} ` : ''}${e.message}（${formatDateTimePrecise(e.at)}）`)
              .join('；')}
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
          <dd>
            {round.reasoningEffort
              ? ({ low: '低 (low)', medium: '中 (medium)', high: '高 (high)' } as const)[round.reasoningEffort]
              : '旧记录未注明'}
          </dd>
          <dt>当前生效</dt>
          <dd className="mono">
            {credential ? routedModelName(credential, target.model, settings) : `${target.model}（原始名称）`}
          </dd>
          <dt>凭证分组</dt>
          <dd>
            {typeof credential?.prefix === 'string'
              ? `${
                  credential.group === 'normal' ? '正常' : credential.group === 'downshift' ? '风控' : '未分组'
                } · 当前前缀 ${credential.prefix || '无前缀'} · 优先级 ${routingValues?.priority ?? 0} · 权重 ${
                  credential.routing?.weight ?? '未知'
                }`
              : settings.routing.mode !== 'prefix'
                ? `${
                    credential?.group === 'normal' ? '正常' : credential?.group === 'downshift' ? '风控' : '未分组'
                  } · 优先级 ${routingValues?.priority ?? 0} · 权重 ${credential?.routing?.weight ?? '未知'}`
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
    </>
  )
}
