// 开发用假模型：不联网、不要密钥，在模型选择里叫「casebook-fake / detective」。
// 它扮演叙事和书记员，让整条链路（注入案情 → 叙事提交 → 书记员结算 → 四道校验 → 线索板）不花钱就能跑通：
//   - 叙事：玩家输入里提到某条线索的关键词、且发现条件满足，就把线索内容原样写进正文；提到地点就走过去；
//           说「别怕」「保证」之类的软话，在场的人态度 +1；提到在场的人，他就说出档案里的第一句谎话。
//   - 书记员：读这版正文，按上面的写法反推出结算提议，调用 submit_effects。
// 玩家输入里带「【测试：书记员驳回】」时，书记员第一次故意引错原句；带「【测试：书记员不提交】」时，
// 这一版的第一次结算任务不提交（结算失败），点「重新结算」后正常提交。
// 它读的是游戏程序的状态和案卷，只是测试替身，不代表真模型能看到的信息。
import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, RequestMessage, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { lookaheadLocations, normalizeForQuote } from '../../domain/src/index.ts'
import type { CaseFile, GameState } from '../../domain/src/index.ts'
import type { CasebookRuntime } from './runtime.ts'
import { textOf } from './runtime.ts'
import './types.ts'

export const name = 'casebook-fake-llm'
export const inject = ['llm', 'casebook']

const PROVIDER = 'casebook-fake'
const MODEL = 'detective'
const KIND_WORDS = /别怕|放心|保证|不会告诉|保密|帮你|安慰|慢慢说|不为难/

/** 粗估 token：中文大约 1.5 字一个。 */
const tokens = (text: string) => Math.ceil(text.length / 1.5)

function messageChars(message: RequestMessage): number {
  return message.content.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : JSON.stringify(block).length), 0)
}

/** 假用量：最后一条助手消息之前的内容算缓存命中，之后新加的算未命中，模拟只追加的前缀缓存。 */
function fakeUsage(options: GenerateOptions, output: string): TokenUsage {
  const messages = options.messages
  let tail = messages.length
  while (tail > 0 && messages[tail - 1]!.role !== 'assistant') tail -= 1
  const prefix = messages.slice(0, tail).reduce((sum, message) => sum + messageChars(message), 0)
  const fresh = messages.slice(tail).reduce((sum, message) => sum + messageChars(message), 0)
  return { inputTokens: Math.ceil(fresh / 1.5), outputTokens: tokens(output), cacheReadTokens: Math.ceil(prefix / 1.5) }
}

async function* say(text: string, usage: TokenUsage): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  for (let start = 0; start < text.length; start += 24) {
    yield { type: 'text-delta', index: 0, text: text.slice(start, start + 24) }
    await sleep(12)
  }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function* callTool(name: string, args: unknown, usage: TokenUsage): AsyncIterable<StreamChunk> {
  const block = { type: 'tool-call' as const, id: ToolCallId(`casebook-fake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`), name, arguments: JSON.stringify(args) }
  await sleep(200)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

function latestPlayerInput(messages: readonly RequestMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'user' && message.source?.kind === 'user') return textOf(message.content)
  }
  return ''
}

function mentions(text: string, names: readonly string[]): boolean {
  return names.some(name => text.includes(name))
}

/** 假叙事：按上面的规则把玩家输入写成一段正文。 */
export function fakeNarration(caseFile: CaseFile, state: GameState, input: string): string {
  const location = (id: string) => caseFile.locations.find(item => item.id === id)!
  const parts: string[] = []
  if (state.turn === 0) parts.push(`${caseFile.public.startTime.replace(':', '点')}分，你踏进${location(state.location).name}。海雾还没散，屋里一股潮气。`)
  const target = lookaheadLocations(caseFile, state.location, input)[0]
  const moving = target !== undefined && /去|到|前往|走|回|找/.test(input)
  const scene = moving ? target : state.location
  if (moving) parts.push(`你离开${location(state.location).name}，来到${location(scene).name}。${location(scene).description}`)
  const present = caseFile.npcs.filter(npc => npc.location === scene)
  const attitudes = { ...state.attitudes }
  if (KIND_WORDS.test(input)) {
    for (const npc of present) {
      if (present.length === 1 || mentions(input, [npc.name, npc.role, ...npc.aliases])) {
        parts.push(`${npc.name}的神情缓和了一些。`)
        attitudes[npc.id] = (attitudes[npc.id] ?? 0) + 1
      }
    }
  }
  const found = new Set(state.discovered.map(item => item.clue))
  const spoke = new Set<string>()
  for (const clue of caseFile.clues) {
    if (clue.location !== scene || found.has(clue.id)) continue
    if (!mentions(input, [clue.name, ...clue.keywords])) continue
    if (!clue.discovery.requires.every(id => found.has(id))) continue
    if (clue.source !== undefined && (attitudes[clue.source] ?? 0) < (clue.discovery.minAttitude ?? -2)) continue
    parts.push(clue.appearance)
    found.add(clue.id)
    if (clue.source !== undefined) spoke.add(clue.source)
  }
  for (const npc of present) {
    if (spoke.has(npc.id) || !mentions(input, [npc.name, npc.role, ...npc.aliases])) continue
    parts.push(`${npc.name}说：「${(npc.lies[0]?.claim ?? '我知道的都说了。').replace(/[」]/g, '')}」`)
  }
  if (parts.length === (state.turn === 0 ? 1 : 0) + (moving ? 1 : 0)) parts.push('你四下看了看，一时没有发现什么特别的东西。')
  return parts.join('\n\n')
}

