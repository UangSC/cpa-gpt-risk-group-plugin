/**
 * Domain model for the Codex risk-group classifier (cpa-gpt-risk-group-plugin).
 *
 * Classification happens at the **credential** level: a Codex account that serves a
 * degraded model serves it for every model name it exposes, so one account is one
 * routing decision. Detection evidence is still recorded per (credential × model)
 * *target*, because a single model name is what a test can actually probe.
 *
 * These types are the single boundary between the UI and any backend. See
 * `src/api/contract.ts` for the HTTP-shaped projection of the same data.
 */

/** The behavioural tests this plugin can run. */
export type TestKind = 'candy' | 'fingerprint' | (string & {})
export type ReasoningEffort = 'low' | 'medium' | 'high'

/**
 * Conclusion of an inspection for one target.
 * - `normal`    — every selected test passed in a complete round
 * - `downshift` — a rule fired: candy mismatch, fingerprint anomaly, repeated 502/503/429
 * - `uncertain` — evidence missing/insufficient, first service error, partial round
 * - `untested`  — never inspected, or no usable data
 */
export type Verdict = 'normal' | 'downshift' | 'uncertain' | 'untested'

/** Machine-readable reason for a round's outcome; drives copy and filtering. */
export type ReasonCode =
  | 'all-tests-passed'
  | 'passed-after-retry'
  | 'candy-mismatch'
  | 'fingerprint-anomaly'
  | 'fingerprint-insufficient'
  | 'repeated-service-errors'
  | 'single-service-error'
  | 'auth-expired'
  | 'quota-exhausted'
  | 'cancelled'
  | 'no-model-response'
  | 'method-result'

export type RoundOutcome = 'normal' | 'downshift' | 'uncertain' | 'cancelled' | 'blocked'

export type GroupKey = 'normal' | 'downshift'

/* ------------------------------------------------------------------ quota */

export interface QuotaWindow {
  /** Short label as the upstream window reports it, e.g. `5h` / `7d`. */
  key: '5h' | '7d'
  /** Remaining quota percentage, 0–100. `null` means the upstream did not report it. */
  remainingPercent: number | null
  resetsAt: string | null
}

export interface Quota {
  windows: QuotaWindow[]
  /** 后台额度观测时间；未提供时不推测数据的新鲜度。 */
  observedAt?: string
  /** `unknown` means every window is missing data — never treat it as 0%. */
  status: 'known' | 'unknown' | 'exhausted'
}

/* --------------------------------------------------------------- evidence */

export interface RequestAttempt {
  /** CPA 本地守卫结束请求，此状态未收到上游响应。 */
  localState?: boolean
  /** 1-based attempt number within the round. */
  index: number
  status: number | 'network-error'
  at: string
  finishedAt?: string
  /** The backoff delay waited before this attempt; 0 for the first attempt. */
  waitMs: number
  durationMs: number
  test?: TestKind
  challengeIndex?: number
  retryIndex?: number
  validResponse?: boolean
}

export interface CandyEvidence {
  promptId: string
  /** The question text, kept so the evidence sheet can show exactly what was asked. */
  question: string
  /** What a correct answer must contain, e.g. the standalone number `21`. */
  expected: string
  /** Verbatim model answer, already truncated by the backend. */
  answer: string
  /** `true` when the expected value appears as a standalone token (format-tolerant). */
  matched: boolean
  /** Why formatting differences were accepted or not; shown verbatim in the evidence sheet. */
  formatNote: string
}

export interface FingerprintSample {
  challengeId: string
  /** Human-readable summary of the numeric challenge. */
  promptSummary: string
  expectedCount: number
  numbers: number[]
  accepted: boolean
  sample: string
  question?: string
  instructions?: string
}

