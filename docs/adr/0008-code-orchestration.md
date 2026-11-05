# 0008 程序编排，Agent 之间只通过权威状态交换信息

## 背景

可选的组织方式有 LangGraph、DSH 子 Agent 委派、Agent Teams、主管 Agent 路由。比较见项目方案「Agent 组织模式」。

## 决定

由代码决定每个 Agent 什么时候运行，Agent 之间不对话。

- 叙事就是玩家对话的那个 DSH 会话，挂在「雾港案卷」预设里（`packages/plugin/src/narrator.ts`）。
- 书记员是插件用 `ctx.agents.create` 开的后台会话，每局一个，由宿主插件按队列驱动（`packages/plugin/src/runtime.ts`），不把委派工具开放给模型。
- 两者只通过 `Game`（事件日志与由它重放出的状态）交换信息：叙事的正文由程序提交，书记员读到的是程序按状态生成的结算任务，书记员的提议经程序校验后写进日志，叙事下一轮读到的是新状态投影出的资料。
- 领域层（`packages/domain`）不依赖 DSH，可以单测；插件层只负责把 DSH 的轮次生命周期接上去。

## 后果

- 每局一条后台队列，结算串行执行，不会两个结算同时写状态。
- 换掉 DSH 时，领域层可以原样搬到别的 Agent 运行时上。
