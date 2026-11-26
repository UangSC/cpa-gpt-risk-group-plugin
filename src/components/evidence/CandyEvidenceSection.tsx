import type { CandyEvidence } from '../../types'
import { Collapse } from '../ui'

export function CandyEvidenceSection({ candy }: { candy: CandyEvidence }) {
  return (
    <div className="ev-section">
      <h4>糖果题</h4>
      <dl className="kv">
        <dt>期望答案</dt>
        <dd>
          含独立的 <b className="mono">{candy.expected}</b>（允许其它文字表述）
        </dd>
        <dt>实际回答</dt>
        <dd>{candy.matched ? '通过' : '不符'}</dd>
      </dl>
      <pre className={`answer ${candy.matched ? 'is-match' : 'is-mismatch'}`}>
        {candy.answer || '（空回答）'}
      </pre>
      <p className="note">
        <b>判定说明：</b>
        {candy.formatNote}
      </p>
      {candy.question && (
        <Collapse title="题目原文" hint="默认折叠">
          <pre className="question">{candy.question}</pre>
        </Collapse>
      )}
    </div>
  )
}
