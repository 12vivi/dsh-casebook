// 雾港案卷的宿主插件：提供 casebook 服务（对局、结算队列、书记员），注册线索板用的 HTTP 路由。
// 叙事那一半挂在 Agent 预设里，见 narrator.ts。
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerRoutes } from './routes.ts'
import { CasebookRuntime } from './runtime.ts'
import type { CasebookConfig } from './types.ts'
import './types.ts'

export const name = 'casebook'
export const inject = ['agents', 'sessions', 'connection', 'systemPrompt', 'tools']

export function apply(ctx: Context, config: CasebookConfig) {
  const runtime = new CasebookRuntime(ctx, config)
  ctx.on('session/event', (session, event) => runtime.onSessionEvent(session, event))
  registerRoutes(ctx, runtime)
  ctx.effect(() => () => runtime.dispose())
  ctx.provide('casebook', runtime)
  console.log('[casebook] 已加载案卷', `${runtime.caseFile.title}（${runtime.caseFile.id} v${runtime.caseFile.version}）`)

  // 登记一个「雾港案卷」工作区：玩家在侧栏点它就能新开一局，不必先在系统对话框里选目录。
  // 叙事和书记员都没有文件工具，这个目录只是会话的归属。目录已登记过时 create 原样返回。
  ctx.inject(['workspaceRegistry'], async workspaceCtx => {
    const directory = join(config.dataDir, 'workspace')
    mkdirSync(directory, { recursive: true })
    try {
      await workspaceCtx.workspaceRegistry.create(directory, '雾港案卷')
    } catch (error) {
      console.warn('[casebook] 登记工作区失败', error instanceof Error ? error.message : String(error))
    }
  })
}
