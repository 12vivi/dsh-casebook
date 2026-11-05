// 四道校验：schema → 规则 → 版本 → 原句。每道各有该拦和不该拦的用例。
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SETTLEMENT_ATTEMPTS, normalizeForQuote } from '../src/index.ts'
import type { SettlementCheck } from '../src/index.ts'
import { moveTo, narrate, newGame, settle } from './helpers.ts'

const STUDY_TEXT = '你俯身细看书桌。书桌上的铜镇纸擦得锃亮，比桌上别的东西都干净。凑近看，镇纸底座的回纹缝里嵌着一点暗红的血迹。'

function failed(result: SettlementCheck): { stale: boolean, checks: string[], messages: string } {
  assert.equal(result.ok, false, '这份提议本该被驳回')
  if (result.ok) throw new Error('unreachable')
  return { stale: result.stale, checks: result.errors.map(error => error.check), messages: result.errors.map(error => `${error.path} ${error.message}`).join('\n') }
}

describe('第一道：schema', () => {
  it('拒绝未知的行动类别', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), { action: 'dance' })
    assert.deepEqual(failed(result).checks, ['schema'])
  })

  it('态度一次只能变 1', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'interrogate',
      attitudes: [{ npc: 'liu-manqing', delta: 2, reason: '很感动', quote: '你俯身细看书桌' }],
    })
    assert.deepEqual(failed(result).checks, ['schema'])
  })

  it('缺字段、类型不对都算 schema 错', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), { action: 'search', discoveries: [{ clue: 'paperweight' }] })
    const outcome = failed(result)
    assert.deepEqual(outcome.checks, ['schema'])
    assert.match(outcome.messages, /discoveries\.0\.quote/)
  })

  it('各列表可以省略，空结算也合法', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, '你在前厅站了一会儿，没有说话。'), { action: 'think' })
    assert.equal(result.ok, true)
  })
})

describe('第二道：规则', () => {
  it('不在本轮场景里的线索不能发现', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸擦得锃亮' }],
    })
    const outcome = failed(result)
    assert.deepEqual(outcome.checks, ['rule'])
    assert.match(outcome.messages, /不在本轮场景里/)
  })

  it('同一轮里移动过去再发现是允许的', () => {
    const game = newGame()
    const text = `你上楼进了顾宅书房。${STUDY_TEXT}`
    const result = game.submitSettlement(narrate(game, text), {
      action: 'search',
      move: { to: 'study', quote: '你上楼进了顾宅书房' },
      discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸擦得锃亮' }],
    })
    assert.equal(result.ok, true)
    assert.equal(game.state.location, 'study')
    assert.deepEqual(game.state.discovered.map(item => item.clue), ['paperweight'])
  })

  it('前置线索没发现就不能发现后续线索', () => {
    const game = newGame()
    moveTo(game, 'pier')
    const text = '第三根桥桩上缠着的破渔网里，兜着一本泡得发胀的账本。'
    const result = game.submitSettlement(narrate(game, text), {
      action: 'search',
      discoveries: [{ clue: 'ledger-in-net', quote: '兜着一本泡得发胀的账本' }],
    })
    assert.match(failed(result).messages, /前置线索还没发现：石阶上的泥脚印/)
  })

  it('前置线索在同一次提交里先发现也算', () => {
    const game = newGame()
    moveTo(game, 'pier')
    const text = '石阶上半截有一串干了的灰泥脚印。你顺着脚印找到第三根桥桩，渔网里兜着一本泡得发胀的账本。'
    const result = game.submitSettlement(narrate(game, text), {
      action: 'search',
      discoveries: [
        { clue: 'mud-prints', quote: '石阶上半截有一串干了的灰泥脚印' },
        { clue: 'ledger-in-net', quote: '渔网里兜着一本泡得发胀的账本' },
      ],
    })
    assert.equal(result.ok, true)
  })

  it('证词类线索要说话人的态度够格，同一轮先升态度再开口也行', () => {
    const game = newGame()
    moveTo(game, 'backyard')
    const text = '你蹲下来帮阿萍拧干衣裳，答应不告诉太太。阿萍咬着嘴唇，终于开口：「十点四十，我在柴房门缝里看见一个穿长衫的人从后楼梯下来。」'
    const tooEarly = game.submitSettlement(narrate(game, text), {
      action: 'interrogate',
      discoveries: [{ clue: 'aping-testimony', quote: '我在柴房门缝里看见一个穿长衫的人' }],
    })
    assert.match(failed(tooEarly).messages, /态度至少为 1，现在是 0/)
    const withWarmth = game.submitSettlement({ branch: 'main', revision: game.state.revision }, {
      action: 'interrogate',
      attitudes: [{ npc: 'a-ping', delta: 1, reason: '侦探答应替她保密', quote: '答应不告诉太太' }],
      discoveries: [{ clue: 'aping-testimony', quote: '我在柴房门缝里看见一个穿长衫的人' }],
      testimonies: [{ npc: 'a-ping', quote: '十点四十，我在柴房门缝里看见一个穿长衫的人从后楼梯下来' }],
    })
    assert.equal(withWarmth.ok, true)
    assert.equal(game.state.attitudes['a-ping'], 1)
  })

  it('不在场的人不能改态度、不能记口供', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, '你想起何慎之那副圆框眼镜，心里有些不舒服。'), {
      action: 'think',
      attitudes: [{ npc: 'he-shenzhi', delta: -1, reason: '侦探起疑', quote: '心里有些不舒服' }],
      testimonies: [{ npc: 'he-shenzhi', quote: '你想起何慎之那副圆框眼镜' }],
    })
    const outcome = failed(result)
    assert.deepEqual(outcome.checks, ['rule', 'rule'])
    assert.match(outcome.messages, /何慎之 不在本轮场景里/)
  })

  it('态度到头了不能再变，同一人一轮只能变一次', () => {
    const game = newGame()
    moveTo(game, 'warehouse')
    const text = '何慎之连连作揖，说顾老爷待他恩重如山。'
    const result = game.submitSettlement(narrate(game, text), {
      action: 'interrogate',
      attitudes: [
        { npc: 'he-shenzhi', delta: 1, reason: '客套', quote: '何慎之连连作揖' },
        { npc: 'he-shenzhi', delta: 1, reason: '再客套', quote: '说顾老爷待他恩重如山' },
      ],
    })
    assert.match(failed(result).messages, /一轮只能变一次/)
  })

  it('已经发现的线索、本次重复的线索、不存在的线索都拒绝', () => {
    const game = newGame()
    moveTo(game, 'study')
    settle(game, STUDY_TEXT, { action: 'search', discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸擦得锃亮' }] })
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [
        { clue: 'paperweight', quote: '书桌上的铜镇纸擦得锃亮' },
        { clue: 'no-such-clue', quote: '书桌上的铜镇纸擦得锃亮' },
      ],
    })
    const outcome = failed(result)
    assert.match(outcome.messages, /之前已经发现过/)
    assert.match(outcome.messages, /没有这条线索：no-such-clue/)
  })

  it('移动到原地或不存在的地点都拒绝', () => {
    const game = newGame()
    const here = game.submitSettlement(narrate(game, '你在前厅里来回踱步。'), { action: 'move', move: { to: 'front-hall', quote: '你在前厅里来回踱步' } })
    assert.match(failed(here).messages, /不算移动/)
    const nowhere = game.submitSettlement({ branch: 'main', revision: game.state.revision }, { action: 'move', move: { to: 'moon', quote: '你在前厅里来回踱步' } })
    assert.match(failed(nowhere).messages, /没有这个地点：moon/)
  })
})

