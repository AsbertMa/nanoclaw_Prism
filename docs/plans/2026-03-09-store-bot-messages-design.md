# Store Bot Outbound Messages Design

**Date:** 2026-03-09

## Goal

Store every message the bot sends (via main bot or pool bots) into the `messages` DB table, so agents have full conversation history as context — not just user messages.

## Problem

Currently only inbound messages (user → bot) are stored. `getMessagesSince` filters out `is_bot_message=1` rows. Agents have no memory of what they previously said.

## Approach: Channel `onSent` Callback

Add an optional `onSent` callback to the `Channel` interface. Each channel calls it after a successful send. `index.ts` injects the callback, which writes to DB via `saveBotMessage`.

## Architecture

### 1. `src/types.ts` — Channel interface

Add optional field:
```typescript
onSent?: (jid: string, text: string, senderName?: string) => void;
```

### 2. `src/channels/telegram.ts` — Call the callback

In `sendMessage` and `sendPoolMessage`, after successful Telegram API call:
```typescript
this.onSent?.(jid, text);                         // main bot
this.onSent?.(jid, text, sender);                 // pool bot (includes sender name)
```

### 3. `src/db.ts` — saveBotMessage helper

```typescript
export function saveBotMessage(chatJid: string, text: string, senderName: string): void
```
- Generates UUID for id
- Stores: `is_from_me=1`, `is_bot_message=0`, current ISO timestamp
- `sender` = `'bot'`, `sender_name` = senderName

### 4. `src/db.ts` — getMessagesSince update

Add `includeOutbound?: boolean = false` parameter:
```sql
-- when includeOutbound=true, remove the is_bot_message=0 filter
WHERE chat_jid = ? AND timestamp > ?
  AND (is_bot_message = 0 OR is_from_me = 1)
  AND content NOT LIKE ?
```

Also update `getPendingMessages` (used across multiple JIDs) — keep `includeOutbound=false` there always.

### 5. `src/index.ts` — Wire callback + update context query

After channel init, set:
```typescript
channel.onSent = (jid, text, senderName) =>
  saveBotMessage(jid, text, senderName ?? ASSISTANT_NAME);
```

Change context-building call (line ~406):
```typescript
const allPending = getMessagesSince(chatJid, lastAgentTimestamp[chatJid] || '', ASSISTANT_NAME, true);
```

Keep recovery call (line ~449) without `includeOutbound` (defaults false).

## Data Flow

```
Bot sends message
  → channel.sendMessage(jid, text) or sendPoolMessage(...)
  → Telegram API succeeds
  → onSent(jid, text, senderName?)
  → saveBotMessage(chatJid, text, senderName) → DB (is_from_me=1, is_bot_message=0)

Next user message arrives
  → getMessagesSince(chatJid, ts, botPrefix, includeOutbound=true)
  → returns user messages + bot history
  → formatMessages → agent sees full conversation
```

## What Doesn't Change

- `getPendingMessages` — always `includeOutbound=false`, bot messages never trigger new agent runs
- Recovery check — always `includeOutbound=false`
- `formatMessages` — already renders `sender_name`, no changes needed
- Pool bot sender names stored as-is (e.g. `"📡 SMC Monitor"`, `"Researcher"`)

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `onSent?` to Channel interface |
| `src/channels/telegram.ts` | Call `onSent` after each send |
| `src/db.ts` | Add `saveBotMessage`, add `includeOutbound` param to `getMessagesSince` |
| `src/index.ts` | Inject `onSent` callback, pass `includeOutbound=true` for context query |

No schema changes. No new dependencies.
