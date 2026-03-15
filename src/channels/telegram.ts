import fs from 'fs';
import https from 'https';
import path from 'path';

import { Api, Bot, InputFile } from 'grammy';

import { GROUPS_DIR } from '../config.js';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;
  private ownedJids: Set<string> | null;

  constructor(
    botToken: string,
    opts: TelegramChannelOpts,
    ownedJids?: string[],
  ) {
    this.botToken = botToken;
    this.opts = opts;
    this.ownedJids =
      ownedJids && ownedJids.length > 0 ? new Set(ownedJids) : null;
  }

  async connect(): Promise<void> {
    // Start polling with 409-conflict recovery.
    // Grammy retries 409 with only 50ms delay, flooding Telegram with conflicting
    // requests. We catch the rejection, wait 35s for the previous connection to
    // expire on Telegram's side, then recreate the Bot entirely — calling
    // bot.start() a second time on the same instance doesn't reliably resume.
    const setupAndPoll = (): Promise<void> => {
      const bot = new Bot(this.botToken);
      this.bot = bot;

      // Command to get chat ID (useful for registration)
      bot.command('chatid', (ctx) => {
        const chatId = ctx.chat.id;
        const chatType = ctx.chat.type;
        const chatName =
          chatType === 'private'
            ? ctx.from?.first_name || 'Private'
            : (ctx.chat as any).title || 'Unknown';

        ctx.reply(
          `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
          { parse_mode: 'Markdown' },
        );
      });

      // Command to check bot status
      bot.command('ping', (ctx) => {
        ctx.reply(`${ASSISTANT_NAME} is online.`);
      });

      bot.on('message:text', async (ctx) => {
        // Skip commands
        if (ctx.message.text.startsWith('/')) return;

        const chatJid = `tg:${ctx.chat.id}`;
        let content = ctx.message.text;
        const timestamp = new Date(ctx.message.date * 1000).toISOString();
        const senderName =
          ctx.from?.first_name ||
          ctx.from?.username ||
          ctx.from?.id.toString() ||
          'Unknown';
        const sender = ctx.from?.id.toString() || '';
        const msgId = ctx.message.message_id.toString();

        // Determine chat name
        const chatName =
          ctx.chat.type === 'private'
            ? senderName
            : (ctx.chat as any).title || chatJid;

        // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
        // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
        // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
        const botUsername = ctx.me?.username?.toLowerCase();
        if (botUsername) {
          const entities = ctx.message.entities || [];
          const isBotMentioned = entities.some((entity) => {
            if (entity.type === 'mention') {
              const mentionText = content
                .substring(entity.offset, entity.offset + entity.length)
                .toLowerCase();
              return mentionText === `@${botUsername}`;
            }
            return false;
          });
          if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }

        // Store chat metadata for discovery
        const isGroup =
          ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          chatName,
          'telegram',
          isGroup,
        );

        // Only deliver full message for registered groups
        const group = this.opts.registeredGroups()[chatJid];
        if (!group) {
          logger.debug(
            { chatJid, chatName },
            'Message from unregistered Telegram chat',
          );
          return;
        }

        // If this channel has specific owned JIDs, ignore messages from other chats
        if (this.ownedJids && !this.ownedJids.has(chatJid)) {
          return;
        }

        // Deliver message — startMessageLoop() will pick it up
        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender,
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        logger.info(
          { chatJid, chatName, sender: senderName },
          'Telegram message stored',
        );
      });

      // Download a Telegram file to the group's uploads directory
      const downloadFile = async (
        fileId: string,
        folder: string,
        filename: string,
      ): Promise<string | null> => {
        try {
          const uploadsDir = path.join(GROUPS_DIR, folder, 'uploads');
          fs.mkdirSync(uploadsDir, { recursive: true });
          const tgFile = await bot.api.getFile(fileId);
          if (!tgFile.file_path) return null;
          const url = `https://api.telegram.org/file/bot${this.botToken}/${tgFile.file_path}`;
          const destPath = path.join(uploadsDir, filename);
          await new Promise<void>((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            https
              .get(url, (res) => {
                res.pipe(file);
                file.on('finish', () => {
                  file.close();
                  resolve();
                });
              })
              .on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
              });
          });
          logger.info({ folder, filename }, 'Telegram file downloaded');
          return `uploads/${filename}`;
        } catch (err) {
          logger.error(
            { fileId, filename, err },
            'Failed to download Telegram file',
          );
          return null;
        }
      };

      // Handle non-text messages — download files when possible
      const storeWithFile = async (
        ctx: any,
        fileId: string | null,
        filename: string,
        label: string,
      ) => {
        const chatJid = `tg:${ctx.chat.id}`;
        const group = this.opts.registeredGroups()[chatJid];
        if (!group) return;
        if (this.ownedJids && !this.ownedJids.has(chatJid)) return;

        const timestamp = new Date(ctx.message.date * 1000).toISOString();
        const senderName =
          ctx.from?.first_name ||
          ctx.from?.username ||
          ctx.from?.id?.toString() ||
          'Unknown';
        const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

        const isGroup =
          ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          undefined,
          'telegram',
          isGroup,
        );

        let content: string;
        if (fileId) {
          const localPath = await downloadFile(fileId, group.folder, filename);
          content = localPath
            ? `[${label}: ${filename} saved at ${localPath}]${caption}`
            : `[${label}: ${filename}]${caption}`;
        } else {
          content = `[${label}]${caption}`;
        }

        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });
      };

      const storeNonText = (ctx: any, placeholder: string) =>
        storeWithFile(ctx, null, '', placeholder.replace(/^\[|\]$/g, ''));

      bot.on('message:photo', (ctx) => {
        const photos = ctx.message.photo;
        const largest = photos?.[photos.length - 1];
        const fileId = largest?.file_id || null;
        storeWithFile(
          ctx,
          fileId,
          `photo_${ctx.message.message_id}.jpg`,
          'Photo',
        );
      });
      bot.on('message:video', (ctx) => {
        const fileId = ctx.message.video?.file_id || null;
        const name =
          ctx.message.video?.file_name || `video_${ctx.message.message_id}.mp4`;
        storeWithFile(ctx, fileId, name, 'Video');
      });
      bot.on('message:voice', (ctx) => {
        const fileId = ctx.message.voice?.file_id || null;
        storeWithFile(
          ctx,
          fileId,
          `voice_${ctx.message.message_id}.ogg`,
          'Voice message',
        );
      });
      bot.on('message:audio', (ctx) => {
        const fileId = ctx.message.audio?.file_id || null;
        const name =
          ctx.message.audio?.file_name || `audio_${ctx.message.message_id}.mp3`;
        storeWithFile(ctx, fileId, name, 'Audio');
      });
      bot.on('message:document', (ctx) => {
        const fileId = ctx.message.document?.file_id || null;
        const name =
          ctx.message.document?.file_name || `file_${ctx.message.message_id}`;
        storeWithFile(ctx, fileId, name, 'Document');
      });
      bot.on('message:sticker', (ctx) => {
        const emoji = ctx.message.sticker?.emoji || '';
        storeNonText(ctx, `[Sticker ${emoji}]`);
      });
      bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
      bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

      // Handle errors gracefully
      bot.catch((err) => {
        logger.error({ err: err.message }, 'Telegram bot error');
      });

      return bot
        .start({
          onStart: (botInfo) => {
            logger.info(
              { username: botInfo.username, id: botInfo.id },
              'Telegram bot connected',
            );
            console.log(`\n  Telegram bot: @${botInfo.username}`);
            console.log(
              `  Send /chatid to the bot to get a chat's registration ID\n`,
            );
          },
        })
        .catch(async (err) => {
          if (err?.error_code === 409) {
            logger.warn(
              'Telegram 409 conflict, waiting 35s before retrying...',
            );
            await new Promise((r) => setTimeout(r, 35000));
            return setupAndPoll();
          }
          logger.error({ err }, 'Telegram polling stopped');
        });
    };

    // Resolve connect() immediately — polling runs in background
    setupAndPoll();
    return Promise.resolve();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');

      // Telegram has a 4096 character limit per message — split if needed
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(
            numericId,
            text.slice(i, i + MAX_LENGTH),
          );
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    if (this.ownedJids) return this.ownedJids.has(jid);
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendDocument(numericId, new InputFile(filePath), {
        caption,
      });
      logger.info({ jid, filePath }, 'Telegram document sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Telegram document');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}

