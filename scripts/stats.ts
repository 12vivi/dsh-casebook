// 读每局的事件日志，打印轮数、结算情况、模型用量和缓存命中率。
//   pnpm stats            统计 .dsh-home/casebook/games/ 下所有对局
//   pnpm stats <文件>     只看一局
// 命中率按 cacheReadTokens ÷ (cacheReadTokens + inputTokens) 算，与 DSH 界面一致（见 docs/m0-feasibility.md）。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addUsage, cacheHitRate, parseEventLines, ZERO_USAGE } from '../packages/domain/src/index.ts'
import type { Usage } from '../packages/domain/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? join(root, '.dsh-home/casebook/games')

function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}

function usageLine(label: string, usage: Usage): string {
  return `${label}：${usage.calls} 次调用，输入 ${usage.inputTokens} + 命中 ${usage.cacheReadTokens} token，输出 ${usage.outputTokens}，缓存命中 ${percent(cacheHitRate(usage))}`
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const files = !existsSync(target)
  ? []
  : statSync(target).isDirectory()
    ? readdirSync(target).filter(name => name.endsWith('.jsonl')).map(name => join(target, name))
    : [target]
if (files.length === 0) {
  console.log(`没有找到对局日志：${target}`)
  process.exit(0)
}

for (const file of files) {
  const { events, warnings } = parseEventLines(readFileSync(file, 'utf8'))
  let narrator = ZERO_USAGE
  let clerk = ZERO_USAGE
  const narratorMs: number[] = []
  const clerkMs: number[] = []
  const outcomes = { applied: 0, failed: 0, stale: 0 }
  let rejected = 0
  let closed = '进行中'
  for (const event of events) {
    if (event.type === 'narrative/committed') {
      narrator = addUsage(narrator, event.data.usage)
      if (event.data.ms !== undefined) narratorMs.push(event.data.ms)
    }
    if (event.type === 'clerk/finished') {
      clerk = addUsage(clerk, event.data.usage)
      clerkMs.push(event.data.ms)
      outcomes[event.data.outcome] += 1
    }
    if (event.type === 'settlement/rejected') rejected += 1
    if (event.type === 'case/closed') closed = `已结案 ${event.data.verdict.grade} ${event.data.verdict.score} 分`
  }
  const turns = events.filter(event => event.type === 'narrative/committed').length
  console.log(`\n${basename(file)}（${closed}，${turns} 轮）`)
  for (const warning of warnings) console.log(`  注意：${warning}`)
  console.log(`  ${usageLine('叙事', narrator)}`)
  console.log(`  ${usageLine('书记员', clerk)}`)
  console.log(`  结算：通过 ${outcomes.applied}，失败 ${outcomes.failed}，过期 ${outcomes.stale}；被驳回的提议 ${rejected} 次`)
  console.log(`  每轮耗时中位数：叙事 ${median(narratorMs) ?? '—'} ms，书记员 ${median(clerkMs) ?? '—'} ms`)
}
