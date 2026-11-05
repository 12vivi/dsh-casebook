// 启动挂着雾港案卷插件的 DSH Web。
//   pnpm web          用真模型玩（先在网页「设置 → 模型」里保存 DeepSeek 密钥）
//   pnpm web:fake     默认模型换成不联网的假模型，用来走通流程、调界面
// DSH 的数据目录固定在仓库内被 git 忽略的 .dsh-home/；每局的事件日志在 .dsh-home/casebook/games/。
// cordis 覆盖层要求插件写绝对路径，所以每次启动按本文件位置生成 .dsh-home/casebook-overlay.yml。
// 环境变量：CASEBOOK_PORT 改端口（默认 3180）；CASEBOOK_CLERK_PROVIDER / CASEBOOK_CLERK_MODEL 给书记员单独指定模型。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.dsh-home')
const fake = process.argv.includes('--fake')
const posix = (path: string) => path.replaceAll('\\', '/')
const at = (relative: string) => `'${posix(join(root, relative))}'`
// 预设里的子插件由另一套加载逻辑直接 import(name)：Windows 上 D:/… 会被当成 d: 协议，所以写成 file:// URL。
const url = (relative: string) => `'${pathToFileURL(join(root, relative)).href}'`

const clerkModel = process.env.CASEBOOK_CLERK_PROVIDER !== undefined && process.env.CASEBOOK_CLERK_MODEL !== undefined
  ? `\n        clerkProvider: '${process.env.CASEBOOK_CLERK_PROVIDER}'\n        clerkModel: '${process.env.CASEBOOK_CLERK_MODEL}'`
  : ''

const overlay = `# 由 scripts/web.ts 生成，每次启动覆盖，不要手改。
- insert:
    - id: casebook
      name: ${at('packages/plugin/src/index.ts')}
      config:
        caseDir: ${at('cases/ebb-tide')}
        promptsDir: ${at('prompts')}
        dataDir: ${at('.dsh-home/casebook')}${clerkModel}
    - id: casebook-fake-llm
      name: ${at('packages/plugin/src/fake-llm.ts')}
    - id: casebook-client
      name: ${at('packages/client/index.ts')}
    - id: preset-casebook
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: casebook
        name: 雾港案卷
        description: 推理探案游戏：你扮演侦探，叙事者描写场景、扮演人物，右侧「线索板」记录进展。
        order: 0
        plugins:
          - id: casebook-narrator
            name: ${url('packages/plugin/src/narrator.ts')}

# 新建会话默认就是一局游戏；写代码用的 standard 等模式仍可在会话的模式选择里切换。
- id: agent-preset-registry
  config:
    default: casebook
${fake ? `
# --fake：默认模型换成不联网的假模型。
- id: agent-default-model
  config:
    provider: casebook-fake
    model: detective
` : ''}`

mkdirSync(home, { recursive: true })
const overlayPath = join(home, 'casebook-overlay.yml')
writeFileSync(overlayPath, overlay)

const port = process.env.CASEBOOK_PORT ?? '3180'
const cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
console.log(`[casebook] ${fake ? '假模型模式' : '真模型模式'}，端口 ${port}，覆盖层 ${posix(overlayPath)}`)
const child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', overlayPath, '--port', port, '--no-open'], {
  stdio: 'inherit',
  env: { ...process.env, DSH_HOME: home },
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 1))
