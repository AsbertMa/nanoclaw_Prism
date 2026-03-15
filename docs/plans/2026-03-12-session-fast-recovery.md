# Session Fast Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep session context while dramatically reducing recovery time from minutes to seconds.

**Architecture:** Three complementary mechanisms: (1) auto-rotate sessions when transcript exceeds a threshold, carrying forward a summary; (2) limit resume depth so only recent messages replay; (3) ensure CLAUDE.md always contains enough context for a fresh session to be useful.

**Tech Stack:** TypeScript (agent-runner in container), SQLite (host session tracking)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `container/agent-runner/src/index.ts` | Modify | Add session rotation logic + resume depth limit |
| `src/container-runner.ts` | Modify | Pass `maxResumeMessages` in container input |
| `src/types.ts` | Modify | Add `maxResumeMessages` to `ContainerConfig` |
| `src/config.ts` | Modify | Add `SESSION_MAX_MESSAGES` default |

---

## Chunk 1: Resume Depth Limit (Scheme 2)

Limit how many messages get replayed when resuming a session. The Claude Agent SDK's `resumeSessionAt` already supports resuming from a specific message UUID. We'll use transcript line count to decide whether to start fresh instead of resuming.

### Task 1: Add maxResumeMessages to ContainerConfig

**Files:**
- Modify: `src/types.ts:30-33`
- Modify: `src/config.ts`

- [ ] **Step 1: Add field to ContainerConfig**

In `src/types.ts`, add `maxResumeMessages` to `ContainerConfig`:

```typescript
export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
  ports?: string[];
  maxResumeMessages?: number; // Max transcript lines before forcing new session (default: 200)
}
```

- [ ] **Step 2: Add default constant to config.ts**

In `src/config.ts`, add:

```typescript
export const SESSION_MAX_MESSAGES = parseInt(
  process.env.SESSION_MAX_MESSAGES || '200',
  10,
);
```

### Task 2: Check transcript size before resuming

**Files:**
- Modify: `container/agent-runner/src/index.ts:493-586` (main function)

The agent-runner receives `sessionId` from the host. Before resuming, check the transcript file size. If it exceeds the limit, discard the session ID and start fresh — but prepend a context summary from the old session.

- [ ] **Step 1: Add transcript size check function**

Add after `generateFallbackName()` (~line 223):

```typescript
const SESSION_MAX_MESSAGES = parseInt(process.env.SESSION_MAX_MESSAGES || '200', 10);

/**
 * Count lines in a session transcript to determine if it's too large to resume.
 */
function getTranscriptLineCount(sessionId: string): number {
  const projectDir = '/home/node/.claude/projects/-workspace-group';
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(transcriptPath)) return 0;
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Extract a brief summary from the last N messages of a transcript.
 */
function extractRecentContext(sessionId: string, maxMessages: number = 10): string {
  const projectDir = '/home/node/.claude/projects/-workspace-group';
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(transcriptPath)) return '';

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const messages = parseTranscript(content);
    if (messages.length === 0) return '';

    // Get session summary if available
    const summary = getSessionSummary(sessionId, transcriptPath);

    // Get last few messages for recent context
    const recent = messages.slice(-maxMessages);
    const recentText = recent
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 200)}`)
      .join('\n');

    let context = '[Previous session context]\n';
    if (summary) context += `Summary: ${summary}\n\n`;
    context += `Recent conversation:\n${recentText}`;
    return context;
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Modify main() to check transcript size before resuming**

In `main()`, after `let sessionId = containerInput.sessionId;` (~line 521), add the rotation logic:

```typescript
  let sessionId = containerInput.sessionId;
  let sessionContext = ''; // Context from rotated session

  // Check if session is too large to resume efficiently
  if (sessionId) {
    const lineCount = getTranscriptLineCount(sessionId);
    if (lineCount > SESSION_MAX_MESSAGES) {
      log(`Session ${sessionId} has ${lineCount} lines (limit: ${SESSION_MAX_MESSAGES}), rotating to new session`);
      sessionContext = extractRecentContext(sessionId);
      sessionId = undefined; // Force new session
    } else {
      log(`Session ${sessionId} has ${lineCount} lines, resuming normally`);
    }
  }
```

