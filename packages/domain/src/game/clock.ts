// 游戏内时钟：书记员只报本轮行动属于哪一类，耗时由程序按类别换算，模型不直接改时间。
import type { CaseFile } from '../case/schema.ts'

/** 行动类别。move 本身不计时，路上的时间按地点间的步数另算。 */
export const ACTION_TYPES = ['search', 'interrogate', 'present', 'think', 'move', 'other'] as const
export type ActionType = typeof ACTION_TYPES[number]

export const ACTION_LABELS: Readonly<Record<ActionType, string>> = {
  search: '调查',
  interrogate: '审问',
  present: '出示证据',
  think: '整理推理',
  move: '移动',
  other: '其他',
}

/** 每类行动的固定耗时（分钟）。 */
export const ACTION_MINUTES: Readonly<Record<ActionType, number>> = {
  search: 15,
  interrogate: 15,
  present: 5,
  think: 5,
  move: 0,
  other: 5,
}

/** 相邻地点之间走一步的耗时（分钟）。 */
export const MINUTES_PER_STEP = 10

/** 两地之间的最少步数；走不到返回 undefined。 */
export function stepsBetween(caseFile: CaseFile, from: string, to: string): number | undefined {
  if (from === to) return 0
  const exits = new Map(caseFile.locations.map(location => [location.id, location.exits]))
  const distance = new Map<string, number>([[from, 0]])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of exits.get(current) ?? []) {
      if (distance.has(next)) continue
      const steps = distance.get(current)! + 1
      if (next === to) return steps
      distance.set(next, steps)
      queue.push(next)
    }
  }
  return undefined
}

/** 一次结算推进的分钟数：行动耗时加上路上的时间。 */
export function settlementMinutes(caseFile: CaseFile, action: ActionType, move?: { from: string, to: string }): number {
  const travel = move === undefined ? 0 : (stepsBetween(caseFile, move.from, move.to) ?? 0) * MINUTES_PER_STEP
  return ACTION_MINUTES[action] + travel
}

/** HH:MM → 当天零点起的分钟数。 */
export function parseClock(text: string): number {
  const [hours, minutes] = text.split(':').map(Number)
  return hours! * 60 + minutes!
}

/** 分钟数 → 「HH:MM」，跨过午夜写成「次日 HH:MM」。 */
export function formatClock(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440)
  const inDay = totalMinutes % 1440
  const text = `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`
  if (day === 0) return text
  return day === 1 ? `次日 ${text}` : `第 ${day + 1} 天 ${text}`
}
