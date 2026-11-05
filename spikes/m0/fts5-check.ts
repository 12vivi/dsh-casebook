// M0 待验证项 5：Node 内置 node:sqlite 的 FTS5 trigram 分词能否支撑口供的中文检索。
// 每条预期都是断言；任何一条不符合就以非零码退出。运行：pnpm m0:fts5
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec(`CREATE VIRTUAL TABLE testimony USING fts5(speaker UNINDEXED, text, tokenize='trigram')`)
const insert = db.prepare('INSERT INTO testimony (speaker, text) VALUES (?, ?)')
insert.run('管家', '那天晚上九点，我一直在码头等船，哪儿也没去。')
insert.run('女仆', '我听见书房里有人在吵架，大概是十点左右。')
insert.run('侦探', '你确定九点在码头？可窗台上有半个湿脚印。')

function speakers(sql: string, ...params: string[]): string[] {
  return db.prepare(sql).all(...params).map(row => String(row.speaker))
}

const checks: Array<[string, () => void]> = [
  ['3 字以上的查询用 MATCH 能命中', () =>
    assert.deepEqual(speakers('SELECT speaker FROM testimony WHERE testimony MATCH ?', '"在码头"').sort(), ['侦探', '管家'])],
  ['命中结果能按 bm25 排序', () =>
    assert.deepEqual(speakers('SELECT speaker FROM testimony WHERE testimony MATCH ? ORDER BY bm25(testimony)', '"湿脚印"'), ['侦探'])],
  ['2 字的查询 MATCH 查不到（trigram 的已知限制）', () =>
    assert.deepEqual(speakers('SELECT speaker FROM testimony WHERE testimony MATCH ?', '"码头"'), [])],
  ['2 字的查询用 LIKE 兜底能查到', () =>
    assert.deepEqual(speakers('SELECT speaker FROM testimony WHERE text LIKE ?', '%码头%').sort(), ['侦探', '管家'])],
  ['全文检索可以再按说话人过滤', () =>
    assert.deepEqual(speakers('SELECT speaker FROM testimony WHERE testimony MATCH ? AND speaker = ?', '"在码头"', '管家'), ['管家'])],
]

const sqliteVersion = String(db.prepare('SELECT sqlite_version() AS v').get()?.v)
console.log(`Node ${process.version}，SQLite ${sqliteVersion}`)
let failed = 0
for (const [label, check] of checks) {
  try {
    check()
    console.log(`  通过  ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  失败  ${label}\n        ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
}
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exitCode = failed === 0 ? 0 : 1
