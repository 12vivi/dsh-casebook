// 信息隔离：低级别的输出里不能出现高级别字段的原文。
// 不靠提示词里写「请勿透露」，而是叙事、书记员、线索板根本拿不到答案。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boardView, clerkTask, narratorSections, replay } from '../src/index.ts'
import type { CaseFile, GameEvent, GameState } from '../src/index.ts'
import { ebbTide, moveTo, newGame, settle } from './helpers.ts'

/** L3：真相、线索指向、结案判定。 */
function l3Texts(caseFile: CaseFile): string[] {
  return [
    caseFile.truth.motive,
    caseFile.truth.method,
    caseFile.truth.reveal,
    ...caseFile.truth.timeline.map(item => item.event),
    ...caseFile.clues.map(clue => clue.pointsTo),
    ...caseFile.solution.proofs.map(proof => proof.label),
  ]
}

/** L2：人物的私有档案、线索发现条件、地点补充细节。 */
function l2Texts(caseFile: CaseFile): string[] {
  return [
    ...caseFile.npcs.flatMap(npc => [npc.persona, ...npc.knows, ...npc.lies.flatMap(lie => [lie.truth, lie.breaksWhen]), ...npc.secrets.flatMap(secret => [secret.text, secret.unlock])]),
    ...caseFile.clues.map(clue => clue.discovery.hint),
    ...caseFile.locations.map(location => location.details).filter(text => text !== ''),
  ]
}

function assertNoneOf(output: string, forbidden: readonly string[], what: string): void {
  for (const text of forbidden) {
    assert.ok(!output.includes(text), `${what}里出现了不该有的内容：${text.slice(0, 40)}…`)
  }
}

/** 每个地点都当一次「当前所在」，玩家输入里提到所有地点和人物，尽量把能给的资料都给出来。 */
function everyScene(caseFile: CaseFile): Array<{ state: GameState, input: string }> {
  const everything = [...caseFile.locations.map(location => location.name), ...caseFile.npcs.map(npc => npc.name)].join('、')
  return caseFile.locations.map(location => {
    const started: GameEvent = {
      v: 1, seq: 0, at: '2026-11-05T00:00:00.000Z', branch: 'main', revision: 0, type: 'game/started',
      data: { caseId: caseFile.id, caseVersion: caseFile.version, sessionId: 's', location: location.id, clock: 420 },
    }
    return { state: replay(caseFile, [started]), input: `我要去${everything}看看` }
  })
}

describe('叙事拿到的是 L2，拿不到 L3', () => {
  it('任何地点、任何输入下，叙事上下文里都没有真相和线索指向', () => {
    const caseFile = ebbTide()
    for (const { state, input } of everyScene(caseFile)) {
      const text = narratorSections(caseFile, state, input, new Set()).map(section => section.text).join('\n')
      assertNoneOf(text, l3Texts(caseFile), `叙事上下文（${state.location}）`)
    }
  })

  it('人物档案只在本人所在或要去的地点给出', () => {
    const caseFile = ebbTide()
    const game = newGame()
    const names = game.narratorSections('四处看看', new Set()).map(section => section.name)
    assert.deepEqual(names, ['casebook:briefing', 'casebook:location:front-hall', 'casebook:npc:liu-manqing', 'casebook:turn:1'])
    const secret = caseFile.npcs.find(npc => npc.id === 'he-shenzhi')!.secrets[1]!.text
    assert.ok(!names.some(name => name.includes('he-shenzhi')))
    assert.ok(!game.narratorSections('四处看看', new Set()).some(section => section.text.includes(secret)))
  })

  it('给过的资料不再重复：只追加新内容', () => {
    const game = newGame()
    const first = game.narratorSections('去书房', new Set())
    const delivered = new Set(first.map(section => section.name))
    const second = game.narratorSections('去书房', delivered)
    assert.deepEqual(second.map(section => section.name), ['casebook:turn:1'])
  })
})

describe('书记员拿到的是 L2，拿不到 L3', () => {
  it('结算任务里没有真相和线索指向', () => {
    const caseFile = ebbTide()
    for (const { state, input } of everyScene(caseFile)) {
      const text = clerkTask(caseFile, { ...state, revision: 1, turn: 1 }, { branch: 'main', revision: 1 }, input, '（正文）')
      assertNoneOf(text, l3Texts(caseFile), `结算任务（${state.location}）`)
    }
  })
})

describe('线索板是 L1', () => {
  it('结案前，即使所有线索都发现了，也没有 L2、L3 的原文', () => {
    const caseFile = ebbTide()
    const game = newGame()
    for (const clue of caseFile.clues) {
      if (game.state.location !== clue.location) moveTo(game, clue.location)
      if (clue.source !== undefined) {
        settle(game, '对方的神情缓和下来。', { action: 'interrogate', attitudes: [{ npc: clue.source, delta: 1, reason: '安抚', quote: '对方的神情缓和下来' }] })
      }
      settle(game, clue.appearance, { action: 'search', discoveries: [{ clue: clue.id, quote: clue.appearance.slice(0, 10) }] })
    }
    assert.equal(game.state.discovered.length, caseFile.clues.length)
    const board = JSON.stringify(boardView(caseFile, game.state))
    assertNoneOf(board, l3Texts(caseFile), '结案前的线索板')
    assertNoneOf(board, l2Texts(caseFile), '结案前的线索板')
  })

  it('没去过的地点不显示描述，没见过的人不显示态度', () => {
    const board = newGame().board()
    const study = board.locations.find(location => location.id === 'study')
    assert.equal(study?.description, null)
    const he = board.npcs.find(npc => npc.id === 'he-shenzhi')
    assert.equal(he?.met, false)
    assert.equal(he?.attitude, null)
    assert.deepEqual(board.clues, [])
  })

  it('指认表单只有题目和选项，没有答案', () => {
    const board = newGame().board()
    assert.ok(!JSON.stringify(board.accusation).includes('"answer"'))
    assert.equal(board.verdict, null)
  })
})
