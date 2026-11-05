// 案卷包（case.json）的结构与引用完整性校验。
// 字段按可见级别分：L1 玩家可见、L2 当前场景（叙事与书记员）、L3 全知（只有计分和结案复盘用）。
// 每个字段属于哪一级，写在下面的注释里；投影函数（context.ts、board.ts）按这个约定取字段，测试会核对没有越级。
import { z } from 'zod'

/** 案卷内的标识：小写字母开头，只含小写字母、数字和连字符。 */
export const Id = z.string().regex(/^[a-z][a-z0-9-]*$/, '标识只能用小写字母、数字和连字符，并以字母开头')

/** 时刻，24 小时制 HH:MM。 */
export const ClockText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时刻写成 HH:MM')

/** NPC 对侦探的态度：-2 敌对、-1 戒备、0 中立、1 配合、2 信任。 */
export const Attitude = z.number().int().min(-2).max(2)

const Text = z.string().trim().min(1)

export const LocationSchema = z.object({
  id: Id,
  /** L1 */ name: Text,
  /** L1：玩家用来指代这个地点的说法，也用于从玩家输入里预判要去哪 */ aliases: z.array(Text).default([]),
  /** L1：到访时看到的情形 */ description: Text,
  /** L2：给叙事的补充细节、次要人物 */ details: z.string().default(''),
  /** L1：相邻地点（无向，校验时要求双向都写） */ exits: z.array(Id).min(1),
}).strict()

export const NpcSchema = z.object({
  id: Id,
  /** L1 */ name: Text,
  /** L1：身份，如「顾太太」 */ role: Text,
  /** L1：玩家指代此人的说法 */ aliases: z.array(Text).default([]),
  /** L1：所在地点（M1 固定不动，M2 起由案件日程移动） */ location: Id,
  /** L1：外观与公开身份 */ publicProfile: Text,
  /** L2：性格与口吻 */ persona: Text,
  /** L2：知道并愿意说的事 */ knows: z.array(Text).default([]),
  /** L2：谎话、实情与改口条件 */
  lies: z.array(z.object({ claim: Text, truth: Text, breaksWhen: Text }).strict()).default([]),
  /** L2：秘密与松口条件 */
  secrets: z.array(z.object({ text: Text, unlock: Text }).strict()).default([]),
  /** L1：开局态度 */ initialAttitude: Attitude,
}).strict()

export const ClueSchema = z.object({
  id: Id,
  /** L1（发现后） */ name: Text,
  /** L1（发现后） */ kind: z.enum(['physical', 'document', 'testimony']),
  /** L2：在哪个地点能发现 */ location: Id,
  /** L2：证词类线索的说话人 */ source: Id.optional(),
  /** L1：玩家可能用来指代它的词，用于检索和测试 */ keywords: z.array(Text).default([]),
  /** L1（发现后）：侦探看到或听到的内容 */ appearance: Text,
  /** L2：发现条件 */
  discovery: z.object({
    /** L2：自然语言写的条件，给叙事和书记员判断 */ hint: Text,
    /** L2：前置线索，全部发现后才能发现这一条（程序强制） */ requires: z.array(Id).default([]),
    /** L2：说话人态度至少达到多少（程序强制，需有 source） */ minAttitude: Attitude.optional(),
  }).strict(),
  /** L3：这条线索证明什么 */ pointsTo: Text,
}).strict()

export const QuestionSchema = z.object({
  id: Id,
  prompt: Text,
  options: z.array(z.object({ id: Id, text: Text }).strict()).min(2),
  /** L3 */ answer: Id,
}).strict()

