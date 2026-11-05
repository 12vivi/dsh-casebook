// M0 待验证项 1：插件里能否开独立、持久的后台 Agent 会话（顺带验证项 3 的读取通路）。
// 由 fake-llm.ts 注册的假模型驱动，不需要 API 密钥。据日志核实：
//   1. 会话独立于玩家对话，系统提示词是本插件给的；
//   2. 后台 Agent 只看得到本插件给它的工具；
//   3. 第二轮能看到第一轮的历史；DSH 重启后用 resume 接着同一个会话，消息条数继续增长；
//   4. 插件能从 assistant/message 事件里读到用量（含 cacheReadTokens）。
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'casebook-background-session'
export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'agentPresets']

const LOG = '[casebook-background-session]'

export function apply(ctx: Context) {
  const sessionId = SessionId('casebook-m0-clerk')
  const agentOptions = { provider: 'casebook-fake', model: 'echo' }
  let notes = 0

  // setup 不会持久化，create 和 resume 都要再传一次；这里的注册只作用于这个后台 Agent。
  // 插件自己开的会话不带任何预设，没有压缩能力；挂上覆盖层里定义的 casebook-clerk 预设才有。
  const setup = async (agentCtx: Context) => {
    await ctx.agentPresets.mount(agentCtx, 'casebook-clerk')
    agentCtx.systemPrompt.section({
      name: 'casebook:clerk',
      order: 0,
      complete: true,
      interpolate: false,
      text: '你是雾港案卷的后台书记员（M0 测试）。',
    })
    agentCtx.systemPrompt.suppressRuntimeContext()
    agentCtx.tools.restrict({ allow: [] })
    agentCtx.tools.register(defineTool({
      name: 'casebook_note',
      description: '书记员记一条笔记。',
      parameters: { note: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        notes += 1
        return `已记录第 ${notes} 条`
      },
    }))
  }

  async function clerk(): Promise<{ agent: Agent, resumed: boolean }> {
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) return { agent: live, resumed: false }
    const stored = await ctx.get('sessionPersistence')?.stat(sessionId)
    const handle = stored === undefined
      ? await ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions, setup })
      : await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    return { agent: handle.agent, resumed: stored !== undefined }
  }

  /** 发一条消息并等这一轮跑完；同一个 Agent 一次只发一条。 */
  async function ask(agent: Agent, text: string) {
    const toolCalls: string[] = []
    const usage: TokenUsage[] = []
    let reply = ''
    let end: unknown
    const stop = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'tool/call') toolCalls.push(`${event.data.name}(${event.data.arguments})`)
      if (event.type === 'assistant/message') {
        if (event.data.usage !== undefined) usage.push(event.data.usage)
        const said = event.data.message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
        if (said !== '') reply = said
      }
      if (event.type === 'turn/end') end = event.data.reason
    })
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
    } finally {
      stop()
    }
    return { reply, toolCalls, usage, end }
  }

  void (async () => {
    await ctx.get('loader')?.await()
    const { agent, resumed } = await clerk()
    console.log(LOG, resumed ? '从存档恢复会话' : '新建会话', String(sessionId))
    console.log(LOG, 'turn 1', JSON.stringify(await ask(agent, '第一轮：船夫说他九点在码头。')))
    console.log(LOG, 'turn 2', JSON.stringify(await ask(agent, '第二轮：女仆说十点听见书房吵架。')))

    // 待验证项 4：手动压缩一次。compaction-prompt.ts 会把压缩指令换成案件版提示词，
    // 假模型把收到的指令开头写进摘要；第三轮的消息条数应明显少于第二轮。
    const engine = ctx.agentPresets.serviceFor(agent, 'compaction')
    if (engine === undefined) {
      console.log(LOG, 'compact', '这个 Agent 上没有压缩服务')
    } else {
      const result = await engine.compactNow(agent, new AbortController().signal)
      console.log(LOG, 'compact', JSON.stringify(result))
    }
    console.log(LOG, 'turn 3', JSON.stringify(await ask(agent, '第三轮：压缩之后再问一次。')))
  })().catch((error: unknown) => console.error(LOG, 'failed', error))
}
