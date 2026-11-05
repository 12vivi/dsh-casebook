// 书记员的结算提议与四道校验：schema → 规则 → 版本 → 原句。
// 模型只能提议；全部通过才由程序原子写入，任何一项不通过整批驳回，并把原因交还给模型修正。
import { z } from 'zod'
import type { CaseFile } from '../case/schema.ts'
import { ACTION_TYPES, settlementMinutes } from './clock.ts'
import type { AppliedSettlement, CheckError } from './events.ts'
import { isDiscovered } from './state.ts'
import type { GameState } from './state.ts'

/** 结算绑定的正文版本。后台任务带着它，版本对不上就是过期结果。 */
export interface SettlementBinding {
  readonly branch: string
  readonly revision: number
}

/** 一次结算最多报多少项，防止模型一次塞进整本案卷。 */
export const SETTLEMENT_LIMITS = { discoveries: 6, attitudes: 4, testimonies: 5 } as const

/** 引用原句去掉空白和标点后至少要有几个字。 */
export const MIN_QUOTE_CHARS = 4

/** 第一道：schema。字段名与 submit_effects 工具的参数一致。 */
export const SettlementProposalSchema = z.object({
  action: z.enum(ACTION_TYPES),
  discoveries: z.array(z.object({ clue: z.string(), quote: z.string() })).max(SETTLEMENT_LIMITS.discoveries).default([]),
  attitudes: z.array(z.object({
    npc: z.string(),
    delta: z.union([z.literal(-1), z.literal(1)]),
    reason: z.string().trim().min(1),
    quote: z.string(),
  })).max(SETTLEMENT_LIMITS.attitudes).default([]),
  move: z.object({ to: z.string(), quote: z.string() }).nullable().default(null),
  testimonies: z.array(z.object({ npc: z.string(), quote: z.string() })).max(SETTLEMENT_LIMITS.testimonies).default([]),
})

export type SettlementProposal = z.infer<typeof SettlementProposalSchema>

export type SettlementCheck =
  | { readonly ok: true, readonly applied: AppliedSettlement }
  /** stale 为真表示版本已过期：这份结果不必再改，直接丢弃。 */
  | { readonly ok: false, readonly stale: boolean, readonly errors: readonly CheckError[] }

