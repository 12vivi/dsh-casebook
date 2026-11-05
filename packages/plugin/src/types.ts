// 给 DSH 的类型表补上本插件的声明：服务名 casebook、消息来源 casebook。
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { CasebookRuntime } from './runtime.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    casebook: CasebookRuntime
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** 游戏程序追加的资料：叙事的每轮案情、书记员的结算任务。聊天界面不显示这类消息。 */
    casebook: { kind: 'casebook' } & ContextFormed
  }
}

/** 本插件在宿主侧的配置（由启动脚本写进覆盖层）。 */
export interface CasebookConfig {
  /** 案卷包目录，里面有 case.json。 */
  caseDir: string
  /** 提示词目录，里面有 narrator.md、clerk.md。 */
  promptsDir: string
  /** 每局事件日志存放的目录。 */
  dataDir: string
  /** 书记员用的模型；不填就跟随叙事最近一次请求用的模型。 */
  clerkProvider?: string
  clerkModel?: string
  /** 书记员一次任务的超时（毫秒）。 */
  clerkTimeoutMs?: number
  /** 叙事开新一轮前，最多等上一轮结算多久（毫秒）。 */
  settlementWaitMs?: number
}

/** 本插件的 Agent 预设标识；在网页上新建会话时选它，这个会话就是一局游戏。 */
export const PRESET_ID = 'casebook'
