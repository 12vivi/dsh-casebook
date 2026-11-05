// 叙事那一半：挂在「雾港案卷」Agent 预设里，只作用于用这个预设开的会话。
//   - 系统提示词换成叙事规则（整局不变，利于缓存），关掉运行时上下文和所有工具；
//   - 每轮第一步之前，向本轮追加程序生成的案情资料（L2），只追加、不改前文；
//   - 记下叙事实际用的模型，书记员默认跟着用。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { textOf } from './runtime.ts'
import './types.ts'

export const name = 'casebook-narrator'
export const inject = ['casebook', 'systemPrompt', 'tools']

export function apply(ctx: Context) {
  ctx.systemPrompt.section({ name: 'casebook:narrator', order: 0, complete: true, interpolate: false, text: ctx.casebook.narratorPrompt })
  ctx.systemPrompt.suppressRuntimeContext()
  ctx.tools.restrict({ allow: [] })

  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    const playerInput = decision.messages
      .filter(message => message.source.kind === 'user')
      .map(message => textOf(message.content))
      .join('\n')
    const context = await ctx.casebook.narratorContext(agent, playerInput, signal)
    return { ...decision, messages: [...decision.messages, context] }
  }, { prepend: true })

  ctx.on('agent/request', async ({ agent }, next) => {
    const config = await next()
    ctx.casebook.recordRoute(agent, config)
    return config
  })
}