// Bot pool for agent teams: send-only Api instances (no polling)
// Global pool (from TELEGRAM_BOT_POOL env) — used as fallback when group has no dedicated pool
const globalPoolApis: Api[] = [];
// Per-group pools (from containerConfig.poolTokens) — keyed by groupFolder
const groupPoolApis = new Map<string, Api[]>();
// Maps "{groupFolder}:{senderName}" → pool Api index for stable assignment within that pool
const senderBotMap = new Map<string, number>();
// Per-pool round-robin counters — keyed by groupFolder or "__global__"
const nextPoolIndex = new Map<string, number>();

async function initApis(tokens: string[], label: string): Promise<Api[]> {
  const apis: Api[] = [];
  for (const token of tokens) {
    try {
      const api = new Api(token);
      const me = await api.getMe();
      apis.push(api);
      logger.info(
        { username: me.username, id: me.id, label, poolSize: apis.length },
        'Pool bot initialized',
      );
    } catch (err) {
      logger.error({ err, label }, 'Failed to initialize pool bot');
    }
  }
  return apis;
}

export async function initBotPool(tokens: string[]): Promise<void> {
  const apis = await initApis(tokens, 'global');
  globalPoolApis.push(...apis);
  if (globalPoolApis.length > 0) {
    logger.info({ count: globalPoolApis.length }, 'Global bot pool ready');
  }
}

