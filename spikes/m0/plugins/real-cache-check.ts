// M0 待验证项 3（真实数值）：用真的 DeepSeek 模型连发两条消息，看第二次请求的 cacheReadTokens 是否大于 0。
// 只在环境变量 CASEBOOK_REAL_CACHE=1 时运行，避免平时启动就调用付费接口；
// 需要先在 DSH 网页「设置 → 模型」里保存 DeepSeek 密钥（存进 .dsh-home/.credentials.yaml）。
// 每次运行新开一个会话，模型用 deepseek-flash，输出上限 200 token，花费很小。
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'casebook-real-cache-check'
export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

const LOG = '[casebook-real-cache-check]'

// 足够长的固定前缀，才能让服务端的前缀缓存在第二次请求时命中。
const CASE_BACKGROUND = [
  '你是雾港案卷的叙事助手（M0 缓存测试）。以下是本案的公开案情，回答时只用这些信息，每次回答不超过两句。',
  ...Array.from({ length: 24 }, (_, i) => `案情第 ${i + 1} 条：雾港码头在案发当晚九点到十一点之间有三艘船进出，管家、女仆、船夫和厨师都声称自己当时不在书房，侦探需要逐一核对他们的说法和窗台上的半个湿脚印。`),
].join('\n')

export function apply(ctx: Context) {
  if (process.env.CASEBOOK_REAL_CACHE !== '1') return

  const sessionId = SessionId(`casebook-m0-cache-${Date.now()}`)
  const agentOptions = { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 200 }
  const setup = (agentCtx: Context) => {
    agentCtx.systemPrompt.section({ name: 'casebook:cache-check', order: 0, complete: true, interpolate: false, text: CASE_BACKGROUND })
    agentCtx.systemPrompt.suppressRuntimeContext()
    agentCtx.tools.restrict({ allow: [] })
  }

  async function ask(agent: Agent, text: string) {
    const usage: TokenUsage[] = []
    let reply = ''
    const stop = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'assistant/message') {
        if (event.data.usage !== undefined) usage.push(event.data.usage)
        reply = event.data.message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      }
    })
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
    } finally {
      stop()
    }
    return { reply: reply.slice(0, 60), usage }
  }

  void (async () => {
    await ctx.get('loader')?.await()
    const { agent } = await ctx.agents.create({ sessionId, agentOptions, setup })
    console.log(LOG, 'call 1', JSON.stringify(await ask(agent, '请用一句话复述案情。')))
    console.log(LOG, 'call 2', JSON.stringify(await ask(agent, '再用一句话说说谁最可疑。')))
  })().catch((error: unknown) => console.error(LOG, 'failed', error))
}
