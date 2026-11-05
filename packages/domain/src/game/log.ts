// 事件日志：每局一个只追加的 JSONL 文件。写入用同步追加，保证顺序；读取时跳过崩溃留下的半行。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { GAME_EVENT_VERSION } from './events.ts'
import type { GameEvent, GameEventInput } from './events.ts'

/** 事件日志的最小接口；测试用内存实现，运行时用 JSONL 文件。 */
export interface EventLog {
  readonly events: readonly GameEvent[]
  append(input: GameEventInput): GameEvent
}

function stamp(input: GameEventInput, seq: number, now: Date): GameEvent {
  return { v: GAME_EVENT_VERSION, seq, at: now.toISOString(), ...input } as GameEvent
}

export class MemoryEventLog implements EventLog {
  readonly events: GameEvent[] = []
  private readonly now: () => Date

  constructor(events: readonly GameEvent[] = [], now: () => Date = () => new Date()) {
    this.events.push(...events)
    this.now = now
  }

  append(input: GameEventInput): GameEvent {
    const event = stamp(input, this.events.length, this.now())
    this.events.push(event)
    return event
  }
}

/** 读 JSONL 日志。坏行（通常是崩溃时写了一半的最后一行）跳过并记进 warnings。 */
export function parseEventLines(text: string): { events: GameEvent[], warnings: string[] } {
  const events: GameEvent[] = []
  const warnings: string[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    let event: GameEvent
    try {
      event = JSON.parse(line) as GameEvent
    } catch {
      warnings.push(`第 ${index + 1} 行不是完整的 JSON，已跳过`)
      return
    }
    if (event.v !== GAME_EVENT_VERSION) {
      warnings.push(`第 ${index + 1} 行的事件版本 ${String(event.v)} 不认识，已跳过`)
      return
    }
    if (event.seq !== events.length) warnings.push(`第 ${index + 1} 行的序号是 ${event.seq}，应为 ${events.length}`)
    events.push(event)
  })
  return { events, warnings }
}

export class JsonlEventLog implements EventLog {
  readonly path: string
  readonly events: GameEvent[]
  readonly warnings: readonly string[]
  private readonly now: () => Date

  constructor(path: string, now: () => Date = () => new Date()) {
    this.path = path
    this.now = now
    mkdirSync(dirname(path), { recursive: true })
    if (!existsSync(path)) {
      this.events = []
      this.warnings = []
      return
    }
    const text = readFileSync(path, 'utf8')
    const parsed = parseEventLines(text)
    this.events = parsed.events
    this.warnings = parsed.warnings
    // 最后一行没写完：补一个换行，让它留在原处被跳过，新事件从下一行开始。不改写已有内容。
    if (text.length > 0 && !text.endsWith('\n')) appendFileSync(path, '\n')
  }

  append(input: GameEventInput): GameEvent {
    const event = stamp(input, this.events.length, this.now())
    appendFileSync(this.path, `${JSON.stringify(event)}\n`)
    this.events.push(event)
    return event
  }
}
