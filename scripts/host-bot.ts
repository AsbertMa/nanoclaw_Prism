#!/usr/bin/env tsx
/**
 * Host Agent Bot — @bee_gees_bot
 *
 * Listens for @bee_gees_bot mentions in the Telegram group and runs
 * claude CLI directly on the host (no container). Used for planning,
 * architecture, code review, and tasks requiring host-level access.
 */

import { Bot, InputFile } from 'grammy';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const TOKEN = '8741180570:AAF0KYwpBH3LcdbSgpPyg-o9fpu0f6ynLTw';
const BOT_USERNAME = 'bee_gees_bot';
const CHAT_ID = '-5265670119';
const NANOCLAW_DIR = path.join(import.meta.dirname, '..');
const CLAUDE_BIN = '/Users/bee/.local/bin/claude';
const MAX_MSG_LEN = 4096;

const bot = new Bot(TOKEN);

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sendChunked(chatId: string, text: string, replyToId?: number) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    chunks.push(text.slice(i, i + MAX_MSG_LEN));
  }
  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk, {
      reply_parameters: replyToId ? { message_id: replyToId } : undefined,
    });
  }
}

async function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep',
      prompt,
    ];

    log(`Running claude: ${prompt.slice(0, 80)}...`);

    let stdout = '';
    let stderr = '';

    const env = { ...process.env };
    delete env.CLAUDECODE;  // prevent "nested session" error

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: NANOCLAW_DIR,
      env,
      timeout: 300_000, // 5 min
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      log(`claude exited code=${code}, output=${stdout.length} chars`);
      if (code !== 0 && !stdout.trim()) {
        resolve(`❌ 错误 (code ${code})\n${stderr.slice(0, 500)}`);
      } else {
        resolve(stdout.trim() || '（无输出）');
      }
    });

    proc.on('error', (err) => {
      resolve(`❌ 启动失败: ${err.message}`);
    });
  });
}

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text ?? '';
  const chatId = String(ctx.chat.id);
  const msgId = ctx.message.message_id;

  // Only respond to @mentions or DMs
  const isPrivate = ctx.chat.type === 'private';
  const isMentioned = text.includes(`@${BOT_USERNAME}`);
  if (!isPrivate && !isMentioned) return;

  // Only accept messages from the configured group (or DMs)
  if (!isPrivate && chatId !== CHAT_ID) return;

  const prompt = text.replace(new RegExp(`@${BOT_USERNAME}`, 'g'), '').trim();
  if (!prompt) return;

  log(`Received from ${ctx.from?.username ?? ctx.from?.id}: ${prompt.slice(0, 80)}`);

  // Acknowledge
  const ack = await ctx.reply('⚙️ 思考中...', {
    reply_parameters: { message_id: msgId },
  });

  try {
    const result = await runClaude(prompt);

    // Delete the "thinking" message
    await bot.api.deleteMessage(chatId, ack.message_id).catch(() => {});

    await sendChunked(chatId, result, msgId);
  } catch (err) {
    await bot.api.deleteMessage(chatId, ack.message_id).catch(() => {});
    await ctx.reply(`❌ 出错了: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.catch((err) => {
  log(`Bot error: ${err.message}`);
});

log(`Host agent bot starting (@${BOT_USERNAME})...`);
bot.start({
  onStart: (info) => log(`Bot running: @${info.username} (id=${info.id})`),
});