describe('第三道：版本', () => {
  it('下一版正文提交后，上一版的结算作废', () => {
    const game = newGame()
    const first = narrate(game, '你走进前厅，柳曼卿抬头看了你一眼。')
    narrate(game, '你在前厅里站定，开始打量四周。')
    const result = game.submitSettlement(first, { action: 'search' })
    const outcome = failed(result)
    assert.equal(outcome.stale, true)
    assert.deepEqual(outcome.checks, ['version'])
    assert.equal(game.state.lastSettlement?.status, 'failed', '被顶掉的那版正文应记为结算失败')
  })

  it('同一版正文不能结算两次', () => {
    const game = newGame()
    const binding = narrate(game, '你走进前厅，柳曼卿抬头看了你一眼。')
    assert.equal(game.submitSettlement(binding, { action: 'search' }).ok, true)
    assert.equal(failed(game.submitSettlement(binding, { action: 'search' })).stale, true)
  })

  it('分支不对就是过期结果', () => {
    const game = newGame()
    const binding = narrate(game, '你走进前厅，柳曼卿抬头看了你一眼。')
    assert.equal(failed(game.submitSettlement({ ...binding, branch: 'old' }, { action: 'search' })).stale, true)
  })

  it('过期的提议即使规则和原句也有错，只报版本错', () => {
    const game = newGame()
    const first = narrate(game, '你走进前厅。')
    narrate(game, '你又看了一眼。')
    const outcome = failed(game.submitSettlement(first, { action: 'search', discoveries: [{ clue: 'paperweight', quote: '不存在的话' }] }))
    assert.deepEqual(outcome.checks, ['version'])
  })

  it('结案以后不再接受结算', () => {
    const game = newGame()
    moveTo(game, 'study')
    settle(game, STUDY_TEXT, { action: 'search', discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸擦得锃亮' }] })
    const binding = narrate(game, '你回头望了一眼窗外。')
    const verdict = game.accuse({ culprit: 'zhao-si', evidence: ['paperweight'], answers: { motive: 'debt', method: 'hook' } })
    assert.equal(verdict.ok, true)
    assert.equal(failed(game.submitSettlement(binding, { action: 'search' })).stale, true)
  })
})

describe('第四道：原句', () => {
  it('正文里没有的句子不行', () => {
    const game = newGame()
    moveTo(game, 'study')
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '镇纸上写着凶手的名字' }],
    })
    const outcome = failed(result)
    assert.deepEqual(outcome.checks, ['quote'])
    assert.match(outcome.messages, /正文里找不到这句/)
  })

  it('太短的引用不行', () => {
    const game = newGame()
    moveTo(game, 'study')
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '镇纸。' }],
    })
    assert.match(failed(result).messages, /引用太短/)
  })

  it('空白、标点和全半角的差别不算错', () => {
    const game = newGame()
    moveTo(game, 'study')
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸 擦得锃亮,比桌上别的东西都干净' }],
    })
    assert.equal(result.ok, true)
    assert.equal(normalizeForQuote('「十时　何　对账」'), '十时何对账')
  })

  it('跨句拼接（中间省略）不算原句', () => {
    const game = newGame()
    moveTo(game, 'study')
    const result = game.submitSettlement(narrate(game, STUDY_TEXT), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '书桌上的铜镇纸……一点暗红的血迹' }],
    })
    assert.deepEqual(failed(result).checks, ['quote'])
  })

  it('规则和原句的错一起报，方便一次改完', () => {
    const game = newGame()
    const result = game.submitSettlement(narrate(game, '你在前厅坐下。'), {
      action: 'search',
      discoveries: [{ clue: 'paperweight', quote: '没有这句话呀' }],
    })
    assert.deepEqual(failed(result).checks, ['rule', 'quote'])
  })
})

