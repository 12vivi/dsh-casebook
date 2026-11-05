// 测试共用：读真实案卷，开一局，按需提交正文。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Game, loadCase, MemoryEventLog } from '../src/index.ts'
import type { CaseFile, SettlementBinding } from '../src/index.ts'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const CASE_DIR = join(REPO_ROOT, 'cases/ebb-tide')

let cached: CaseFile | undefined
export function ebbTide(): CaseFile {
  cached ??= loadCase(CASE_DIR)
  return cached
}

/** 深拷贝一份案卷，给要改坏它的测试用。 */
export function cloneCase(): CaseFile {
  return structuredClone(ebbTide())
}

export function newGame(): Game {
  return Game.start(ebbTide(), new MemoryEventLog(), 'session-test')
}

/** 提交一版正文并返回绑定。 */
export function narrate(game: Game, text: string, playerInput = '（测试输入）'): SettlementBinding {
  return game.commitNarrative({ playerInput, text })
}

/** 提交一版正文并立即用给定提议结算；不通过就抛错，方便搭场景。 */
export function settle(game: Game, text: string, proposal: Record<string, unknown>, playerInput?: string): void {
  const binding = narrate(game, text, playerInput)
  const result = game.submitSettlement(binding, proposal)
  if (!result.ok) throw new Error(`搭场景时结算没通过：${JSON.stringify(result.errors)}`)
}

/** 把侦探带到某地（一轮移动）。 */
export function moveTo(game: Game, location: string): void {
  const name = ebbTide().locations.find(item => item.id === location)!.name
  settle(game, `你快步走向${name}，推门进去。`, { action: 'move', move: { to: location, quote: `你快步走向${name}` } })
}
