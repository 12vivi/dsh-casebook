// 启动挂着 M0 插件的 DSH Web。
// DSH 的数据目录固定在仓库内被 git 忽略的 .dsh-home/，不读写用户目录下的 ~/.dsh。
// cordis 覆盖层要求插件写绝对路径，所以每次启动时按本文件位置生成到 .dsh-home/m0-overlay.yml。
// 运行：pnpm m0:web（端口默认 3180，可用环境变量 CASEBOOK_PORT 改）
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const home = join(root, '.dsh-home')

/** 要挂进 Web profile 的插件：[cordis 条目 id, 相对本目录的源文件]。 */
const plugins: Array<[string, string]> = [
  ['casebook-fake-llm', 'plugins/fake-llm.ts'],
  ['casebook-hello-tool', 'plugins/hello-tool.ts'],
  ['casebook-background-session', 'plugins/background-session.ts'],
  ['casebook-compaction-prompt', 'plugins/compaction-prompt.ts'],
  ['casebook-real-cache-check', 'plugins/real-cache-check.ts'],
  ['casebook-clue-board', 'clue-board/index.ts'],
]

const entries = plugins
  .map(([id, file]) => `    - id: ${id}\n      name: '${join(here, file).replaceAll('\\', '/')}'`)
  .join('\n')

/** 书记员专用的 Agent 预设：只挂压缩引擎（关掉自动压缩），写法照 dsh-web-app 的 standard 预设。 */
const clerkPreset = `    - id: preset-casebook-clerk
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: casebook-clerk
        plugins:
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
                config:
                  auto: false`

mkdirSync(home, { recursive: true })
const overlayPath = join(home, 'm0-overlay.yml')
writeFileSync(overlayPath, `- insert:\n${entries}\n${clerkPreset}\n`)

const port = process.env.CASEBOOK_PORT ?? '3180'
const cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', overlayPath, '--port', port, '--no-open'], {
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: home },
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 1))
