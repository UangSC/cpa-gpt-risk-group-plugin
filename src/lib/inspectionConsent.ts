import type { Settings } from '../types'

/** 与后台权限范围一致：只比较会影响巡检、配置写入或执行时段的设置。 */
export function inspectionRisk(settings: Settings) {
  return {
    prefixes: settings.prefixes,
    routing: {
      mode: settings.routing.mode,
      groups: Object.fromEntries(Object.entries(settings.routing.groups).map(([key, value]) => [key, value.priority])),
      overrides: Object.fromEntries(Object.entries(settings.routing.overrides).map(([key, value]) => [key, value.priority])),
    },
    inspectionModel: settings.inspectionModel,
    reasoningEffort: settings.reasoningEffort,
    headerOverrides: settings.headerOverrides ?? {},
    inspectionMethod: settings.inspectionMethod,
    ...(settings.inspectFreeAccounts ? { inspectFreeAccounts: true } : {}),
    ...(settings.inspectionMethod === 'fingerprint' ? { fingerprintThresholdPercent: settings.fingerprintThresholdPercent } : {}),
    retry: settings.retry, failureRule: settings.failureRule, quota: settings.quota,
    concurrency: settings.concurrency,
    schedule: { ...settings.schedule, nextRunAt: null },
  }
}

export function needsScheduledConsent(current: Settings, next: Settings): boolean {
  return next.schedule.enabled && (!current.schedule.enabled ||
    JSON.stringify(inspectionRisk(current)) !== JSON.stringify(inspectionRisk(next)))
}

export function sameInspectionRisk(a: Settings, b: Settings): boolean {
  return JSON.stringify(inspectionRisk(a)) === JSON.stringify(inspectionRisk(b))
}
