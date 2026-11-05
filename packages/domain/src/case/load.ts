// 从磁盘读案卷包。案卷包是一个目录，里面的 case.json 就是案卷。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCase } from './schema.ts'
import type { CaseFile } from './schema.ts'

/** 读取并校验案卷；path 可以是 case.json，也可以是它所在的目录。 */
export function loadCase(path: string): CaseFile {
  const file = path.endsWith('.json') ? path : join(path, 'case.json')
  return parseCase(JSON.parse(readFileSync(file, 'utf8')))
}
