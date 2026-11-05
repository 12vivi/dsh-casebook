// 宿主侧的游戏运行时：对局表、叙事轮次的提交、每局一条串行的后台结算队列、书记员会话。
// 编排者是代码：什么时候跑哪个 Agent 由这里决定；Agent 之间不对话，只通过 Game（权威状态）交换信息。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, LlmCallConfig, TokenUsage, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { addUsage, checkVersion, describeErrors, describeSettlement, Game, JsonlEventLog, loadCase, ZERO_USAGE } from '../../domain/src/index.ts'
import type { BoardView, CaseFile, SettlementBinding, Usage } from '../../domain/src/index.ts'
import { submitEffectsTool } from './clerk-tool.ts'
import { PRESET_ID } from './types.ts'
import type { CasebookConfig } from './types.ts'

const LOG = '[casebook]'

export function textOf(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : '')).join('')
}

export function toUsage(usage: TokenUsage | undefined): Usage | undefined {
  if (usage === undefined) return undefined
  return { calls: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens ?? 0 }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 一轮叙事在提交前的草稿：从会话事件里收集玩家输入、正文和用量。 */
interface TurnDraft {
  readonly turn: number
  readonly startedAt: number
  readonly inputs: string[]
  readonly texts: string[]
  usage: Usage
}

/** 书记员正在处理的一次结算。submit_effects 工具按它校验版本。 */
export interface ClerkTask {
  readonly binding: SettlementBinding
  attempts: number
  outcome: 'applied' | 'failed' | 'stale' | undefined
}

/** 一局游戏在宿主侧的全部运行状态。 */
export class GameSlot {
  readonly sessionId: string
  readonly game: Game
  /** 每局一条后台任务队列，串行执行。 */
  queue: Promise<void> = Promise.resolve()
  /** 最近一次排进队列的结算；叙事开新一轮、玩家指认前都先等它。 */
  settling: Promise<void> | undefined
  clerk: AgentHandle | undefined
  task: ClerkTask | undefined
  /** 叙事最近一次请求用的模型；书记员没单独配置时跟着它。 */
  route: { provider: string, model: string } | undefined
  cwd: string | undefined

  constructor(sessionId: string, game: Game) {
    this.sessionId = sessionId
    this.game = game
  }
}

export type BoardResponse =
  | { readonly kind: 'none' }
  | { readonly kind: 'ready', readonly title: string, readonly summary: string, readonly detective: string }
  | { readonly kind: 'game', readonly board: BoardView, readonly clerkBusy: boolean }

export type ActionResponse =
  | { readonly ok: true, readonly board: BoardView }
  | { readonly ok: false, readonly errors: readonly string[] }

export class CasebookRuntime {
  readonly caseFile: CaseFile
  readonly narratorPrompt: string
  readonly clerkPrompt: string
  private readonly ctx: Context
  private readonly config: CasebookConfig
  private readonly slots = new Map<string, GameSlot>()
  private readonly drafts = new Map<string, TurnDraft>()

  constructor(ctx: Context, config: CasebookConfig) {
    this.ctx = ctx
    this.config = config
    this.caseFile = loadCase(config.caseDir)
    this.narratorPrompt = readFileSync(join(config.promptsDir, 'narrator.md'), 'utf8')
    this.clerkPrompt = readFileSync(join(config.promptsDir, 'clerk.md'), 'utf8')
  }

  private get clerkTimeoutMs(): number {
    return this.config.clerkTimeoutMs ?? 180_000
  }

  private get settlementWaitMs(): number {
    return this.config.settlementWaitMs ?? 120_000
  }

  private logPath(sessionId: string): string {
    return join(this.config.dataDir, 'games', `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`)
  }

  isGameSession(session: Session): boolean {
    return session.header.agentPreset === PRESET_ID || this.slots.has(String(session.id))
  }

  /** 找已有的对局：先看内存，再看磁盘上的事件日志。 */
  find(sessionId: string): GameSlot | undefined {
    const live = this.slots.get(sessionId)
    if (live !== undefined) return live
    const path = this.logPath(sessionId)
    if (!existsSync(path)) return undefined
    const log = new JsonlEventLog(path)
    for (const warning of log.warnings) console.warn(LOG, sessionId, warning)
    const slot = new GameSlot(sessionId, Game.open(this.caseFile, log))
    this.slots.set(sessionId, slot)
    return slot
  }

  /** 找对局，没有就开一局（写开局事件，并把会话标题改成案名，免得 DSH 再调模型起标题）。 */
  ensure(session: Session): GameSlot {
    const sessionId = String(session.id)
    const existing = this.find(sessionId)
    if (existing !== undefined) {
      existing.cwd ??= session.header.cwd
      return existing
    }
    const slot = new GameSlot(sessionId, Game.start(this.caseFile, new JsonlEventLog(this.logPath(sessionId)), sessionId))
    slot.cwd = session.header.cwd
    this.slots.set(sessionId, slot)
    this.rename(session, `雾港案卷 · ${this.caseFile.title}`)
    console.log(LOG, '开局', sessionId, this.logPath(sessionId))
    return slot
  }

  private rename(session: Session, title: string): void {
    try {
      this.ctx.get('sessionTitle')?.rename(session, title)
    } catch (error) {
      console.warn(LOG, '改会话标题失败', errorText(error))
    }
  }

  // ───────────────────────── 叙事 ─────────────────────────

  /**
   * 叙事每轮第一步之前调用：等上一轮结算落定，再按当前状态生成要追加的案情资料。
   * 已经在叙事会话里出现过的资料不再给，只追加新内容。
   */
  async narratorContext(agent: Agent, playerInput: string, signal: AbortSignal): Promise<UserMessage> {
    const slot = this.ensure(agent.session)
    await this.waitForSettlement(slot, this.settlementWaitMs, signal)
    const sections = slot.game.narratorSections(playerInput, deliveredSections(agent.session))
    return createUserMessage({
      content: [{ type: 'text', text: sections.map(section => section.text).join('\n\n') }],
      source: { kind: 'casebook', form: 'snapshot', sections: sections.map(section => ({ name: section.name, text: section.text })) },
    })
  }

  /** 记下叙事这一轮实际用的模型，书记员默认跟着用。 */
  recordRoute(agent: Agent, config: LlmCallConfig): void {
    const slot = this.slots.get(String(agent.session.id))
    if (slot !== undefined) slot.route = { provider: config.provider, model: config.model }
  }

  /** 跟踪游戏会话的每一轮：轮次正常结束就提交正文（revision + 1），再把结算排进后台队列。 */
  onSessionEvent(session: Session, event: SessionEvent): void {
    if (!this.isGameSession(session)) return
    const sessionId = String(session.id)
    switch (event.type) {
      case 'turn/start':
        this.drafts.set(sessionId, { turn: event.data.turn, startedAt: Date.now(), inputs: [], texts: [], usage: ZERO_USAGE })
        return
      case 'user/message': {
        const draft = this.drafts.get(sessionId)
        if (draft !== undefined && event.data.source.kind === 'user') draft.inputs.push(textOf(event.data.content))
        return
      }
      case 'assistant/message': {
        const draft = this.drafts.get(sessionId)
        if (draft === undefined) return
        const text = textOf(event.data.message.content).trim()
        if (text !== '') draft.texts.push(text)
        draft.usage = addUsage(draft.usage, toUsage(event.data.usage))
        return
      }
      case 'turn/end': {
        const draft = this.drafts.get(sessionId)
        this.drafts.delete(sessionId)
        if (draft === undefined) return
        const reason = event.data.reason.kind
        if (reason !== 'completed' && reason !== 'max-tokens') {
          console.log(LOG, `第 ${draft.turn} 轮叙事没有正常结束（${reason}），不提交`)
          return
        }
        this.commitTurn(sessionId, draft)
        return
      }
      default:
    }
  }

  private commitTurn(sessionId: string, draft: TurnDraft): void {
    const slot = this.find(sessionId)
    const text = draft.texts.join('\n\n').trim()
    if (slot === undefined || text === '') return
    if (slot.game.state.closed !== null) return
    const binding = slot.game.commitNarrative({
      playerInput: draft.inputs.join('\n').trim(),
      text,
      usage: draft.usage,
      ms: Date.now() - draft.startedAt,
    })
    this.enqueueSettlement(slot, binding)
  }

  // ───────────────────────── 结算 ─────────────────────────

  enqueueSettlement(slot: GameSlot, binding: SettlementBinding): void {
    const run = slot.queue.then(() => this.runSettlement(slot, binding)).catch((error: unknown) => {
      console.error(LOG, '结算任务出错', errorText(error))
    })
    slot.queue = run
    slot.settling = run
  }

  /** 等上一轮结算落定；超时或被取消就不再等（之后提交的新正文会让过期结算作废）。 */
  async waitForSettlement(slot: GameSlot, ms: number, signal?: AbortSignal): Promise<void> {
    const pending = slot.settling
    if (pending === undefined || slot.game.pendingSettlement === undefined) return
    const stop = new AbortController()
    const onAbort = () => stop.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await Promise.race([pending, sleep(ms, undefined, { signal: stop.signal }).catch(() => undefined)])
    } finally {
      stop.abort()
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private clerkMessage(text: string, section: string): UserMessage {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'casebook', form: 'snapshot', sections: [{ name: section, text }] },
    })
  }

  /** 发一条消息给书记员并等它跑完；超时就取消这一轮。 */
  private async drive(agent: Agent, message: UserMessage): Promise<void> {
    agent.followup(message)
    const timer = new AbortController()
    try {
      const outcome = await Promise.race([
        agent.whenIdle().then(() => 'idle' as const),
        sleep(this.clerkTimeoutMs, 'timeout' as const, { signal: timer.signal }),
      ])
      if (outcome === 'timeout') {
        agent.cancel({ kind: 'hook', reason: '书记员超时' })
        await agent.whenIdle()
        throw new Error(`书记员超过 ${Math.round(this.clerkTimeoutMs / 1000)} 秒没有完成`)
      }
    } finally {
      timer.abort()
    }
  }

  private async runSettlement(slot: GameSlot, binding: SettlementBinding): Promise<void> {
    const { game } = slot
    if (checkVersion(game.state, binding).length > 0) return
    const started = Date.now()
    const task: ClerkTask = { binding, attempts: 0, outcome: undefined }
    let usage = ZERO_USAGE
    let failure: string | undefined
    let agent: Agent | undefined
    try {
      agent = await this.clerkAgent(slot)
    } catch (error) {
      failure = `书记员启动失败：${errorText(error)}`
    }
    if (agent !== undefined) {
      const clerkSession = agent.session
      const stop = this.ctx.on('session/event', (session, event) => {
        if (session === clerkSession && event.type === 'assistant/message') usage = addUsage(usage, toUsage(event.data.usage))
      })
      slot.task = task
      try {
        await this.drive(agent, this.clerkMessage(game.clerkTask(binding), 'casebook:clerk-task'))
        if (task.outcome === undefined && game.canRetrySettlement(binding)) {
          await this.drive(agent, this.clerkMessage('你还没有调用 submit_effects。请按上面的结算任务提交本轮结算；没有变化也要提交。', 'casebook:clerk-nudge'))
        }
      } catch (error) {
        failure = errorText(error)
      } finally {
        stop()
        slot.task = undefined
      }
    }
    let outcome = task.outcome
    if (outcome === undefined) {
      const reason = failure ?? (task.attempts === 0 ? '书记员没有提交结算' : '书记员的结算没有通过校验')
      outcome = game.failSettlement(binding, reason) ? 'failed' : 'stale'
      console.warn(LOG, `第 ${binding.revision} 版正文结算失败：${reason}`)
    }
    game.recordClerk(binding, outcome, task.attempts, usage, Date.now() - started)
  }

  /** submit_effects 工具的实现：对当前任务做四道校验，结果交还给书记员。 */
  handleSubmission(slot: GameSlot, args: unknown): string {
    const task = slot.task
    if (task === undefined) throw new Error('现在没有待结算的任务，不要提交。')
    if (task.outcome !== undefined) throw new Error('这一版已经处理完了，不要重复提交，回复「完成」即可。')
    task.attempts += 1
    const result = slot.game.submitSettlement(task.binding, args)
    if (result.ok) {
      task.outcome = 'applied'
      return `已入账：${describeSettlement(this.caseFile, result.applied).join('；')}。回复「完成」即可。`
    }
    if (result.stale) {
      task.outcome = 'stale'
      throw new Error(`版本已过期，这份结算作废，不要再提交。\n${describeErrors(result.errors)}`)
    }
    if (!slot.game.canRetrySettlement(task.binding)) {
      task.outcome = 'failed'
      slot.game.failSettlement(task.binding, '结算提议连续被驳回')
      throw new Error(`驳回次数用完，这一版不再结算。最后一次的问题：\n${describeErrors(result.errors)}`)
    }
    throw new Error(`驳回。请按下面的意见修改后重新调用 submit_effects：\n${describeErrors(result.errors)}`)
  }

  private clerkRoute(slot: GameSlot): AgentOptions {
    if (this.config.clerkProvider !== undefined && this.config.clerkModel !== undefined) {
      return { provider: this.config.clerkProvider, model: this.config.clerkModel }
    }
    if (slot.route !== undefined) return slot.route
    const fallback = this.ctx.get('agentDefaultModel')?.currentSelection()
    return fallback === undefined ? { provider: 'deepseek-official', model: 'deepseek-flash' } : { provider: fallback.provider, model: fallback.model }
  }

  /** 每局一个书记员会话：只装 L2 的结算任务，只有 submit_effects 一个工具，挂在游戏会话下面。 */
  private async clerkAgent(slot: GameSlot): Promise<Agent> {
    if (slot.clerk !== undefined) return slot.clerk.agent
    const sessionId = SessionId(`casebook-clerk-${slot.sessionId}`)
    const setup = (agentCtx: Context) => {
      agentCtx.systemPrompt.section({ name: 'casebook:clerk', order: 0, complete: true, interpolate: false, text: this.clerkPrompt })
      agentCtx.systemPrompt.suppressRuntimeContext()
      agentCtx.tools.restrict({ allow: [] })
      agentCtx.tools.register(submitEffectsTool(this.caseFile, args => this.handleSubmission(slot, args)))
    }
    const agentOptions = this.clerkRoute(slot)
    const stored = await this.ctx.get('sessionPersistence')?.stat(sessionId)
    const handle = stored === undefined
      ? await this.ctx.agents.create({
          sessionId,
          meta: { cwd: slot.cwd, parentSession: SessionId(slot.sessionId), origin: 'subagent' },
          agentOptions,
          setup,
        })
      : await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    slot.clerk = handle
    if (stored === undefined) this.rename(handle.agent.session, `书记员 · ${this.caseFile.title}`)
    console.log(LOG, stored === undefined ? '新建书记员会话' : '恢复书记员会话', String(sessionId), `${agentOptions.provider}/${agentOptions.model}`)
    return handle.agent
  }

  // ───────────────────────── 线索板与指认 ─────────────────────────

  boardFor(sessionId: string): BoardResponse {
    const slot = this.find(sessionId)
    if (slot !== undefined) return { kind: 'game', board: slot.game.board(), clerkBusy: slot.task !== undefined }
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session?.header.agentPreset === PRESET_ID) {
      return { kind: 'ready', title: this.caseFile.title, summary: this.caseFile.public.summary, detective: this.caseFile.public.detective }
    }
    return { kind: 'none' }
  }

  /** 指认：先等本轮结算落定，再交给领域层判定。 */
  async accuse(sessionId: string, body: unknown): Promise<ActionResponse> {
    const slot = this.find(sessionId)
    if (slot === undefined) return { ok: false, errors: ['这个会话还没有开始对局'] }
    await this.waitForSettlement(slot, this.settlementWaitMs)
    const result = slot.game.accuse(body)
    if (!result.ok) return result
    console.log(LOG, '结案', sessionId, `${result.verdict.grade} ${result.verdict.score} 分`)
    return { ok: true, board: slot.game.board() }
  }

  /** 最新一版正文结算失败时，重新排一次结算。 */
  retry(sessionId: string): ActionResponse {
    const slot = this.find(sessionId)
    if (slot === undefined) return { ok: false, errors: ['这个会话还没有开始对局'] }
    const binding = slot.game.retrySettlement()
    if (binding === undefined) return { ok: false, errors: ['现在没有可以重试的结算'] }
    this.enqueueSettlement(slot, binding)
    return { ok: true, board: slot.game.board() }
  }

  /** 正在处理结算的那一局（假模型扮书记员时用）。 */
  slotByClerkSession(sessionId: string): GameSlot | undefined {
    const prefix = 'casebook-clerk-'
    return sessionId.startsWith(prefix) ? this.slots.get(sessionId.slice(prefix.length)) : undefined
  }

  slotBySession(sessionId: string): GameSlot | undefined {
    return this.slots.get(sessionId)
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.slots.values()].map(slot => slot.clerk?.dispose()))
  }
}

/** 叙事会话里已经给过的资料节名：只认模型当前还能看到的消息，被压缩掉的会重新给。 */
export function deliveredSections(session: Session): Set<string> {
  const names = new Set<string>()
  for (const message of session.deriveMessages()) {
    if (message.role !== 'user' || message.source.kind !== 'casebook') continue
    const source = message.source as { form?: string, sections?: ReadonlyArray<{ name: string }> }
    if (source.form === 'snapshot') for (const section of source.sections ?? []) names.add(section.name)
  }
  return names
}
