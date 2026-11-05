# M0 可行性验证结论

> 2026-11-05，DSH 0.2.1-rc.5，Node 26.7.0，Windows 11。最小例子在 `spikes/m0/`，用 `pnpm m0:web` 和 `pnpm m0:fts5` 复现。

## 结论

**继续用 DSH。** 五项里四项已用能跑的例子验证通过。第 3 项「缓存命中数据」只验证了读取通路：用真模型测真实数值这一步，按决定跳过，留到 M1 第一次接真模型时顺带测。没有一项需要改 DSH 内部。

| 待验证项 | 结果 | 证据 |
|---|---|---|
| 1. 插件里开独立的后台 Agent 会话 | 通过 | `plugins/background-session.ts`：用 `ctx.agents.create` / `resume` 开会话，用 `followup` + `whenIdle` 驱动。系统提示词和工具都只有插件给的；DSH 重启后从存档恢复，消息条数接着增长（9 → 13 → 17） |
| 2. 在 Web 界面加侧栏 | 通过 | `clue-board/`：右侧栏出现「线索板」页签并正常渲染，截图见 `docs/m0/clue-board-panel.jpg` |
| 3. 拿到缓存命中数据 | 通路通过；真实数值跳过，留到 M1 | 插件能从 `assistant/message` 事件读到 `usage.cacheReadTokens`；DSH 界面的「缓存命中」也按这个字段算。真实数值用 `plugins/real-cache-check.ts` 测：在 DSH 设置里保存 DeepSeek 密钥后，带环境变量 `CASEBOOK_REAL_CACHE=1` 运行 `pnpm m0:web` |
| 4. 换掉压缩用的摘要提示词 | 通过 | `plugins/compaction-prompt.ts` 拦截 `purpose: 'compaction'` 的请求并替换指令；压缩摘要里出现替换后的提示词，压缩后消息从 29 条降到 7 条 |
| 5. node:sqlite 的 FTS5 中文检索 | 通过 | `fts5-check.ts` 的 5 项断言全部通过（Node 26.7 / SQLite 3.53.4） |

## 对方案的修正

- **缓存字段**：DSH 调 DeepSeek 走 Anthropic 兼容接口。命中数在 `usage.cacheReadTokens`，未命中的输入在 `usage.inputTokens`；方案原来写的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 在 DSH 里拿不到。命中率按 `cacheReadTokens ÷ (cacheReadTokens + inputTokens)` 算，与 DSH 界面一致。
- **系统提示词的位置**：DSH 把系统提示词作为消息列表的第一条 `system` 消息发出，不放在请求的 `system` 字段里。
- **压缩**：DSH 没有摘要提示词的配置项。插件自己开的会话默认没有压缩能力；挂上一个只含压缩引擎的自定义预设（`casebook-clerk`）后，可以用 `agentPresets.serviceFor(agent, 'compaction').compactNow()` 手动压缩，提示词靠拦截 `llm/stream` 替换。
- **会话列表**：插件开的后台会话会出现在网页左侧的会话列表里，玩家能点进去发消息。M1 要把它挂到游戏会话下面（`meta.parentSession`）或者隐藏起来。
- **起标题也调模型**：DSH 会用会话绑定的模型给会话起标题（`purpose: 'session-title'`）。后台会话换成真模型后，这会多一次付费调用。

## 踩到的坑

- GitHub 主干上的教程比 0.2.1-rc.5 新，`ctx.tools.execute` 的参数形状就不一样。核对接口一律以 `node_modules/@deepseek-ai/*` 里随包的 README 和类型为准。
- 网页里点「选择工作区」会在桌面弹出 Windows 原生选目录对话框，由 DSH 的 `dsh-host-directory-picker-native` 子进程打开。
- 依赖安装慢：平铺安装会把 TypeScript 7、语音模型等各平台的二进制都下载下来，第一次装用了 4 分 40 秒。第二次 `pnpm add` 写完锁文件后进程卡住不退出，手动结束后依赖是完整的。

## M1 开工前要定的事

> 后三项已在 M1 定下，第一项（真实缓存命中数值）仍待接真模型。见 [m1-playable.md](m1-playable.md#m0-留下的事这样定了)。

- 第一次接真模型时，跑一次 `real-cache-check.ts`，补上第 3 项的真实缓存命中数值。

- 后台会话挂到游戏会话下面，还是在会话列表里隐藏。
- 后台会话要不要关掉自动起标题。
- 线索板的实时刷新方式。调研建议用「会话投影」（`sessionProjections.register` 配合前端 `useProjection`）；M0 只验证了静态页签，没有验证投影。