export interface FingerprintEvidence {
  challengeCount: number
  validSamples: number
  /** The reference model whose answer distribution is closest. */
  closestModel: string | null
  closestFamily: string | null
  /** Attribution probability of the closest reference, 0–1. */
  probability: number | null
  /**
   * `consistent`  — closest reference is the enrolled reference for the requested model
   * `anomalous`   — a different reference family dominates the answer distribution
   * `insufficient`— too few usable answers to attribute anything
   */
  consistency: 'consistent' | 'anomalous' | 'insufficient'
  /** The reference bank entry the requested model is enrolled under (alias), not a model claim. */
  enrolledAs: string
  samples: FingerprintSample[]
  /** 正常门槛为严格大于此值；概率为参考库归因，不是模型身份保证。 */
  threshold?: number
  requestedProbability?: number | null
  referenceMatched?: boolean
  decision?: string
  candidates?: {
    model: string
    displayName: string
    family: string
    familyName: string
    probability: number | null
    score: number
  }[]
  mean?: number | null
  sequence?: { autocorrelation: number; smallStepShare: number; modelLike: boolean } | null
  referenceBank?: { revision: string; builtAt: string; sourceCommit: string; modelCount: number; portCommit?: string; suiteRevision?: string }
}

export interface ServiceErrorEvidence {
  /** HTTP statuses observed across the round, in order. */
  codes: number[]
  /** 判定窗口内出现 502、503 或 429 的失败轮次数，包括当前轮。 */
  errorRoundsInWindow: number
  windowSize: number
  errorAttempts?: number
  requestThreshold?: number
  trigger?: 'attempts' | 'rounds'
}

export interface RoundEvidence {
  tests: TestKind[]
  candy?: CandyEvidence
  fingerprint?: FingerprintEvidence
  serviceError?: ServiceErrorEvidence
  attempts: RequestAttempt[]
  errors: { at: string; code: number; message: string }[]
  usage: { inputTokens: number; outputTokens: number } | null
  durationMs: number
  method?: { id: TestKind; label: string; details: { label: string; value: string }[] }
}

/* ------------------------------------------------------------- sync state */

/**
 * Writing the group prefix to the credential file is a separate, fallible step.
 * A finished verdict with `pending`/`failed` sync still needs the operator's attention.
 * One group is applied to every model the credential exposes.
 */
export interface GroupSync {
  mode?: GroupingMode
  desiredGroup: GroupKey | null
  appliedGroup: GroupKey | null
  status: 'not-needed' | 'synced' | 'pending' | 'failed'
  at: string | null
  message: string | null
}

/* ----------------------------------------------------------------- rounds */

export interface InspectionRound {
  id: string
  taskId?: string
  batchStartedAt?: string
  targetId: string
  startedAt: string
  finishedAt: string
  scope: 'manual' | 'batch' | 'scheduled'
  tests: TestKind[]
  outcome: RoundOutcome
  reasonCode: ReasonCode
  /** One-line human reason; the evidence sheet adds detail. */
  reason: string
  evidence: RoundEvidence
  /** Sync outcome produced by this round, if the round asked for a prefix change. */
  sync: GroupSync | null
  reasoningEffort?: ReasoningEffort
}

/* ---------------------------------------------------------------- targets */

export interface Credential {
  id: string
  /** Display identity; rendered masked. Never an API key or access token. */
  name: string
  /** Auth file that CLIProxyAPI manages for this credential. */
  file: string
  plan: string
  auth: 'valid' | 'expired'
  /** `busy` means the credential currently serves live sessions; scheduled checks apply `busySessionPolicy`. */
  availability: 'idle' | 'busy' | 'unknown'
  /** CPA 官方报告的暂不可用或冷却，不等同于令牌失效。 */
  disabled?: boolean
  unavailable?: boolean
  busySessions: number
  quota: Quota
  models: string[]
  /** CPA 官方凭证字段中当前实际生效的模型前缀；模型列表仍使用原始 ID。 */
  prefix?: string
  /** Routing group applied to every model of this credential. */
  group: GroupKey | null
  sync: GroupSync
  /** CPA 当前实际生效的调度数值。 */
  routing?: RoutingValues
  /** 只控制是否参与插件巡检，不改变 CPA 的凭证启用状态或分组。 */
  inspectionExcluded?: boolean
  excludedAt?: string | null
}

/**
 * One probeable (credential × model) combination. It carries the evidence and the
 * per-model conclusion; the credential aggregate decides the group.
 */
export interface Target {
  id: string
  credentialId: string
  model: string
  verdict: Verdict
  /** Newest round first. */
  rounds: InspectionRound[]
  /** Set when the last round could not judge at all (auth/quota), never a model-quality claim. */
  blocked: { kind: 'auth' | 'quota'; message: string } | null
}

/* -------------------------------------------------------------- run state */