/** 比对原句用：统一全半角，去掉空白和标点符号。 */
export function normalizeForQuote(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 第三道：版本。只有当前分支最新、且还没有结论的那版正文可以结算。 */
export function checkVersion(state: GameState, binding: SettlementBinding): CheckError[] {
  const stale = (message: string): CheckError[] => [{ check: 'version', path: 'binding', message }]
  if (state.closed !== null) return stale('案件已经结案，不再结算')
  if (binding.branch !== state.branch) return stale(`分支已变：任务属于 ${binding.branch}，当前是 ${state.branch}`)
  if (binding.revision !== state.revision) return stale(`正文版本已变：任务属于第 ${binding.revision} 版，当前是第 ${state.revision} 版`)
  if (binding.revision <= state.settledRevision) return stale(`第 ${binding.revision} 版正文已经结算过`)
  return []
}

/** 第二道：规则（对象存在、所在地点、前置线索、态度门槛、数值范围）。 */
function checkRules(caseFile: CaseFile, state: GameState, proposal: SettlementProposal): CheckError[] {
  const errors: CheckError[] = []
  const rule = (path: string, message: string) => errors.push({ check: 'rule', path, message })
  const npcs = new Map(caseFile.npcs.map(npc => [npc.id, npc]))
  const clues = new Map(caseFile.clues.map(clue => [clue.id, clue]))
  const locations = new Map(caseFile.locations.map(location => [location.id, location]))

  // 本轮场景：出发地，加上本轮移动到的地点。本轮的发现、态度、口供都只能发生在这两处。
  const scene = new Set([state.location])
  if (proposal.move !== null) {
    const target = locations.get(proposal.move.to)
    if (target === undefined) rule('move.to', `没有这个地点：${proposal.move.to}`)
    else if (target.id === state.location) rule('move.to', `侦探本来就在 ${target.name}，不算移动`)
    else scene.add(target.id)
  }
  if (proposal.action === 'move' && proposal.move === null) rule('action', '行动类别是 move，但没有填 move')

  const attitudes = { ...state.attitudes }
  const changed = new Set<string>()
  proposal.attitudes.forEach((change, index) => {
    const path = `attitudes[${index}]`
    const npc = npcs.get(change.npc)
    if (npc === undefined) return rule(`${path}.npc`, `没有这个人物：${change.npc}`)
    if (!scene.has(npc.location)) return rule(`${path}.npc`, `${npc.name} 不在本轮场景里`)
    if (changed.has(npc.id)) return rule(`${path}.npc`, `${npc.name} 的态度一轮只能变一次`)
    const next = (attitudes[npc.id] ?? 0) + change.delta
    if (next < -2 || next > 2) return rule(`${path}.delta`, `${npc.name} 的态度已经到头，不能再${change.delta > 0 ? '升' : '降'}`)
    attitudes[npc.id] = next
    changed.add(npc.id)
  })

  const found = new Set(state.discovered.map(item => item.clue))
  proposal.discoveries.forEach((item, index) => {
    const path = `discoveries[${index}].clue`
    const clue = clues.get(item.clue)
    if (clue === undefined) return rule(path, `没有这条线索：${item.clue}`)
    if (isDiscovered(state, clue.id)) return rule(path, `「${clue.name}」之前已经发现过`)
    if (found.has(clue.id)) return rule(path, `「${clue.name}」在这次提交里重复了`)
    if (!scene.has(clue.location)) return rule(path, `「${clue.name}」不在本轮场景里，它在 ${locations.get(clue.location)?.name ?? clue.location}`)
    const missing = clue.discovery.requires.filter(required => !found.has(required))
    if (missing.length > 0) {
      return rule(path, `「${clue.name}」的前置线索还没发现：${missing.map(id => clues.get(id)?.name ?? id).join('、')}`)
    }
    if (clue.source !== undefined && clue.discovery.minAttitude !== undefined) {
      const attitude = attitudes[clue.source] ?? 0
      if (attitude < clue.discovery.minAttitude) {
        return rule(path, `「${clue.name}」要 ${npcs.get(clue.source)?.name ?? clue.source} 的态度至少为 ${clue.discovery.minAttitude}，现在是 ${attitude}`)
      }
    }
    found.add(clue.id)
  })

  proposal.testimonies.forEach((item, index) => {
    const npc = npcs.get(item.npc)
    if (npc === undefined) return rule(`testimonies[${index}].npc`, `没有这个人物：${item.npc}`)
    if (!scene.has(npc.location)) rule(`testimonies[${index}].npc`, `${npc.name} 不在本轮场景里`)
  })
  return errors
}

/** 第四道：原句。每一项引用的原句都必须在这版正文里原样出现。 */
function checkQuotes(proposal: SettlementProposal, narrative: string): CheckError[] {
  const errors: CheckError[] = []
  const text = normalizeForQuote(narrative)
  const check = (path: string, quote: string) => {
    const normalized = normalizeForQuote(quote)
    if (normalized.length < MIN_QUOTE_CHARS) {
      errors.push({ check: 'quote', path, message: `引用太短，去掉标点后至少要 ${MIN_QUOTE_CHARS} 个字` })
    } else if (!text.includes(normalized)) {
      errors.push({ check: 'quote', path, message: `正文里找不到这句：「${quote}」。请从正文原样复制连续的一段` })
    }
  }
  proposal.discoveries.forEach((item, index) => check(`discoveries[${index}].quote`, item.quote))
  proposal.attitudes.forEach((item, index) => check(`attitudes[${index}].quote`, item.quote))
  if (proposal.move !== null) check('move.quote', proposal.move.quote)
  proposal.testimonies.forEach((item, index) => check(`testimonies[${index}].quote`, item.quote))
  return errors
}

/**
 * 对一份结算提议依次做四道校验。
 * @param narrative - binding 指向的那版正文全文，原句校验用。
 */
export function checkSettlement(
  caseFile: CaseFile,
  state: GameState,
  binding: SettlementBinding,
  raw: unknown,
  narrative: string,
): SettlementCheck {
  const parsed = SettlementProposalSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      stale: false,
      errors: parsed.error.issues.map(item => ({ check: 'schema', path: item.path.join('.') || '(根)', message: item.message })),
    }
  }
  const proposal = parsed.data
  const ruleErrors = checkRules(caseFile, state, proposal)
  const versionErrors = checkVersion(state, binding)
  if (versionErrors.length > 0) return { ok: false, stale: true, errors: versionErrors }
  const quoteErrors = checkQuotes(proposal, narrative)
  if (ruleErrors.length > 0 || quoteErrors.length > 0) return { ok: false, stale: false, errors: [...ruleErrors, ...quoteErrors] }

  const move = proposal.move === null ? null : { from: state.location, to: proposal.move.to, quote: proposal.move.quote }
  const attitudes: Array<AppliedSettlement['attitudes'][number]> = []
  for (const change of proposal.attitudes) {
    const from = state.attitudes[change.npc] ?? 0
    attitudes.push({ npc: change.npc, from, to: from + change.delta, reason: change.reason, quote: change.quote })
  }
  return {
    ok: true,
    applied: {
      action: proposal.action,
      minutes: settlementMinutes(caseFile, proposal.action, move ?? undefined),
      discoveries: proposal.discoveries.map(item => ({ clue: item.clue, quote: item.quote })),
      attitudes,
      move,
      testimonies: proposal.testimonies.map(item => ({ npc: item.npc, quote: item.quote })),
    },
  }
}

/** 把驳回原因写成给书记员看的修改意见。 */
export function describeErrors(errors: readonly CheckError[]): string {
  const label = { schema: '格式', rule: '规则', version: '版本', quote: '原句' } as const
  return errors.map(error => `- [${label[error.check]}] ${error.path}：${error.message}`).join('\n')
}
