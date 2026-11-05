// 游戏状态：由事件日志重放得到，程序是唯一写入者。reduce 是纯函数，只信任已经写进日志的事件。
import type { CaseFile } from '../case/schema.ts'
import { addUsage, ZERO_USAGE } from './events.ts'
import type { Accusation, AppliedSettlement, GameEvent, Usage, Verdict } from './events.ts'

/** M1 只有主分支；M2 做回退时才会开新分支。 */
export const MAIN_BRANCH = 'main'

export interface GameState {
  readonly caseId: string
  readonly sessionId: string
  readonly branch: string
  /** 当前分支最新一版正文的版本号；开局为 0，每提交一次正文加 1。 */
  readonly revision: number
  /** 已提交的正文轮数。没有回退时与 revision 相同。 */
  readonly turn: number
  /** 已有结论（通过或放弃）的最新正文版本。小于 revision 说明还有结算没完成。 */
  readonly settledRevision: number
  readonly location: string
  readonly visited: readonly string[]
  /** 游戏内时钟：开局当天零点起的分钟数。 */
  readonly clock: number
  readonly discovered: ReadonlyArray<{ readonly clue: string, readonly revision: number }>
  readonly attitudes: Readonly<Record<string, number>>
  readonly testimonies: ReadonlyArray<{ readonly npc: string, readonly quote: string, readonly revision: number }>
  /** 最近一次结算的结论，用于线索板的「本轮新发现」和给叙事的上轮变化。 */
  readonly lastSettlement: { readonly revision: number, readonly status: 'applied', readonly applied: AppliedSettlement }
    | { readonly revision: number, readonly status: 'failed', readonly reason: string }
    | null
  /** 当前这版正文已被驳回的结算提议次数。 */
  readonly rejectedAttempts: number
  readonly closed: { readonly accusation: Accusation, readonly verdict: Verdict } | null
  readonly usage: { readonly narrator: Usage, readonly clerk: Usage }
}

/** 开局状态。真正的开局事件由 reduce('game/started') 写入，这里只给出未开局的空壳。 */
export function emptyState(caseFile: CaseFile): GameState {
  return {
    caseId: caseFile.id,
    sessionId: '',
    branch: MAIN_BRANCH,
    revision: 0,
    turn: 0,
    settledRevision: 0,
    location: caseFile.public.startLocation,
    visited: [caseFile.public.startLocation],
    clock: 0,
    discovered: [],
    attitudes: Object.fromEntries(caseFile.npcs.map(npc => [npc.id, npc.initialAttitude])),
    testimonies: [],
    lastSettlement: null,
    rejectedAttempts: 0,
    closed: null,
    usage: { narrator: ZERO_USAGE, clerk: ZERO_USAGE },
  }
}

/** 把一次已通过校验的结算作用到状态上。 */
function applySettlement(state: GameState, revision: number, applied: AppliedSettlement): GameState {
  const attitudes = { ...state.attitudes }
  for (const change of applied.attitudes) attitudes[change.npc] = change.to
  const location = applied.move?.to ?? state.location
  return {
    ...state,
    settledRevision: revision,
    location,
    visited: state.visited.includes(location) ? state.visited : [...state.visited, location],
    clock: state.clock + applied.minutes,
    discovered: [...state.discovered, ...applied.discoveries.map(item => ({ clue: item.clue, revision }))],
    attitudes,
    testimonies: [...state.testimonies, ...applied.testimonies.map(item => ({ npc: item.npc, quote: item.quote, revision }))],
    lastSettlement: { revision, status: 'applied', applied },
    rejectedAttempts: 0,
  }
}

export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'game/started':
      return {
        ...state,
        sessionId: event.data.sessionId,
        branch: event.branch,
        location: event.data.location,
        visited: [event.data.location],
        clock: event.data.clock,
      }
    case 'narrative/committed':
      return {
        ...state,
        revision: event.revision,
        turn: event.data.turn,
        rejectedAttempts: 0,
        usage: { ...state.usage, narrator: addUsage(state.usage.narrator, event.data.usage) },
      }
    case 'settlement/applied':
      return applySettlement(state, event.revision, event.data)
    case 'settlement/rejected':
      return event.revision === state.revision ? { ...state, rejectedAttempts: state.rejectedAttempts + 1 } : state
    case 'settlement/failed':
      return {
        ...state,
        settledRevision: Math.max(state.settledRevision, event.revision),
        lastSettlement: { revision: event.revision, status: 'failed', reason: event.data.reason },
        rejectedAttempts: 0,
      }
    case 'settlement/retried':
      // 只重开最新一版：把它从「已有结论」退回「待结算」，失败记录清掉。
      return event.revision === state.revision && state.settledRevision === event.revision
        ? { ...state, settledRevision: event.revision - 1, lastSettlement: null, rejectedAttempts: 0 }
        : state
    case 'clerk/finished':
      return { ...state, usage: { ...state.usage, clerk: addUsage(state.usage.clerk, event.data.usage) } }
    case 'case/closed':
      return { ...state, closed: { accusation: event.data.accusation, verdict: event.data.verdict } }
  }
}

export function replay(caseFile: CaseFile, events: Iterable<GameEvent>): GameState {
  let state = emptyState(caseFile)
  for (const event of events) state = reduce(state, event)
  return state
}

export function isDiscovered(state: GameState, clue: string): boolean {
  return state.discovered.some(item => item.clue === clue)
}
