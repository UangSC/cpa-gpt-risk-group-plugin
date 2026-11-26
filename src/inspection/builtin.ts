import { registerInspectionMethod } from './registry'

registerInspectionMethod({
  id: 'candy', label: '糖果题',
  description: '正常只询问一次；答案不符直接判定，异常或无有效回答才重试。',
  challengeCount: 1,
  validateReply: (reply) => !!reply.candy?.answer.trim(),
  stopAfterReply: (reply) => reply.candy?.matched === false,
})
registerInspectionMethod({
  id: 'fingerprint', label: '模型指纹',
  description: '采集三份有效数字序列后合并归因。未收录模型或证据不足时保持不确定。',
  challengeCount: 3,
  validateReply: (reply) => !!reply.sample?.accepted &&
    reply.sample.numbers.length > 0 && reply.sample.numbers.every(Number.isFinite),
})
registerInspectionMethod({
  id: 'pelican', label: '画鹈鹕',
  description: '仅请求绘制「鹈鹕骑自行车」SVG 循环动画，输出后由人工肉眼判定风控分组。',
  challengeCount: 1,
  validateReply: (reply) => Boolean(reply.pelican?.svg?.trim()),
})