describe('通过之后', () => {
  it('原子写入：地点、时钟、线索、态度、口供一起变', () => {
    const game = newGame()
    const before = game.state
    const text = '你下到码头。赵四斜眼看你：「老子整晚都在船上睡觉。」石阶上半截有一串干了的灰泥脚印。'
    const binding = narrate(game, text, '去码头看看')
    const result = game.submitSettlement(binding, {
      action: 'search',
      move: { to: 'pier', quote: '你下到码头' },
      discoveries: [{ clue: 'mud-prints', quote: '石阶上半截有一串干了的灰泥脚印' }],
      attitudes: [{ npc: 'zhao-si', delta: -1, reason: '侦探一来就盘问', quote: '赵四斜眼看你' }],
      testimonies: [{ npc: 'zhao-si', quote: '老子整晚都在船上睡觉' }],
    })
    assert.equal(result.ok, true)
    const after = game.state
    assert.equal(after.location, 'pier')
    assert.deepEqual(after.visited, ['front-hall', 'pier'])
    assert.equal(after.clock, before.clock + 15 + 10, '调查 15 分钟加路上 10 分钟')
    assert.deepEqual(after.discovered, [{ clue: 'mud-prints', revision: binding.revision }])
    assert.equal(after.attitudes['zhao-si'], -2)
    assert.deepEqual(after.testimonies, [{ npc: 'zhao-si', quote: '老子整晚都在船上睡觉', revision: binding.revision }])
    assert.equal(after.settledRevision, binding.revision)
    assert.equal(game.events.at(-1)?.type, 'settlement/applied')
    const board = game.board()
    assert.equal(board.clues[0]?.isNew, true)
    assert.equal(board.settlement.state, 'idle')
  })

  it('驳回不改状态，只记次数；用完次数就不能再试', () => {
    const game = newGame()
    const binding = narrate(game, '你在前厅坐下。')
    for (let attempt = 1; attempt <= MAX_SETTLEMENT_ATTEMPTS; attempt += 1) {
      assert.equal(game.canRetrySettlement(binding), true)
      game.submitSettlement(binding, { action: 'search', discoveries: [{ clue: 'burnt-letter', quote: '没有这句' }] })
      assert.equal(game.state.rejectedAttempts, attempt)
    }
    assert.equal(game.canRetrySettlement(binding), false)
    assert.deepEqual(game.state.discovered, [])
    assert.equal(game.failSettlement(binding, '重试用尽'), true)
    assert.equal(game.board().settlement.state, 'failed')
    assert.equal(game.failSettlement(binding, '再失败一次'), false, '已有结论的版本不能再标失败')
  })

  it('最新一版结算失败后可以重试，重试后能正常结算', () => {
    const game = newGame()
    const binding = narrate(game, '你在前厅坐下，望着壁炉发呆。')
    assert.equal(game.retrySettlement(), undefined, '还没失败，不能重试')
    game.failSettlement(binding, '书记员超时')
    const again = game.retrySettlement()
    assert.deepEqual(again, binding)
    assert.equal(game.board().settlement.state, 'pending')
    assert.equal(game.submitSettlement(binding, { action: 'think' }).ok, true)
    assert.equal(game.retrySettlement(), undefined, '已经结算成功，不能再重试')
  })

  it('旧版本的失败不能重试', () => {
    const game = newGame()
    const first = narrate(game, '你在前厅坐下。')
    game.failSettlement(first, '超时')
    narrate(game, '你站起身来。')
    assert.equal(game.retrySettlement(), undefined)
  })
})