export async function initGroupBotPool(
  groupFolder: string,
  tokens: string[],
): Promise<void> {
  const apis = await initApis(tokens, groupFolder);
  if (apis.length > 0) {
    groupPoolApis.set(groupFolder, apis);
    logger.info({ groupFolder, count: apis.length }, 'Group bot pool ready');
  }
}

export async function sendPoolMessage(
  chatId: string,
  text: string,
  sender: string,
  groupFolder: string,
  fallback?: (chatId: string, text: string) => Promise<void>,
): Promise<void> {
  // Use group-specific pool if available, otherwise fall back to global
  const pool = groupPoolApis.get(groupFolder) ?? globalPoolApis;
  const poolKey = groupPoolApis.has(groupFolder) ? groupFolder : '__global__';

  if (pool.length === 0) {
    if (fallback) await fallback(chatId, text);
    return;
  }

  const key = `${groupFolder}:${sender}`;
  let idx = senderBotMap.get(key);
  if (idx === undefined) {
    const counter = nextPoolIndex.get(poolKey) ?? 0;
    idx = counter % pool.length;
    nextPoolIndex.set(poolKey, counter + 1);
    senderBotMap.set(key, idx);
    try {
      await pool[idx].setMyName(sender);
      await new Promise((r) => setTimeout(r, 2000));
      logger.info(
        { sender, groupFolder, poolKey, poolIndex: idx },
        'Assigned and renamed pool bot',
      );
    } catch (err) {
      logger.warn(
        { sender, err },
        'Failed to rename pool bot (sending anyway)',
      );
    }
  }

  const api = pool[idx];
  try {
    const numericId = chatId.replace(/^tg:/, '');
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
      await api.sendMessage(numericId, text);
    } else {
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        await api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
      }
    }
    logger.info(
      { chatId, sender, poolIndex: idx, length: text.length },
      'Pool message sent',
    );
  } catch (err) {
    logger.error({ chatId, sender, err }, 'Failed to send pool message');
  }
}

registerChannel('telegram', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT2_JIDS']);
  const token =
    process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Telegram: TELEGRAM_BOT_TOKEN not set');
    return null;
  }
  // Exclude JIDs owned by dedicated secondary bots
  const bot2JidsRaw =
    process.env.TELEGRAM_BOT2_JIDS || envVars.TELEGRAM_BOT2_JIDS || '';
  const excludedJids = bot2JidsRaw
    .split(',')
    .map((j) => j.trim())
    .filter(Boolean);
  const channel = new TelegramChannel(token, opts);
  if (excludedJids.length > 0) {
    const excluded = new Set(excludedJids);
    channel.ownsJid = (jid: string) =>
      jid.startsWith('tg:') && !excluded.has(jid);
  }
  return channel;
});

registerChannel('telegram2', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['TELEGRAM_BOT2_TOKEN', 'TELEGRAM_BOT2_JIDS']);
  const token =
    process.env.TELEGRAM_BOT2_TOKEN || envVars.TELEGRAM_BOT2_TOKEN || '';
  const jidsRaw =
    process.env.TELEGRAM_BOT2_JIDS || envVars.TELEGRAM_BOT2_JIDS || '';
  if (!token || !jidsRaw) return null;
  const jids = jidsRaw
    .split(',')
    .map((j) => j.trim())
    .filter(Boolean);
  logger.info({ jids }, 'Telegram bot2 channel created');
  return new TelegramChannel(token, opts, jids);
});