export const CaseSchema = z.object({
  id: Id,
  title: Text,
  version: z.number().int().min(1),
  /** L1：公开案情 */
  public: z.object({
    /** 一句话案情，用于线索板标题下方 */ summary: Text,
    /** 开局交给侦探的完整案情 */ briefing: Text,
    /** 玩家扮演的侦探 */ detective: Text,
    startLocation: Id,
    startTime: ClockText,
  }).strict(),
  /** L3：真相 */
  truth: z.object({
    culprit: Id,
    motive: Text,
    method: Text,
    timeline: z.array(z.object({ time: ClockText, event: Text }).strict()).min(1),
    /** 结案后展示的复盘全文 */ reveal: Text,
  }).strict(),
  npcs: z.array(NpcSchema).min(1),
  locations: z.array(LocationSchema).min(1),
  clues: z.array(ClueSchema).min(1),
  /** L3：结案判定 */
  solution: z.object({
    /** 证据链：每一环至少要出示其中一条线索 */
    proofs: z.array(z.object({ id: Id, label: Text, anyOf: z.array(Id).min(1) }).strict()).min(1),
    /** 指认时的选择题（动机、手法） */
    questions: z.array(QuestionSchema).default([]),
  }).strict(),
}).strict()

export type CaseFile = z.infer<typeof CaseSchema>
export type CaseNpc = z.infer<typeof NpcSchema>
export type CaseLocation = z.infer<typeof LocationSchema>
export type CaseClue = z.infer<typeof ClueSchema>
export type CaseQuestion = z.infer<typeof QuestionSchema>

/** 结构校验之外的引用完整性问题。 */
export interface CaseIssue {
  readonly path: string
  readonly message: string
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  return [...repeated]
}

