# NanoClaw Prism (棱镜)

> **Fork of [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)** — forked from upstream v1.2.14 (`fb66428`)

个人定制版 NanoClaw，添加了容器技能、Session 快速恢复等功能。

原项目是一个轻量级 AI 助手平台，让 Claude 代理在独立容器中安全运行。详见 [上游项目](https://github.com/qwibitai/nanoclaw)。

---

## 相比上游的改动

- **持久容器** — 支持 `containerConfig.persistent: true`，容器在消息之间保持存活，开机自启，关机显式停止，崩溃自动重启
- **容器技能** — 新增 `frontend-design`、`skill-creator` 等技能
- **Session 快速恢复** — 改进 session resume 逻辑，支持 `maxResumeMessages` 和 `additionalMounts` 配置
- **Host Bot 脚本** — `scripts/host-bot.ts`，用于本地调试 bot

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
