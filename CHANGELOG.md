# Changelog

All notable changes to NanoClaw will be documented in this file.

## [1.3.1] — 2026-03-13

### Performance
- **feat:** Replace all hand-written technical indicator calculations (EMA, RSI, ATR, MACD, BB, OBV) with TA-Lib C library. 50-100x faster signal detection during backtesting.
- **feat:** New shared `core/ta.py` wrapper module — auto-detects TA-Lib availability with pure Python fallback.
- **feat:** TA-Lib C library + Python wrapper added to container Dockerfile.

### Bot Pool
- **feat:** Per-group bot pool isolation (`ContainerConfig.poolTokens`). Groups can specify dedicated Telegram bot tokens; groups without config fall back to global `TELEGRAM_BOT_POOL`.

## [1.3.0] — 2026-03-12

### Session Fast Recovery
- **feat:** Auto-rotate sessions when transcript exceeds configurable line limit (`SESSION_MAX_MESSAGES`, default 200). Extracts summary + last 10 messages as context for the new session, preventing slow resume on bloated transcripts.
- **feat:** Proactive mid-loop rotation — checks transcript size after each query and rotates before the next message arrives.
- **feat:** `maxResumeMessages` in `ContainerConfig` allows per-group override of the rotation threshold.

### Telegram Channel
- **feat:** Add Telegram channel (`src/channels/telegram.ts`) with full support for groups, solo chats, bot commands, and typing indicators.
- **feat:** Telegram Agent Swarm (bot pool) — subagents send messages via dedicated pool bots with auto-renamed display names.
- **feat:** Per-group bot pool isolation (`ContainerConfig.poolTokens`). Groups can specify dedicated pool tokens; groups without config fall back to the global `TELEGRAM_BOT_POOL`.

### IPC Enhancements
- **feat:** Swarm sender routing in IPC — messages from subagents (sender ≠ assistant name) auto-route through bot pool on Telegram.
- **feat:** IPC file sending — containers can send documents/files to chats via `{ type: "file", chatJid, filePath, caption }`.
- **feat:** `sendDocument` added to `Channel` interface and wired through `IpcDeps`.

### Container
- **feat:** New container image tag `nanoclaw-agent:v1.3-fast-recovery-prism`.
- **feat:** Default `CONTAINER_TIMEOUT` increased from 30min to 2h.
- **feat:** Per-group timeout override via `ContainerConfig.timeout`.
- **feat:** Per-group port mappings via `ContainerConfig.ports`.
- **feat:** Python 3 + pip + btc-quant dependencies (numpy, pandas, quantstats, fastapi, uvicorn, pytest) baked into container image.
- **feat:** `fetch-kline` tool installed in container at `/usr/local/bin/fetch-kline`.

### Bug Fixes
- **fix:** `cleanupOrphans()` — avoid `docker ps --filter` hang on macOS 12 by using `--format` only and filtering in JS.

### Skills (new, untracked)
- `container/skills/fetch-kline/` — K-line data fetching tool
- `container/skills/frontend-design/` — Frontend design skill
- `container/skills/skill-creator/` — Skill creation skill

## [1.2.0](https://github.com/qwibitai/nanoclaw/compare/v1.1.6...v1.2.0)

[BREAKING] WhatsApp removed from core, now a skill. Run `/add-whatsapp` to re-add (existing auth/groups preserved).
- **fix:** Prevent scheduled tasks from executing twice when container runtime exceeds poll interval (#138, #669)
