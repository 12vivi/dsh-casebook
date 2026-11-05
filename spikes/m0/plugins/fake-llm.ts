// M0 测试用假模型：不联网、不需要密钥。Web 界面的模型选择里能选到 casebook-fake / echo。
//   - 起标题请求：返回固定标题；
//   - 压缩请求：返回「摘要（假模型）：」加压缩指令的开头，用来核实压缩提示词有没有被换掉；
//   - 能看到 casebook_note 工具、且上一条不是工具结果时：调用一次 casebook_note；
//   - 其余：用文字回显请求概况（各消息角色、系统提示词开头、可见工具、消息条数）。
// 每次都报一份假用量（含 cacheReadTokens），只用来核实插件能从会话事件里读到这些字段；数字是编的。
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

export const name = 'casebook-fake-llm'
export const inject = ['llm']

const PROVIDER = 'casebook-fake'
const FAKE_USAGE: TokenUsage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 64 }

function textOf(content: readonly ContentBlock[] | undefined): string {
  return (content ?? []).map(block => (block.type === 'text' ? block.text : '')).join('')
}

async function* say(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: FAKE_USAGE }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function* callNote(messageCount: number): AsyncIterable<StreamChunk> {
  const block = {
    type: 'tool-call' as const,
    id: ToolCallId(`casebook-fake-${Date.now()}`),
    name: 'casebook_note',
    arguments: JSON.stringify({ note: `第 ${messageCount} 条消息时记一笔` }),
  }
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'usage', usage: FAKE_USAGE }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

class FakeAdapter extends LlmAdapter {
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: 'echo', name: 'M0 假模型（不联网）' }]
  }

  // 压缩引擎按上下文窗口算阈值和保留预算，假模型得报一个窗口大小。
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: 'M0 假模型（不联网）', context: { contextWindow: 200_000 }, defaultMaxTokens: 8_192 }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)
    if (options.purpose === 'session-title') {
      yield* say('M0 测试会话')
      return
    }
    if (options.purpose === 'compaction') {
      yield* say(`摘要（假模型）：${textOf(last?.content).slice(0, 40)}`)
      return
    }
    if (options.tools?.some(schema => schema.name === 'casebook_note') && last?.role !== 'tool') {
      yield* callNote(options.messages.length)
      return
    }
    const system = options.messages.find(message => message.role === 'system')
    yield* say(JSON.stringify({
      roles: options.messages.map(message => message.role),
      system: (options.system ?? textOf(system?.content)).slice(0, 24),
      tools: (options.tools ?? []).map(schema => schema.name),
      messages: options.messages.length,
    }))
  }
}

export function apply(ctx: Context) {
  ctx.llm.registerAdapter([PROVIDER], new FakeAdapter())
}
