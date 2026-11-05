# 0011 线索板走插件的 HTTP 路由轮询，不用会话投影

## 背景

M0 的调研建议线索板用 DSH 的会话投影（宿主 `sessionProjections.register`，前端 `props.useProjection`）实时刷新。但投影只能折叠 DSH 会话日志里的事件，而游戏状态的真相源是我们自己的 JSONL 事件日志（ADR 0003），不在会话日志里。

要用投影，就得把游戏状态镜像进 DSH 会话日志。DSH 给插件写会话记录的接口（`appendPluginRecord`）文档写明只供 DSH 仓库内的实验包使用，外部插件不能调用；用注入消息来带数据又会进模型上下文。

## 决定

宿主插件在 DSH 连接层注册三个精确路由（`packages/plugin/src/routes.ts`），鉴权沿用网页已有的 cookie：

- `GET /api/casebook.board?session=<id>`：线索板（L1）。
- `POST /api/casebook.accuse`：指认。
- `POST /api/casebook.retry`：重新结算最新一版。

线索板页签可见时每 1.5 秒拉一次；指认和重试的响应直接带回新的线索板。

## 后果

- 游戏状态只有一份真相，不用在两处同步。
- 本机单用户，轮询的开销可以忽略；页签不可见时不拉。
- 刷新最多晚 1.5 秒。以后如果 DSH 开放了外部插件写会话记录的接口，可以再换回投影。
