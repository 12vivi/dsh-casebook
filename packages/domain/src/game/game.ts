// 一局游戏：案卷 + 事件日志 + 由日志重放出的状态。所有状态变更都经过这里，先写日志再更新状态。
// 不依赖 DSH：插件层负责什么时候调用这些方法，这里负责能不能改、怎么改。
import type { CaseFile } from '../case/schema.ts'
import { parseClock } from './clock.ts'
import { checkSettlement, checkVersion } from './effects.ts'
import type { SettlementBinding, SettlementCheck } from './effects.ts'
import type { GameEvent, GameEventInput, Usage, Verdict } from './events.ts'
import type { EventLog } from './log.ts'
import { boardView, clerkTask, narratorSections } from './projections.ts'
import type { BoardView, ContextSection } from './projections.ts'
import { checkAccusation, judgeAccusation } from './scoring.ts'
import { MAIN_BRANCH, reduce, replay } from './state.ts'
import type { GameState } from './state.ts'

/** 同一版正文最多接受几次被驳回的结算提议，之后放弃这一版的结算。 */
export const MAX_SETTLEMENT_ATTEMPTS = 3

export type AccuseResult =
  | { readonly ok: true, readonly verdict: Verdict }
  | { readonly ok: false, readonly errors: readonly string[] }

export class Game {
  readonly caseFile: CaseFile
  private readonly log: EventLog
  private current: GameState
  private readonly narratives = new Map<number, { playerInput: string, text: string }>()
  private startClock = 0

  private constructor(caseFile: CaseFile, log: EventLog) {
    this.caseFile = caseFile
    this.log = log
    this.current = replay(caseFile, [])
    for (const event of log.events) this.absorb(event)
  }

  /** 开新局；日志里已有这局就接着用。 */
  static start(caseFile: CaseFile, log: EventLog, sessionId: string): Game {
    const game = new Game(caseFile, log)
    if (log.events.length === 0) {
      game.write({
        branch: MAIN_BRANCH,
        revision: 0,
        type: 'game/started',
        data: {
          caseId: caseFile.id,
          caseVersion: caseFile.version,
          sessionId,
          location: caseFile.public.startLocation,
          clock: parseClock(caseFile.public.startTime),
        },
      })
    }
    return game
  }

  /** 从已有日志恢复。日志不是这个案卷的就抛错。 */
  static open(caseFile: CaseFile, log: EventLog): Game {
    const first = log.events[0]
    if (first?.type !== 'game/started') throw new Error('日志里没有开局事件')
    if (first.data.caseId !== caseFile.id) throw new Error(`日志属于案卷 ${first.data.caseId}，不是 ${caseFile.id}`)
    return new Game(caseFile, log)
  }

  get state(): GameState {
    return this.current
  }

  get events(): readonly GameEvent[] {
    return this.log.events
  }

  /** 还在等结算的正文版本；没有就是 undefined。 */
  get pendingSettlement(): SettlementBinding | undefined {
    const state = this.current
    if (state.closed !== null || state.settledRevision >= state.revision) return undefined
    return { branch: state.branch, revision: state.revision }
  }

  narrativeOf(revision: number): { readonly playerInput: string, readonly text: string } | undefined {
    return this.narratives.get(revision)
  }

  private absorb(event: GameEvent): void {
    if (event.type === 'game/started') this.startClock = event.data.clock
    if (event.type === 'narrative/committed') this.narratives.set(event.revision, { playerInput: event.data.playerInput, text: event.data.text })
    this.current = reduce(this.current, event)
  }

  private write(input: GameEventInput): GameEvent {
    const event = this.log.append(input)
    this.absorb(event)
    return event
  }

