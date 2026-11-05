# 雾港案卷（dsh-casebook）

基于 DeepSeek Harness（DSH）的 AI 推理探案文字游戏。完整方案见 [雾港案卷-项目方案.md](雾港案卷-项目方案.md)。

## 当前进度

M0 可行性验证已完成：五项里四项通过；缓存命中只验证了读取通路，真实数值留到 M1 接真模型时测。结论见 [docs/m0-feasibility.md](docs/m0-feasibility.md)，最小例子在 `spikes/m0/`。

## 环境

- Node 24.9 以上（本机验证用的是 26.7）、pnpm 10
- DSH 锁定 `0.2.1-rc.5`

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm m0:fts5` | 检查 node:sqlite 的 FTS5 中文检索 |
| `pnpm m0:web` | 启动挂着 M0 插件的 DSH Web，默认端口 3180（环境变量 `CASEBOOK_PORT` 可改） |
| `pnpm typecheck` | 类型检查 |

## 数据与密钥

- DSH 的数据目录固定在仓库内的 `.dsh-home/`，已被 git 忽略；不读写用户目录下的 `~/.dsh`。
- 在 Web 界面「设置 → 模型」里保存的 DeepSeek 密钥存在 `.dsh-home/.credentials.yaml`。不要提交，不要外传。
- DSH 处于开发者预览期，会执行模型生成的命令。只在本机使用，不要把端口暴露到局域网或公网。
