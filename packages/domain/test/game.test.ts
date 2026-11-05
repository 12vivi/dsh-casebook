// 一局游戏的生命周期：事件日志的追加与重放、指认计分、结案。
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { Game, JsonlEventLog, parseClock } from '../src/index.ts'
import { ebbTide, moveTo, narrate, newGame, settle } from './helpers.ts'

const temp = mkdtempSync(join(tmpdir(), 'casebook-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))

/** 把侦探带到能指认的地步：发现给定的线索（按顺序逐地点找）。 */
function discover(game: Game, clues: readonly string[]): void {
  for (const id of clues) {
    const clue = ebbTide().clues.find(item => item.id === id)!
    if (game.state.location !== clue.location) moveTo(game, clue.location)
    if (clue.source !== undefined && (game.state.attitudes[clue.source] ?? 0) < (clue.discovery.minAttitude ?? -2)) {
      settle(game, `你耐心地安抚${clue.source}，对方的神情缓和下来。`, {
        action: 'interrogate',
        attitudes: [{ npc: clue.source, delta: 1, reason: '侦探耐心安抚', quote: '对方的神情缓和下来' }],
      })
    }
    settle(game, `你仔细查看。${clue.appearance}`, { action: 'search', discoveries: [{ clue: id, quote: clue.appearance.slice(0, 12) }] })
  }
}

describe('事件日志', () => {
  it('JSONL 只追加，重放出的状态与内存中一致', () => {
    const path = join(temp, 'replay.jsonl')
    const game = Game.start(ebbTide(), new JsonlEventLog(path), 'session-a')
    discover(game, ['window-sill', 'mud-prints'])
    const reopened = Game.open(ebbTide(), new JsonlEventLog(path))
    assert.deepEqual(reopened.state, game.state)
    assert.equal(reopened.narrativeOf(1)?.text, game.narrativeOf(1)?.text)
    const lines = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { seq: number, type: string })
    assert.deepEqual(lines.map(line => line.seq), lines.map((_, index) => index))
    assert.equal(lines[0]?.type, 'game/started')
  })

  it('崩溃留下的半行被跳过，后续事件另起一行', () => {
    const path = join(temp, 'torn.jsonl')
    const game = Game.start(ebbTide(), new JsonlEventLog(path), 'session-b')
    narrate(game, '你推开前厅的门。')
    appendFileSync(path, '{"v":1,"seq":2,"type":"narrative/comm')
    const log = new JsonlEventLog(path)
    assert.equal(log.warnings.length, 1)
    const reopened = Game.open(ebbTide(), log)
    assert.equal(reopened.state.revision, 1)
    narrate(reopened, '你又看了一眼壁炉。')
    const again = new JsonlEventLog(path)
    assert.equal(again.warnings.length, 1)
    // 开局、第 1 版正文、第 1 版结算作废（被第 2 版顶掉）、第 2 版正文
    assert.deepEqual(again.events.map(event => event.type), ['game/started', 'narrative/committed', 'settlement/failed', 'narrative/committed'])
    assert.deepEqual(again.events.map(event => event.seq), [0, 1, 2, 3])
  })

  it('开局写入起始地点与时间，打开别的案卷的日志会报错', () => {
    const game = newGame()
    assert.equal(game.state.location, 'front-hall')
    assert.equal(game.state.clock, parseClock('07:00'))
    const other = structuredClone(ebbTide())
    other.id = 'another-case'
    assert.throws(() => Game.open(other, { events: game.events, append: () => { throw new Error('不该写') } }), /不是 another-case/)
  })

  it('正文先提交：上一版还在等结算时提交下一版，上一版记为失败', () => {
    const game = newGame()
    narrate(game, '你在前厅坐下。')
    assert.deepEqual(game.pendingSettlement, { branch: 'main', revision: 1 })
    narrate(game, '你站起身来。')
    assert.deepEqual(game.pendingSettlement, { branch: 'main', revision: 2 })
    assert.equal(game.events.filter(event => event.type === 'settlement/failed').length, 1)
  })
})

describe('指认计分', () => {
  const FULL = ['diary-imprint', 'window-sill', 'stock-discrepancy', 'waiter-testimony', 'pocket-watch'] as const

  it('凶手、四环证据、两道题都对：100 分 S', () => {
    const game = newGame()
    discover(game, FULL)
    const result = game.accuse({ culprit: 'he-shenzhi', evidence: [...FULL], answers: { motive: 'exposed', method: 'staged' } })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.verdict.score, 100)
    assert.equal(result.verdict.grade, 'S')
    assert.ok(result.verdict.proofs.every(proof => proof.coveredBy !== null))
    assert.equal(game.state.closed?.verdict.score, 100)
    const board = game.board()
    assert.equal(board.status, 'closed')
    assert.equal(board.verdict?.culprit.actual, '何慎之')
    assert.match(board.verdict?.reveal.text ?? '', /凶手是账房先生何慎之/)
  })

  it('指认对了但证据链缺环、题答错一道：按比例扣分', () => {
    const game = newGame()
    discover(game, ['window-sill', 'diary-imprint'])
    const result = game.accuse({ culprit: 'he-shenzhi', evidence: ['window-sill', 'diary-imprint'], answers: { motive: 'exposed', method: 'window' } })
    assert.equal(result.ok, true)
    if (!result.ok) return
    // 凶手 40 + 两环证据 20 + 一道题 10
    assert.equal(result.verdict.score, 70)
    assert.equal(result.verdict.grade, 'B')
    assert.deepEqual(result.verdict.proofs.filter(proof => proof.coveredBy === null).map(proof => proof.id), ['motive', 'link'])
  })

  it('指认错人：F，0 分', () => {
    const game = newGame()
    discover(game, ['smuggling-iou'])
    const result = game.accuse({ culprit: 'zhao-si', evidence: ['smuggling-iou'], answers: { motive: 'debt', method: 'hook' } })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.verdict.correctCulprit, false)
    assert.equal(result.verdict.score, 0)
    assert.equal(result.verdict.grade, 'F')
  })

  it('不能出示还没发现的线索，题目要答全，结案后不能再指认', () => {
    const game = newGame()
    discover(game, ['burnt-letter'])
    const early = game.accuse({ culprit: 'he-shenzhi', evidence: ['pocket-watch'], answers: { motive: 'exposed' } })
    assert.equal(early.ok, false)
    if (early.ok) return
    assert.ok(early.errors.some(error => error.includes('还没发现的线索不能出示')))
    assert.ok(early.errors.some(error => error.includes('还没回答')))
    const done = game.accuse({ culprit: 'liu-manqing', evidence: ['burnt-letter'], answers: { motive: 'elope', method: 'poison' } })
    assert.equal(done.ok, true)
    const again = game.accuse({ culprit: 'he-shenzhi', evidence: ['burnt-letter'], answers: { motive: 'exposed', method: 'staged' } })
    assert.equal(again.ok, false)
    assert.throws(() => narrate(game, '你还想再问几句。'), /结案/)
  })

  it('用时按游戏内时钟计', () => {
    const game = newGame()
    discover(game, ['burnt-letter'])
    const result = game.accuse({ culprit: 'liu-manqing', evidence: ['burnt-letter'], answers: { motive: 'elope', method: 'poison' } })
    assert.equal(result.ok && result.verdict.minutesUsed, 15)
    assert.equal(result.ok && result.verdict.turns, 1)
  })
})