/** 假书记员：从正文反推结算提议，规则与 fakeNarration 的写法对应。 */
export function fakeSettlement(caseFile: CaseFile, state: GameState, text: string) {
  const normalized = normalizeForQuote(text)
  const move = caseFile.locations.find(location => location.id !== state.location && text.includes(`来到${location.name}`))
  const scene = [state.location, ...(move === undefined ? [] : [move.id])]
  const present = caseFile.npcs.filter(npc => scene.includes(npc.location))
  const attitudes = present
    .filter(npc => text.includes(`${npc.name}的神情缓和了一些`))
    .map(npc => ({ npc: npc.id, delta: 1, reason: '侦探说话和气', quote: `${npc.name}的神情缓和了一些` }))
  const discoveries = caseFile.clues
    .filter(clue => scene.includes(clue.location) && !state.discovered.some(item => item.clue === clue.id) && normalized.includes(normalizeForQuote(clue.appearance)))
    .map(clue => ({ clue: clue.id, quote: clue.appearance }))
  const testimonies = present.flatMap(npc => {
    const match = text.match(new RegExp(`${npc.name}说：「([^」]{4,})」`))
    return match === null ? [] : [{ npc: npc.id, quote: match[1]! }]
  })
  const action = discoveries.length > 0 ? 'search' : testimonies.length > 0 || attitudes.length > 0 ? 'interrogate' : move !== undefined ? 'move' : 'think'
  return { action, move: move === undefined ? undefined : { to: move.id, quote: `来到${move.name}` }, discoveries, attitudes, testimonies }
}

class FakeAdapter extends LlmAdapter {
  private readonly runtime: () => CasebookRuntime

  constructor(runtime: () => CasebookRuntime) {
    super()
    this.runtime = runtime
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{ provider, id: MODEL, name: '雾港案卷假模型（不联网）' }]
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: '雾港案卷假模型（不联网）', context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192 }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') return yield* say('雾港案卷', fakeUsage(options, ''))
    if (options.purpose === 'compaction') return yield* say('（假模型摘要）', fakeUsage(options, ''))
    const runtime = this.runtime()
    const sessionId = String(options.sessionId ?? '')
    if (options.tools?.some(tool => tool.name === 'submit_effects')) return yield* this.clerk(runtime, sessionId, options)
    const slot = runtime.slotBySession(sessionId)
    if (slot === undefined) return yield* say('（假模型：这个会话不是雾港案卷的对局。）', fakeUsage(options, ''))
    if (slot.game.state.closed !== null) return yield* say('案子已经结了。海雾慢慢散去，码头上又响起了吆喝声。', fakeUsage(options, ''))
    const text = fakeNarration(runtime.caseFile, slot.game.state, latestPlayerInput(options.messages))
    yield* say(text, fakeUsage(options, text))
  }

  private async *clerk(runtime: CasebookRuntime, sessionId: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const slot = runtime.slotByClerkSession(sessionId)
    const task = slot?.task
    if (slot === undefined || task === undefined || task.outcome !== undefined) return yield* say('完成', fakeUsage(options, '完成'))
    const narrative = slot.game.narrativeOf(task.binding.revision)
    if (narrative === undefined) return yield* say('找不到这版正文。', fakeUsage(options, ''))
    // 只在这一版正文的第一次结算任务里不提交，玩家点「重新结算」时正常提交，用来走通失败与重试。
    const firstTask = !slot.game.events.some(event => event.type === 'clerk/finished' && event.revision === task.binding.revision)
    if (narrative.playerInput.includes('【测试：书记员不提交】') && firstTask) return yield* say('这一轮没什么好记的。', fakeUsage(options, ''))
    const proposal = fakeSettlement(runtime.caseFile, slot.game.state, narrative.text)
    if (narrative.playerInput.includes('【测试：书记员驳回】') && task.attempts === 0) {
      const wrong = { ...proposal, testimonies: [...proposal.testimonies], discoveries: [{ clue: runtime.caseFile.clues[0]!.id, quote: '这句话正文里没有' }] }
      return yield* callTool('submit_effects', wrong, fakeUsage(options, JSON.stringify(wrong)))
    }
    yield* callTool('submit_effects', proposal, fakeUsage(options, JSON.stringify(proposal)))
  }
}

export function apply(ctx: Context) {
  ctx.llm.registerAdapter([PROVIDER], new FakeAdapter(() => ctx.casebook))
}