export type RunItemState =
  | 'queued'
  | 'waiting'
  | 'running'
  | 'retrying'
  | 'done'
  | 'skipped'
  | 'cancelled'
  | 'failed'

export interface RunItem {
  targetId: string
  state: RunItemState
  /** Why it is waiting / skipped / cancelled — always shown to the operator. */
  note: string | null
  startedAt: string | null
  finishedAt: string | null
  attempt: number
  currentTest: TestKind | null
  lastStatus?: number | string
  retryAt?: string | null
}

export interface InspectionTask {
  id: string
  scope: 'manual' | 'batch' | 'scheduled'
  label: string
  method?: TestKind
  createdAt: string
  finishedAt: string | null
  status: 'running' | 'cancelled' | 'completed'
  items: RunItem[]
  /** Objects allowed to run concurrently in this task. */
  concurrency: number
}

/* --------------------------------------------------------------- settings */

export interface RetryPolicy {
  /** 本轮所有检测题共用的额外重试次数。成功题不重复执行。 */
  maxRetries: number
  /** Delay before the first retry. */
  baseDelayMs: number
  /** Exponential factor applied per further retry. */
  backoffFactor: number
}

export interface PrefixSettings {
  /** Empty means "keep the original model name" (no prefix). */
  normal: string
  downshift: string
}

export interface RoutingValues {
  priority: number
  /** 读取自 CPA 当前值；加权轮询下可单凭证手动编辑，巡检与分组同步不自动改写权重。 */
  weight: number
}

export type RoutingGroup = GroupKey | 'ungrouped'
export type GroupingMode = 'none' | 'prefix' | 'priority'

export interface RoutingSettings {
  mode: GroupingMode
  groups: Record<RoutingGroup, RoutingValues>
  overrides: Record<string, RoutingValues>
}

export interface QuotaGate {
  /** Only credentials whose lowest remaining window is *above* this run their checks. */
  minRemainingPercent: number
  /** What to do when no window reports a value. */
  unknownPolicy: 'check' | 'skip'
}

export type BusySessionPolicy = 'always' | 'under-limit' | 'skip-busy'

export interface ScheduleSettings {
  enabled: boolean
  mode: 'interval' | 'daily' | 'windows'
  intervalMinutes: number
  /** `HH:mm`, local time, only used when `mode === 'daily'`. */
  dailyTime: string
  windows: { id: string; startMinute: number; endMinute: number }[]
  /** 定时巡检遇到凭证存在活跃会话时的处理策略。 */
  busySessionPolicy?: BusySessionPolicy
  /** 策略为 `under-limit` 时，并发会话数严格小于该值才触发巡检（默认 3）。 */
  maxBusySessions?: number
  /** 定时巡检独立额度门槛（%）；默认与全局额度门槛一致。 */
  minRemainingPercent?: number
  /** Populated only while `enabled`; cleared when scheduling is turned off. */
  nextRunAt: string | null
}

export interface Settings {
  prefixes: PrefixSettings
  routing: RoutingSettings
  inspectionMethod: TestKind
  retry: RetryPolicy
  /** 单轮达到请求阈值，或连续窗口内各轮以 502/503/429 失败时归为风控。 */
  failureRule: { windowRounds: number; requestThreshold: number }
  quota: QuotaGate
  concurrency: { maxObjects: number }
  /**
   * The single model used to probe every credential. The group prefix is registered for
   * *all* models of a credential, so the UI never needs one verdict per model name.
   */
  inspectionModel: string
  /** 真实巡检请求使用的思考程度，只允许这三档。 */
  reasoningEffort: ReasoningEffort
  headerOverrides: Record<string, string>
  pagination: { list: number; card: number; pool: number; statistics: number }
  /** Presentation preference for the credential list. */
  layout: 'list' | 'card' | 'pool'
  /** Blur credential identities (the eye button in the overview toolbar). */
  maskNames: boolean
  schedule: ScheduleSettings
  theme: 'light' | 'dark'
}

/* ------------------------------------------------------------ app notices */

export interface Toast {
  id: string
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  detail?: string
}

export interface InspectionConfirmation {
  scope: 'manual' | 'batch'
  credentialIds: string[]
  settings: Settings
  revision: string
  excludedCount: number
  requestedCount: number
}
