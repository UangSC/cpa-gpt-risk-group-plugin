import type { FingerprintEvidence } from '../../types'
import { fingerprintThresholdLabel } from '../../lib/inspectionResult'
import { Chip, Collapse } from '../ui'

function probabilityLabel(value: number | null | undefined): string {
  return value == null ? '未计算' : `${(value * 100).toFixed(2)}%`
}

export function FingerprintEvidencePanel({ evidence }: { evidence: FingerprintEvidence }) {
  const challenges = new Set(evidence.samples.map((sample) => sample.challengeId)).size
  const candidates = evidence.candidates ?? []
  return (
    <div className="ev-section fingerprint-evidence">
      <h4>
        模型指纹
        <Chip tone={evidence.consistency === 'consistent' ? 'normal' : evidence.consistency === 'anomalous' ? 'downshift' : 'uncertain'}>
          {evidence.consistency === 'consistent' ? '目标参考通过' : evidence.consistency === 'anomalous' ? '未达正常条件' : '证据不足'}
        </Chip>
      </h4>
      <dl className="kv">
        <dt>三次结果</dt>
        <dd>有效 {evidence.validSamples}/{evidence.challengeCount} 份 · 采集 {evidence.samples.length} 次回答</dd>
        <dt>目标参考</dt>
        <dd>{evidence.enrolledAs || '未登记'}{evidence.referenceMatched === false ? '（未匹配）' : ''}</dd>
        <dt>目标归因概率</dt>
        <dd><b className="mono">{probabilityLabel(evidence.requestedProbability)}</b></dd>
        <dt>最接近参考</dt>
        <dd>{evidence.closestModel ?? '无法归因'}{evidence.closestFamily ? ` · ${evidence.closestFamily}` : ''}</dd>
        <dt>最高候选概率</dt>
        <dd>{probabilityLabel(evidence.probability)}</dd>
        <dt>正常门槛</dt>
        <dd>目标参考匹配，且目标概率严格大于 {fingerprintThresholdLabel(evidence.threshold)}</dd>
        <dt>数字序列均值</dt>
        <dd>{evidence.mean == null ? '未计算' : evidence.mean.toFixed(3)}</dd>
      </dl>
      <p className="note">
        三份有效数字序列共同参与参考库排序与概率校准。这里的概率表示参考库中的模型归因，序列均值仅为描述统计。
      </p>
      {candidates.length > 0 && (
        <Collapse title={`模型指纹概率 · ${candidates.length} 个参考候选`} hint="默认折叠">
          <div className="fingerprint-ranking-wrap">
            <table className="fingerprint-ranking">
              <thead><tr><th scope="col">参考模型</th><th scope="col">家族</th><th scope="col">概率</th></tr></thead>
              <tbody>{candidates.map((candidate) => (
                <tr key={candidate.model} className={candidate.model === evidence.enrolledAs ? 'is-target' : undefined}>
                  <td>{candidate.displayName || candidate.model}{candidate.model === evidence.enrolledAs ? ' · 目标' : ''}</td>
                  <td>{candidate.familyName || candidate.family}</td>
                  <td className="mono">{probabilityLabel(candidate.probability)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Collapse>
      )}
      {evidence.samples.length > 0 && (
        <Collapse title={`${challenges} 道数字挑战 · ${evidence.samples.length} 次回答`} hint="默认折叠">
          <div className="samples">
            {evidence.samples.map((sample, index) => (
              <div className="sample" key={`${sample.challengeId}:${index}`}>
                <div className="fingerprint-sample-body">
                  <div className="sample-prompt">第 {index + 1} 次回答 · {sample.promptSummary}</div>
                  <pre className="sample-text">{sample.sample || '（无回答）'}</pre>
                  {(sample.question || sample.instructions) && (
                    <Collapse title="本次挑战原文" hint="默认折叠">
                      {sample.instructions && <pre className="question">[系统指令]{'\n'}{sample.instructions}</pre>}
                      {sample.question && <pre className="question">[题目]{'\n'}{sample.question}</pre>}
                    </Collapse>
                  )}
                </div>
                <Chip tone={sample.accepted ? 'normal' : 'uncertain'}>
                  {sample.accepted ? '有效' : '无效'} · {sample.numbers.length} 个数字
                </Chip>
              </div>
            ))}
          </div>
        </Collapse>
      )}
      {evidence.referenceBank && (
        <Collapse title="指纹参考库版本" hint="默认折叠">
          <dl className="kv">
            <dt>参考候选</dt><dd>{evidence.referenceBank.modelCount} 个</dd>
            <dt>构建时间</dt><dd>{evidence.referenceBank.builtAt}</dd>
            <dt>参考数据</dt><dd className="mono">{evidence.referenceBank.revision}</dd>
            <dt>来源提交</dt><dd className="mono">{evidence.referenceBank.sourceCommit}</dd>
          </dl>
        </Collapse>
      )}
    </div>
  )
}
