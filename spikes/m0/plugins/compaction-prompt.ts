// M0 待验证项 4：能否把 DSH 自带压缩用的摘要提示词换成我们自己的。
// DSH 0.2.1-rc.5 没有提示词配置项（写死在 dsh-compaction-basic），这里照 dsh-tavern 的做法：
// 拦截 purpose 为 compaction 的模型请求，把最后那条压缩指令换成案件版提示词，再重新发出。
// 只改发给假模型的请求，不影响用真实模型的会话。
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export const name = 'casebook-compaction-prompt'
export const inject = ['llm']

const CASE_SUMMARY_PROMPT = '【案件版摘要】保留已发现的线索和每个人的关键说法，按轮次写成要点。'
const LOG = '[casebook-compaction-prompt]'

export function apply(ctx: Context) {
  const rewritten = new WeakSet<GenerateOptions>()
  ctx.on('llm/stream', (options, next) => {
    const last = options.messages.at(-1)
    const isDirective = last?.role === 'user' && last.id === undefined
    if (options.purpose !== 'compaction' || options.provider !== 'casebook-fake' || rewritten.has(options) || !isDirective) {
      return next()
    }
    const request: GenerateOptions = {
      ...options,
      messages: [...options.messages.slice(0, -1), { role: 'user', content: [{ type: 'text', text: CASE_SUMMARY_PROMPT }] }],
    }
    rewritten.add(request)
    console.log(LOG, '已换掉压缩提示词', String(options.sessionId ?? ''))
    return ctx.llm.stream(request)
  })
}
