# NanoClaw Prism (棱镜)

> **Fork of [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)** — forked from upstream v1.2.14 (`fb66428`)

个人定制版 NanoClaw，添加了 Telegram 频道、模型切换、量化交易相关技能等功能。

原项目是一个轻量级 AI 助手平台，让 Claude 代理在独立容器中安全运行。详见 [上游项目](https://github.com/qwibitai/nanoclaw)。

---

## 相比上游的改动

### 新增功能
- **Telegram 频道** — 完整的 Telegram Bot 集成，支持 Agent Swarm（团队模式），每个 subagent 有独立 bot 身份
- **模型切换** — 通过 `CLAUDE_MODEL` 环境变量指定运行模型（如 `claude-opus-4-6`），容器内自动生效
- **容器技能** — 新增 `fetch-kline`（K线数据获取）、`frontend-design`、`skill-creator` 等技能
- **Session 快速恢复** — 改进 session resume 逻辑，支持 `maxResumeMessages` 和 `additionalMounts` 配置
- **Host Bot 脚本** — `scripts/host-bot.ts`，用于本地调试 bot

### 修改的文件
- `container/Dockerfile` — 添加 Python 数据科学依赖（TA-Lib, numpy, pandas）
- `container/agent-runner/src/index.ts` — 支持 `CLAUDE_MODEL` 传递、session resume 改进
- `src/channels/telegram.ts` — Telegram 频道实现（含测试）
- `src/container-runner.ts` — `CLAUDE_MODEL` 环境变量传入容器
- `src/config.ts` — 添加 `TELEGRAM_BOT_POOL`、`TIMEZONE` 等配置
- `src/ipc.ts` — IPC 扩展，支持新的 task 类型
- `src/index.ts` — 注册 Telegram 频道

## 使用

通过触发词（默认 `@Andy`）与助手对话：

```
@Andy 每天早上9点发送销售管线概览
@Andy 每周五检查git历史，有变化就更新README
```

## 环境要求

- macOS (Apple Silicon)
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- Docker

## 架构

```
Channels --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

单 Node.js 进程。频道通过 skill 添加并在启动时自注册。代理在隔离的 Linux 容器中执行，仅挂载目录可访问。按 group 消息队列，支持并发控制，IPC 通过文件系统。

详见 [docs/SPEC.md](docs/SPEC.md)。

## 同步上游

```bash
git remote add upstream https://github.com/qwibitai/nanoclaw.git
git fetch upstream
git rebase upstream/main
```

## License

MIT — 同 [上游项目](https://github.com/qwibitai/nanoclaw)
