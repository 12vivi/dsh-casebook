// 案卷包：真实案卷能通过校验；坏引用能被查出来。时钟与输入预判也在这里测。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CaseFileError, checkCaseReferences, findMentions, formatClock, lookaheadLocations, parseCase, settlementMinutes, stepsBetween } from '../src/index.ts'
import { cloneCase, ebbTide } from './helpers.ts'

describe('案卷「退潮之前」', () => {
  it('规模符合 M1：4 个人物、6 个地点、12 条线索', () => {
    const caseFile = ebbTide()
    assert.equal(caseFile.npcs.length, 4)
    assert.equal(caseFile.locations.length, 6)
    assert.equal(caseFile.clues.length, 12)
    assert.deepEqual(checkCaseReferences(caseFile), [])
  })

  it('证据链每一环都至少有一条能发现的线索，题目答案都在选项里', () => {
    const caseFile = ebbTide()
    const clueIds = new Set(caseFile.clues.map(clue => clue.id))
    for (const proof of caseFile.solution.proofs) assert.ok(proof.anyOf.some(id => clueIds.has(id)), proof.id)
    assert.equal(caseFile.solution.questions.length, 2)
  })
})

describe('引用完整性', () => {
  function issuesOf(mutate: (raw: ReturnType<typeof cloneCase>) => void): string {
    const raw = cloneCase()
    mutate(raw)
    try {
      parseCase(raw)
    } catch (error) {
      assert.ok(error instanceof CaseFileError)
      return error.message
    }
    assert.fail('改坏的案卷居然通过了校验')
  }

  it('人物所在地点不存在', () => {
    assert.match(issuesOf(raw => { raw.npcs[0]!.location = 'moon' }), /npcs\[0\]\.location：没有这个地点：moon/)
  })

  it('相邻关系只写了一边', () => {
    assert.match(issuesOf(raw => { raw.locations.find(l => l.id === 'teahouse')!.exits.push('front-hall') }), /要双向都写/)
  })

  it('前置线索成环', () => {
    assert.match(issuesOf(raw => { raw.clues.find(c => c.id === 'mud-prints')!.discovery.requires = ['ledger-in-net'] }), /前置线索成环/)
  })

  it('证词的说话人不在线索所在地点', () => {
    assert.match(issuesOf(raw => { raw.clues.find(c => c.id === 'aping-testimony')!.source = 'zhao-si' }), /说话人 zhao-si 不在线索所在地点/)
  })

  it('答案不在选项里、标识重复、结构不对', () => {
    assert.match(issuesOf(raw => { raw.solution.questions[0]!.answer = 'nope' }), /答案不在选项里/)
    assert.match(issuesOf(raw => { raw.clues[1]!.id = raw.clues[0]!.id }), /标识重复/)
    assert.match(issuesOf(raw => { (raw as { title: unknown }).title = 42 }), /title/)
  })

  it('走不到的地点', () => {
    // 把货栈和望潮楼隔成一座孤岛：彼此相连，但和码头断开。
    assert.match(issuesOf(raw => {
      const pier = raw.locations.find(l => l.id === 'pier')!
      pier.exits = pier.exits.filter(id => id !== 'warehouse' && id !== 'teahouse')
      raw.locations.find(l => l.id === 'teahouse')!.exits = ['warehouse']
      raw.locations.find(l => l.id === 'warehouse')!.exits = ['teahouse']
    }), /从开局地点走不到/)
  })
})

describe('时钟', () => {
  it('路上的时间按最少步数算', () => {
    const caseFile = ebbTide()
    assert.equal(stepsBetween(caseFile, 'study', 'teahouse'), 3)
    assert.equal(settlementMinutes(caseFile, 'move', { from: 'study', to: 'teahouse' }), 30)
    assert.equal(settlementMinutes(caseFile, 'interrogate'), 15)
  })

  it('跨过午夜写成次日', () => {
    assert.equal(formatClock(7 * 60 + 5), '07:05')
    assert.equal(formatClock(24 * 60 + 30), '次日 00:30')
  })
})

describe('从玩家输入预判要去哪', () => {
  it('提到地点名或别称', () => {
    const caseFile = ebbTide()
    assert.deepEqual(lookaheadLocations(caseFile, 'front-hall', '我下楼去码头看看泥滩'), ['pier'])
    assert.deepEqual(lookaheadLocations(caseFile, 'pier', '在码头四处看看'), [], '已经在这里就不算')
  })

  it('提到不在场的人，就备上他所在的地点', () => {
    const caseFile = ebbTide()
    assert.deepEqual(lookaheadLocations(caseFile, 'front-hall', '去问问何先生昨晚的事'), ['warehouse'])
    assert.deepEqual(findMentions(caseFile, '阿萍和船老大').npcs, ['a-ping', 'zhao-si'])
  })
})