/** 前置线索依赖图里的环，返回其中一个环上的线索；无环返回 undefined。 */
function findRequiresCycle(clues: readonly CaseClue[]): string[] | undefined {
  const byId = new Map(clues.map(clue => [clue.id, clue]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): string[] | undefined => {
    const mark = state.get(id)
    if (mark === 'done') return undefined
    if (mark === 'visiting') return stack.slice(stack.indexOf(id))
    state.set(id, 'visiting')
    stack.push(id)
    for (const next of byId.get(id)?.discovery.requires ?? []) {
      const cycle = visit(next)
      if (cycle !== undefined) return cycle
    }
    stack.pop()
    state.set(id, 'done')
    return undefined
  }
  for (const clue of clues) {
    const cycle = visit(clue.id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/** 检查案卷内部的引用是否都能对上。可解性检查（M4）比这更严，这里只保证程序不会因坏引用出错。 */
export function checkCaseReferences(caseFile: CaseFile): CaseIssue[] {
  const issues: CaseIssue[] = []
  const npcIds = new Set(caseFile.npcs.map(npc => npc.id))
  const locationIds = new Set(caseFile.locations.map(location => location.id))
  const clueIds = new Set(caseFile.clues.map(clue => clue.id))
  const issue = (path: string, message: string) => issues.push({ path, message })

  for (const [kind, ids] of [['npcs', caseFile.npcs.map(n => n.id)], ['locations', caseFile.locations.map(l => l.id)], ['clues', caseFile.clues.map(c => c.id)]] as const) {
    for (const id of duplicates(ids)) issue(kind, `标识重复：${id}`)
  }
  for (const id of npcIds) {
    if (locationIds.has(id) || clueIds.has(id)) issue('npcs', `人物、地点、线索之间标识重复：${id}`)
  }
  for (const id of locationIds) {
    if (clueIds.has(id)) issue('locations', `地点与线索标识重复：${id}`)
  }

  if (!locationIds.has(caseFile.public.startLocation)) issue('public.startLocation', `没有这个地点：${caseFile.public.startLocation}`)
  if (!npcIds.has(caseFile.truth.culprit)) issue('truth.culprit', `没有这个人物：${caseFile.truth.culprit}`)

  caseFile.locations.forEach((location, index) => {
    for (const exit of location.exits) {
      if (!locationIds.has(exit)) issue(`locations[${index}].exits`, `没有这个地点：${exit}`)
      else if (exit === location.id) issue(`locations[${index}].exits`, '地点不能和自己相邻')
      else if (!caseFile.locations.find(other => other.id === exit)?.exits.includes(location.id)) {
        issue(`locations[${index}].exits`, `${location.id} 与 ${exit} 的相邻关系要双向都写`)
      }
    }
  })
  const reachable = new Set<string>([caseFile.public.startLocation])
  const queue = [caseFile.public.startLocation]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const exit of caseFile.locations.find(location => location.id === current)?.exits ?? []) {
      if (!reachable.has(exit)) {
        reachable.add(exit)
        queue.push(exit)
      }
    }
  }
  for (const id of locationIds) {
    if (!reachable.has(id)) issue('locations', `从开局地点走不到：${id}`)
  }

  caseFile.npcs.forEach((npc, index) => {
    if (!locationIds.has(npc.location)) issue(`npcs[${index}].location`, `没有这个地点：${npc.location}`)
  })

  caseFile.clues.forEach((clue, index) => {
    if (!locationIds.has(clue.location)) issue(`clues[${index}].location`, `没有这个地点：${clue.location}`)
    if (clue.source !== undefined) {
      const source = caseFile.npcs.find(npc => npc.id === clue.source)
      if (source === undefined) issue(`clues[${index}].source`, `没有这个人物：${clue.source}`)
      else if (source.location !== clue.location) issue(`clues[${index}].source`, `说话人 ${source.id} 不在线索所在地点 ${clue.location}`)
    }
    if (clue.discovery.minAttitude !== undefined && clue.source === undefined) {
      issue(`clues[${index}].discovery.minAttitude`, '只有写了 source 的证词类线索才能设态度门槛')
    }
    for (const required of clue.discovery.requires) {
      if (!clueIds.has(required)) issue(`clues[${index}].discovery.requires`, `没有这条线索：${required}`)
      if (required === clue.id) issue(`clues[${index}].discovery.requires`, '线索不能以自己为前置')
    }
  })
  const cycle = findRequiresCycle(caseFile.clues)
  if (cycle !== undefined) issue('clues', `前置线索成环：${cycle.join(' → ')}`)

  caseFile.solution.proofs.forEach((proof, index) => {
    for (const clue of proof.anyOf) {
      if (!clueIds.has(clue)) issue(`solution.proofs[${index}].anyOf`, `没有这条线索：${clue}`)
    }
  })
  for (const id of duplicates(caseFile.solution.proofs.map(proof => proof.id))) issue('solution.proofs', `证据链环节标识重复：${id}`)
  caseFile.solution.questions.forEach((question, index) => {
    if (!question.options.some(option => option.id === question.answer)) {
      issue(`solution.questions[${index}].answer`, `答案不在选项里：${question.answer}`)
    }
    for (const id of duplicates(question.options.map(option => option.id))) issue(`solution.questions[${index}].options`, `选项标识重复：${id}`)
  })
  for (const id of duplicates(caseFile.solution.questions.map(question => question.id))) issue('solution.questions', `题目标识重复：${id}`)
  return issues
}

/** 案卷不合格时抛出，message 列出所有问题。 */
export class CaseFileError extends Error {
  readonly issues: readonly CaseIssue[]

  constructor(issues: readonly CaseIssue[]) {
    super(`案卷不合格：\n${issues.map(item => `- ${item.path}：${item.message}`).join('\n')}`)
    this.name = 'CaseFileError'
    this.issues = issues
  }
}

/** 解析并校验案卷对象；结构或引用有问题都抛 CaseFileError。 */
export function parseCase(raw: unknown): CaseFile {
  const parsed = CaseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new CaseFileError(parsed.error.issues.map(item => ({ path: item.path.join('.') || '(根)', message: item.message })))
  }
  const issues = checkCaseReferences(parsed.data)
  if (issues.length > 0) throw new CaseFileError(issues)
  return parsed.data
}
