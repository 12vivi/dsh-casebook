// 指认与计分：完全由程序按案卷的 solution 判定，不用模型。
import { z } from 'zod'
import type { CaseFile } from '../case/schema.ts'
import type { Accusation, Verdict } from './events.ts'
import { isDiscovered } from './state.ts'
import type { GameState } from './state.ts'

/** 计分权重：指认对了才有后两项。 */
export const SCORE_WEIGHTS = { culprit: 40, proofs: 40, questions: 20 } as const

export const AccusationSchema = z.object({
  culprit: z.string(),
  evidence: z.array(z.string()).min(1, '至少出示一条证据').max(8, '最多出示 8 条证据'),
  answers: z.record(z.string(), z.string()).default({}),
})

export type AccusationCheck =
  | { readonly ok: true, readonly accusation: Accusation }
  | { readonly ok: false, readonly errors: readonly string[] }

/** 检查指认是否合法：人物存在、证据都已发现且不重复、每道题都选了有效选项。 */
export function checkAccusation(caseFile: CaseFile, state: GameState, raw: unknown): AccusationCheck {
  if (state.closed !== null) return { ok: false, errors: ['这个案子已经结案了'] }
  const parsed = AccusationSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(item => `${item.path.join('.') || '指认'}：${item.message}`) }
  const { culprit, evidence, answers } = parsed.data
  const errors: string[] = []
  if (!caseFile.npcs.some(npc => npc.id === culprit)) errors.push(`没有这个人物：${culprit}`)
  if (new Set(evidence).size !== evidence.length) errors.push('证据重复了')
  for (const clue of evidence) {
    if (!caseFile.clues.some(item => item.id === clue)) errors.push(`没有这条线索：${clue}`)
    else if (!isDiscovered(state, clue)) errors.push(`还没发现的线索不能出示：${clue}`)
  }
  for (const question of caseFile.solution.questions) {
    const chosen = answers[question.id]
    if (chosen === undefined) errors.push(`还没回答：${question.prompt}`)
    else if (!question.options.some(option => option.id === chosen)) errors.push(`「${question.prompt}」没有这个选项：${chosen}`)
  }
  for (const id of Object.keys(answers)) {
    if (!caseFile.solution.questions.some(question => question.id === id)) errors.push(`没有这道题：${id}`)
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, accusation: { culprit, evidence: [...evidence], answers: { ...answers } } }
}

function grade(score: number, correctCulprit: boolean): Verdict['grade'] {
  if (!correctCulprit) return 'F'
  if (score >= 90) return 'S'
  if (score >= 75) return 'A'
  if (score >= 60) return 'B'
  return 'C'
}

/** 按 solution 判定一份合法的指认。指认错人直接判 F、记 0 分，只列出证据链和题目供复盘。 */
export function judgeAccusation(caseFile: CaseFile, state: GameState, startClock: number, accusation: Accusation): Verdict {
  const correctCulprit = accusation.culprit === caseFile.truth.culprit
  const proofs = caseFile.solution.proofs.map(proof => ({
    id: proof.id,
    label: proof.label,
    coveredBy: proof.anyOf.find(clue => accusation.evidence.includes(clue)) ?? null,
  }))
  const questions = caseFile.solution.questions.map(question => ({
    id: question.id,
    prompt: question.prompt,
    chosen: accusation.answers[question.id] ?? '',
    answer: question.answer,
    correct: accusation.answers[question.id] === question.answer,
  }))
  let score = 0
  if (correctCulprit) {
    const proofShare = SCORE_WEIGHTS.proofs / Math.max(proofs.length, 1)
    const questionShare = questions.length === 0 ? 0 : SCORE_WEIGHTS.questions / questions.length
    score = SCORE_WEIGHTS.culprit
      + proofShare * proofs.filter(proof => proof.coveredBy !== null).length
      + (questions.length === 0 ? SCORE_WEIGHTS.questions : questionShare * questions.filter(question => question.correct).length)
    score = Math.round(score)
  }
  return {
    correctCulprit,
    proofs,
    questions,
    score,
    grade: grade(score, correctCulprit),
    turns: state.turn,
    minutesUsed: state.clock - startClock,
  }
}
