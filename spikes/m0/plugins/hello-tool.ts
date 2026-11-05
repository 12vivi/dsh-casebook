// M0 最小插件：注册一个工具，并在启动时不经过模型、直接走一遍 DSH 的工具执行流水线自检。
// 不需要 API 密钥；启动日志里出现「self-check」一行即说明注册与分发都通。
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'casebook-hello-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'casebook_ping',
    description: '雾港案卷 M0 自检工具：把收到的文字加上前缀原样返回。',
    parameters: {
      text: { type: 'string', required: true, description: '要回声的文字' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `雾港案卷收到：${args.text}`
    },
  }))

  const controller = new AbortController()
  ctx.effect(() => () => controller.abort())
  void ctx.tools.execute({
    callId: ToolCallId('casebook-m0-self-check'),
    name: 'casebook_ping',
    arguments: { text: 'M0 自检' },
    signal: controller.signal,
  }).then(
    result => console.log('[casebook-hello-tool] self-check', JSON.stringify({ isError: result.isError, content: result.content })),
    (error: unknown) => console.error('[casebook-hello-tool] self-check failed', error),
  )
}