- [ ] **Step 3: Prepend context to prompt when session is rotated**

Right after building the initial prompt, prepend the context:

```typescript
  // Build initial prompt
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - ...]\n\n${prompt}`;
  }

  // Prepend context from rotated session
  if (sessionContext) {
    prompt = sessionContext + '\n\n---\n\n' + prompt;
  }
```

### Task 3: Pass SESSION_MAX_MESSAGES via environment

**Files:**
- Modify: `src/container-runner.ts`

- [ ] **Step 1: Pass the config to container environment**

In `buildContainerArgs()`, after the timezone env var, add:

```typescript
  // Pass session max messages config
  const maxMessages = group.containerConfig?.maxResumeMessages || SESSION_MAX_MESSAGES;
  args.push('-e', `SESSION_MAX_MESSAGES=${maxMessages}`);
```

Also add the import of `SESSION_MAX_MESSAGES` from config.ts.

---

## Chunk 2: Auto Session Rotation (Scheme 1)

After each query completes, check if the session has grown too large and proactively rotate.

### Task 4: Rotate session after query completion

**Files:**
- Modify: `container/agent-runner/src/index.ts` (main query loop)

- [ ] **Step 1: Add rotation check in the query loop**

In the `while (true)` loop in `main()`, after `queryResult` is obtained and sessionId is updated, add:

```typescript
      // Check if session should be rotated (proactive, before next message)
      if (sessionId) {
        const lineCount = getTranscriptLineCount(sessionId);
        if (lineCount > SESSION_MAX_MESSAGES) {
          log(`Session ${sessionId} reached ${lineCount} lines, rotating proactively`);
          sessionContext = extractRecentContext(sessionId);
          sessionId = undefined;
          resumeAt = undefined;
        }
      }
```

- [ ] **Step 2: Prepend context when rotated mid-loop**

When building the next prompt from IPC messages, prepend context if rotated:

```typescript
      prompt = nextMessage;
      if (sessionContext) {
        prompt = sessionContext + '\n\n---\n\n' + prompt;
        sessionContext = ''; // Only prepend once
      }
```

---

## Chunk 3: CLAUDE.md Context Enrichment (Scheme 3)

Ensure the agent always has enough context from CLAUDE.md alone to be productive without session history.

### Task 5: Document the pattern in both agents' CLAUDE.md

**Files:**
- Modify: `groups/telegram_main/CLAUDE.md`
- Modify: `groups/telegram_my-assistant/CLAUDE.md`

- [ ] **Step 1: Add session context rule to 棱镜's CLAUDE.md**

Add after the 回复规则 section:

```markdown
## Session 管理

- 你的 session 会定期轮换以保持响应速度。轮换后你可能会丢失之前的对话细节。
- **重要的项目状态、决策、进度必须写在这个 CLAUDE.md 文件里**，不要只靠对话记忆。
- 每次完成一个重要任务后，更新本文件中的「已完成任务记录」和「待办/下一步」部分。
```

- [ ] **Step 2: Add same rule to 饺子's CLAUDE.md**

Add after 允许事项:

```markdown
## Session 管理

- 你的 session 会定期轮换以保持响应速度。
- 重要的信息和待办事项应记录在本文件中，不要只靠对话记忆。
```

---

## Summary

| Scheme | What it does | Where |
|--------|-------------|-------|
| 1. Auto rotation | Session 超过 200 行自动轮换，带 summary 开新 session | agent-runner main loop |
| 2. Resume depth limit | 启动时检查 transcript 大小，过大则不 resume | agent-runner main() |
| 3. CLAUDE.md context | 关键状态写 CLAUDE.md，不依赖 session 历史 | 两个 agent 的 CLAUDE.md |

**预期效果：** Session 恢复从数分钟降到几秒。历史对话通过 conversations/ 归档保留，但不再拖慢启动。