  /**
   * 提交一轮正文：revision 加 1，返回这版正文的结算绑定。
   * 上一版还没结算完时也照样提交（正文先提交），上一版的结算会因版本不符被丢弃。
   */
  commitNarrative(input: { playerInput: string, text: string, usage?: Usage, ms?: number }): SettlementBinding {
    if (this.current.closed !== null) throw new Error('案件已经结案，不再提交正文')
    const pending = this.pendingSettlement
    if (pending !== undefined) {
      this.write({ ...pending, type: 'settlement/failed', data: { reason: '下一轮正文已经提交，这一版的结算作废' } })
    }
    const revision = this.current.revision + 1
    this.write({
      branch: this.current.branch,
      revision,
      type: 'narrative/committed',
      data: { turn: this.current.turn + 1, playerInput: input.playerInput, text: input.text, usage: input.usage, ms: input.ms },
    })
    return { branch: this.current.branch, revision }
  }

  /** 书记员提交结算提议：四道校验，通过就原子写入，不通过写一条驳回记录。 */
  submitSettlement(binding: SettlementBinding, raw: unknown): SettlementCheck {
    const narrative = this.narratives.get(binding.revision)?.text ?? ''
    const result = checkSettlement(this.caseFile, this.current, binding, raw, narrative)
    if (result.ok) {
      this.write({ ...binding, type: 'settlement/applied', data: result.applied })
    } else {
      const attempt = binding.revision === this.current.revision ? this.current.rejectedAttempts + 1 : 0
      this.write({ ...binding, type: 'settlement/rejected', data: { attempt, stale: result.stale, errors: result.errors } })
    }
    return result
  }

  /** 这一版还能不能再提交结算：版本有效且没有用完尝试次数。 */
  canRetrySettlement(binding: SettlementBinding): boolean {
    return checkVersion(this.current, binding).length === 0 && this.current.rejectedAttempts < MAX_SETTLEMENT_ATTEMPTS
  }

  /** 放弃一版正文的结算。版本已经过期或已有结论时什么也不做，返回 false。 */
  failSettlement(binding: SettlementBinding, reason: string): boolean {
    if (checkVersion(this.current, binding).length > 0) return false
    this.write({ ...binding, type: 'settlement/failed', data: { reason } })
    return true
  }

  /** 最新一版正文的结算失败了时，可以重新结算；返回新的绑定，不能重试时返回 undefined。 */
  retrySettlement(): SettlementBinding | undefined {
    const state = this.current
    const last = state.lastSettlement
    if (state.closed !== null || last === null || last.status !== 'failed' || last.revision !== state.revision) return undefined
    const binding = { branch: state.branch, revision: state.revision }
    this.write({ ...binding, type: 'settlement/retried', data: {} })
    return binding
  }

  /** 记录一次书记员任务的用量与结果。 */
  recordClerk(binding: SettlementBinding, outcome: 'applied' | 'failed' | 'stale', attempts: number, usage: Usage, ms: number): void {
    this.write({ ...binding, type: 'clerk/finished', data: { outcome, attempts, usage, ms } })
  }

  /** 玩家指认凶手：合法就判定并结案。 */
  accuse(raw: unknown): AccuseResult {
    const checked = checkAccusation(this.caseFile, this.current, raw)
    if (!checked.ok) return checked
    const verdict = judgeAccusation(this.caseFile, this.current, this.startClock, checked.accusation)
    this.write({
      branch: this.current.branch,
      revision: this.current.revision,
      type: 'case/closed',
      data: { accusation: checked.accusation, verdict },
    })
    return { ok: true, verdict }
  }

  board(): BoardView {
    return boardView(this.caseFile, this.current)
  }

  narratorSections(playerInput: string, delivered: ReadonlySet<string>): ContextSection[] {
    return narratorSections(this.caseFile, this.current, playerInput, delivered)
  }

  /** 给书记员的结算任务；binding 必须是还在等结算的那一版。 */
  clerkTask(binding: SettlementBinding): string {
    const narrative = this.narratives.get(binding.revision)
    if (narrative === undefined) throw new Error(`没有第 ${binding.revision} 版正文`)
    return clerkTask(this.caseFile, this.current, binding, narrative.playerInput, narrative.text)
  }
}
