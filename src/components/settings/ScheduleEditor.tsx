import type { BusySessionPolicy } from '../../types'
import { useStore } from '../../store/store'
import { useSettingsEditor } from '../../store/settingsEditor'
import { changedSettings } from '../../lib/settingsDraft'
import { computeNextRun } from '../../lib/schedule'
import { formatCountdown, formatDateTime } from '../../lib/format'
import { Icon, Segmented, Select, Switch, useNow } from '../ui'
import { TimeRangeEditor } from './TimeRangeEditor'
import { SettingsPanel } from './SettingsPanel'

const SESSION_POLICY_OPTIONS: { value: BusySessionPolicy; label: string }[] = [
  { value: 'under-limit', label: '低于阈值巡检' },
  { value: 'always', label: '始终巡检' },
  { value: 'skip-busy', label: '有会话跳过' },
]

export function ScheduleEditor() {
  const { settings, update } = useSettingsEditor()
  const actual = useStore((state) => state.settings)
  const now = useNow(15_000)
  const schedule = settings.schedule
  const policy: BusySessionPolicy = schedule.busySessionPolicy ?? 'under-limit'
  const limit = schedule.maxBusySessions ?? 3
  const scheduledQuotaMin = schedule.minRemainingPercent ?? settings.quota.minRemainingPercent
  const changed = changedSettings(actual, settings).includes('schedule')
  const next = changed ? computeNextRun(settings, now) : actual.schedule.nextRunAt ?? computeNextRun(settings, now)

  return (
    <SettingsPanel icon={<Icon.History />} title="定时巡检" desc="默认关闭。开启或修改时间后，确认保存才会生效；时间按北京时间（Asia/Shanghai）计算。">
      <div className="field">
        <Switch
          checked={schedule.enabled}
          onChange={(enabled) => update({ schedule: { ...schedule, enabled } })}
          label={schedule.enabled ? '开启定时巡检' : '不定时巡检（手动触发）'}
        />
      </div>
      {schedule.enabled ? (
        <>
          <div className="field">
            <Segmented
              ariaLabel="定时方式"
              value={schedule.mode}
              onChange={(mode) => update({ schedule: { ...schedule, mode } })}
              options={[
                { value: 'interval', label: '按间隔' },
                { value: 'daily', label: '每天定时' },
                { value: 'windows', label: '自定义时间段' },
              ]}
            />
          </div>
          {schedule.mode === 'daily' ? (
            <div className="field">
              <label className="field-label" htmlFor="schedule-time">每天执行时间</label>
              <input
                id="schedule-time"
                type="time"
                className="input"
                value={schedule.dailyTime}
                onChange={(event) => update({ schedule: { ...schedule, dailyTime: event.target.value } })}
              />
            </div>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="schedule-interval">
                {schedule.mode === 'windows' ? '时间段内巡检间隔' : '执行间隔'}
              </label>
              <Select
                id="schedule-interval"
                ariaLabel={schedule.mode === 'windows' ? '时间段内巡检间隔' : '执行间隔'}
                value={String(schedule.intervalMinutes)}
                onChange={(nextInterval) => update({ schedule: { ...schedule, intervalMinutes: Number(nextInterval) } })}
                options={[15, 30, 60, 120, 180, 360, 720, 1440].map((minutes) => ({
                  value: String(minutes),
                  label: minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`,
                }))}
              />
            </div>
          )}
          {schedule.mode === 'windows' && (
            <TimeRangeEditor
              windows={schedule.windows}
              onChange={(windows) => update({ schedule: { ...schedule, windows } })}
            />
          )}

          <div className="field">
            <div className="field-label">
              定时巡检额度门槛
              <span className="field-optional">独立于全局额度门槛</span>
            </div>
            <div className="schedule-session-limit">
              <span>仅检测剩余额度高于</span>
              <div className="input-group input-compact">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={scheduledQuotaMin}
                  aria-label="定时巡检最低剩余额度阈值"
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    const nextQuota = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.trunc(parsed))) : 0
                    update({
                      schedule: {
                        ...schedule,
                        minRemainingPercent: nextQuota,
                      },
                    })
                  }}
                />
                <span className="unit">%</span>
              </div>
              {scheduledQuotaMin !== settings.quota.minRemainingPercent && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() =>
                    update({
                      schedule: {
                        ...schedule,
                        minRemainingPercent: settings.quota.minRemainingPercent,
                      },
                    })
                  }
                >
                  同步全局（{settings.quota.minRemainingPercent}%）
                </button>
              )}
            </div>
            <div className="field-hint">
              仅作用于定时巡检，取凭证所有已知额度窗口最低剩余比例判断（等于阈值时不检测）；额度未知时的处理仍沿用全局设置。
            </div>
          </div>

          <div className="field">
            <div className="field-label">存在活跃会话时</div>
            <Segmented
              ariaLabel="定时巡检活跃会话处理策略"
              value={policy}
              onChange={(busySessionPolicy) =>
                update({
                  schedule: {
                    ...schedule,
                    busySessionPolicy,
                    maxBusySessions: schedule.maxBusySessions ?? 3,
                  },
                })
              }
              options={SESSION_POLICY_OPTIONS}
            />
            {policy === 'under-limit' && (
              <div className="schedule-session-limit">
                <span>并发会话数 &lt;</span>
                <div className="input-group input-compact">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={limit}
                    aria-label="触发定时巡检的最大并发会话数"
                    onChange={(event) => {
                      const parsed = Math.trunc(Number(event.target.value))
                      const nextLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(99, parsed) : 1
                      update({
                        schedule: {
                          ...schedule,
                          busySessionPolicy: policy,
                          maxBusySessions: nextLimit,
                        },
                      })
                    }}
                  />
                  <span className="unit">个时巡检</span>
                </div>
              </div>
            )}
            <div className="field-hint">
              {policy === 'always'
                ? '无论凭证当前是否有会话，到点均照常执行巡检。'
                : policy === 'skip-busy'
                  ? '检测到凭证正在会话时，本次定时巡检跳过该账号。'
                  : `默认当凭证并发会话数 < ${limit} 时执行巡检；达到或超过 ${limit} 个时跳过，避免影响业务请求。`}
            </div>
          </div>

          <div className="schedule-note">
            <Icon.History />
            <span>
              {next
                ? `${changed ? '保存后下一次巡检' : '下一次巡检'}：${formatDateTime(next)}（${formatCountdown(next, now)}）`
                : '请先设置有效时间段，保存后才会安排巡检。'}
            </span>
          </div>
        </>
      ) : (
        <div className="schedule-note">
          <Icon.Info />
          <span>关闭时只执行手动巡检。保存关闭后不会产生新的定时任务。</span>
        </div>
      )}
      <p className="field-hint">定时巡检使用上述独立额度门槛与活跃会话策略，并遵循并发限制。到点时若已有任务，本次跳过并等待下一个计划时间。</p>
    </SettingsPanel>
  )
}
