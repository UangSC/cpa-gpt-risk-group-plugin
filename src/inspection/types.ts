import type { CandyEvidence, FingerprintSample, PelicanEvidence } from '../types'

/** 检测方式描述使用的响应形状；真实模型请求由 Go 服务端执行。 */
export interface ProbeReply {
  status: number | 'network-error'
  durationMs: number
  candy?: CandyEvidence
  sample?: FingerprintSample
  pelican?: PelicanEvidence
  data?: unknown
}
