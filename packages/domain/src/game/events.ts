// 事件日志的事件类型。每局一个只追加的 JSONL 文件，一行一个事件；游戏状态由这些事件重放得到。
// 事件一经写入不再修改；字段只增不改，读旧日志时缺省字段按默认值处理。
import type { ActionType } from './clock.ts'

/** 事件格式版本：现有字段的含义变了才加 1。 */
export const GAME_EVENT_VERSION = 1

/** 模型用量（累计值）。命中率 = cacheReadTokens ÷ (cacheReadTokens + inputTokens)，与 DSH 界面一致。 */
export interface Usage {
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
}

export const ZERO_USAGE: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

export function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (b === undefined) return a
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  }
}

/** 缓存命中率；没有输入时返回 undefined。 */
export function cacheHitRate(usage: Usage): number | undefined {
  const total = usage.cacheReadTokens + usage.inputTokens
  return total === 0 ? undefined : usage.cacheReadTokens / total
}

/** 校验未通过的一项。check 标明是四道校验里的哪一道。 */
export interface CheckError {
  readonly check: 'schema' | 'rule' | 'version' | 'quote'
  readonly path: string
  readonly message: string
}

/** 通过四道校验、写进日志的一次结算。 */
export interface AppliedSettlement {
  readonly action: ActionType
  readonly minutes: number
  readonly discoveries: ReadonlyArray<{ readonly clue: string, readonly quote: string }>
  readonly attitudes: ReadonlyArray<{ readonly npc: string, readonly from: number, readonly to: number, readonly reason: string, readonly quote: string }>
  readonly move: { readonly from: string, readonly to: string, readonly quote: string } | null
  readonly testimonies: ReadonlyArray<{ readonly npc: string, readonly quote: string }>
}

/** 玩家的指认。 */
export interface Accusation {
  readonly culprit: string
  readonly evidence: readonly string[]
  readonly answers: Readonly<Record<string, string>>
}

/** 指认的判定结果。 */
export interface Verdict {
  readonly correctCulprit: boolean
  readonly proofs: ReadonlyArray<{ readonly id: string, readonly label: string, readonly coveredBy: string | null }>
  readonly questions: ReadonlyArray<{ readonly id: string, readonly prompt: string, readonly chosen: string, readonly answer: string, readonly correct: boolean }>
  readonly score: number
  readonly grade: 'S' | 'A' | 'B' | 'C' | 'F'
  readonly turns: number
  readonly minutesUsed: number
}

export interface GameEventMap {
  /** 开局。revision 为 0。 */
  'game/started': { readonly caseId: string, readonly caseVersion: number, readonly sessionId: string, readonly location: string, readonly clock: number }
  /** 正文提交：revision 加 1。之后后台结算失败也不能撤销它。usage 与 ms 是这一轮叙事的用量和耗时。 */
  'narrative/committed': { readonly turn: number, readonly playerInput: string, readonly text: string, readonly usage?: Usage, readonly ms?: number }
  /** 结算通过四道校验，原子写入。revision 是它结算的那一版正文。 */
  'settlement/applied': AppliedSettlement
  /** 一次结算提议没通过校验（只留档，状态不变）。stale 表示版本已过期。 */
  'settlement/rejected': { readonly attempt: number, readonly stale: boolean, readonly errors: readonly CheckError[] }
  /** 放弃这一版正文的结算：没有提交、重试用尽或超时。 */
  'settlement/failed': { readonly reason: string }
  /** 玩家要求重新结算最新一版正文（上一次结算失败了）。 */
  'settlement/retried': Record<string, never>
  /** 一次书记员任务结束：结果、尝试次数、用量和耗时。 */
  'clerk/finished': { readonly outcome: 'applied' | 'failed' | 'stale', readonly attempts: number, readonly usage: Usage, readonly ms: number }
  /** 指认并结案。 */
  'case/closed': { readonly accusation: Accusation, readonly verdict: Verdict }
}

export type GameEventType = keyof GameEventMap

/** 日志里的一行。branch 与 revision 标明它属于时间线上的哪一版。 */
export type GameEvent = {
  [K in GameEventType]: {
    readonly v: typeof GAME_EVENT_VERSION
    readonly seq: number
    readonly at: string
    readonly branch: string
    readonly revision: number
    readonly type: K
    readonly data: GameEventMap[K]
  }
}[GameEventType]

/** 追加前的事件：seq 和时间由日志补上。 */
export type GameEventInput = {
  [K in GameEventType]: { readonly branch: string, readonly revision: number, readonly type: K, readonly data: GameEventMap[K] }
}[GameEventType]
