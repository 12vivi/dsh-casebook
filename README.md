# 雾港案卷（dsh-casebook）

基于 DeepSeek Harness（DSH）的 AI 推理探案文字游戏。完整方案见 [雾港案卷-项目方案.md](雾港案卷-项目方案.md)。

## 当前进度

- **M0 可行性验证**：完成。五项里四项通过；缓存命中只验证了读取通路，真实数值等接真模型时测。结论见 [docs/m0-feasibility.md](docs/m0-feasibility.md)。
- **M1 能玩**：功能完成，用假模型在网页里从开局玩到结案；领域层 55 条单测全过。还差用真模型由真人破一次案，以及补上 M0 的真实缓存命中数值。见 [docs/m1-playable.md](docs/m1-playable.md)。

## 环境

- Node 24.9 以上（本机验证用的是 26.7）、pnpm 10
- DSH 锁定 `0.2.1-rc.5`

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm web` | 启动挂着游戏插件的 DSH Web，用真模型玩。默认端口 3180（环境变量 `CASEBOOK_PORT` 可改） |
| `pnpm web:fake` | 同上，但默认模型换成不联网的假模型，用来走通流程、调界面 |
| `pnpm test` | 领域层单测 |
| `pnpm stats` | 每局的轮数、结算情况、模型用量和缓存命中率 |
| `pnpm typecheck` | 类型检查 |
| `pnpm m0:web` / `pnpm m0:fts5` | M0 的最小例子 |

启动后用浏览器打开终端里带 `token` 的地址，在左侧工作区「雾港案卷」里新建会话，右侧栏打开「线索板」，点「开始调查」。详细步骤见 [docs/m1-playable.md](docs/m1-playable.md#怎么跑)。

## 目录

| 目录 | 内容 |
|---|---|
| `packages/domain/` | 纯领域逻辑，不依赖 DSH：案卷 schema、事件日志、游戏状态、四道校验、计分、按可见级别投影 |
| `packages/plugin/` | DSH 插件：宿主侧运行时（对局、结算队列、书记员、HTTP 路由）、叙事预设插件、开发用假模型 |
| `packages/client/` | 网页插件：右侧栏「线索板」与指认表单 |
| `cases/` | 案卷包；M1 的案子是 `ebb-tide`「退潮之前」 |
| `prompts/` | 叙事与书记员的系统提示词 |
| `scripts/` | 启动脚本与统计脚本 |
| `docs/` | 里程碑结论与 [ADR](docs/adr/README.md) |

## 数据与密钥

- DSH 的数据目录固定在仓库内的 `.dsh-home/`，已被 git 忽略；不读写用户目录下的 `~/.dsh`。每局的事件日志在 `.dsh-home/casebook/games/`。
- 在 Web 界面「设置 → 模型」里保存的 DeepSeek 密钥存在 `.dsh-home/.credentials.yaml`。不要提交，不要外传。
- DSH 处于开发者预览期，会执行模型生成的命令。只在本机使用，不要把端口暴露到局域网或公网。游戏会话本身不开放任何工具。
