import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context, Markup } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../session/session.service';
import { GroupsService } from '../groups/groups.service';
import { MessagesService } from '../messages/messages.service';
import { ScheduleService } from '../schedule/schedule.service';

type PendingState =
  | { step: 'phone' }
  | { step: 'otp'; phone: string }
  | { step: 'message_content'; type: string }
  | null;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Telegraf;
  private pendingStates = new Map<number, PendingState>();
  private ownerId: number;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly groupsService: GroupsService,
    private readonly messagesService: MessagesService,
    private readonly scheduleService: ScheduleService,
  ) {}

  async onModuleInit() {
    const token = this.config.get<string>('BOT_TOKEN');
    this.ownerId = parseInt(this.config.get<string>('OWNER_ID') ?? '0', 10);

    if (!token) {
      this.logger.warn('BOT_TOKEN not set — bot will not start');
      return;
    }

    // Build proxy agent if configured
    const proxyUrl =
      this.config.get<string>('HTTPS_PROXY') ||
      this.config.get<string>('HTTP_PROXY') ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
    if (proxyUrl) {
      if (proxyUrl.startsWith('socks')) {
        agent = new SocksProxyAgent(proxyUrl);
        this.logger.log(`Using SOCKS proxy: ${proxyUrl}`);
      } else {
        agent = new HttpsProxyAgent(proxyUrl);
        this.logger.log(`Using HTTPS proxy: ${proxyUrl}`);
      }
    }

    this.bot = new Telegraf(token, agent ? { telegram: { agent } } : {});
    this.registerHandlers();

    void this.bot
      .launch()
      .then(() => {
        this.logger.log(`🤖 Bot launched | Owner: ${this.ownerId}`);
      })
      .catch((err: Error) => {
        this.logger.error(
          `Cannot reach Telegram API (${err.message}). ` +
            `If Telegram is blocked on your network, set HTTPS_PROXY in .env or use a VPN, then restart.`,
        );
      });

    const stopBot = () => {
      try {
        this.bot?.stop('SIGTERM');
      } catch {
        /* already stopped */
      }
    };
    process.once('SIGINT', stopBot);
    process.once('SIGTERM', stopBot);
  }

  async onModuleDestroy() {
    try {
      this.bot?.stop('SIGTERM');
    } catch {
      /* ignore */
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private isOwner(ctx: Context): boolean {
    return ctx.from?.id === this.ownerId;
  }

  private async checkOwner(ctx: Context): Promise<boolean> {
    if (!this.isOwner(ctx)) {
      await ctx.reply('⛔ This command is restricted to the bot owner.');
      return false;
    }
    return true;
  }

  private async checkActive(ctx: Context): Promise<boolean> {
    const isActive = await this.authService.isUserActive(ctx.from!.id.toString());
    if (!isActive) {
      await ctx.reply('❌ Your subscription is inactive.\nUse /activate <code> to activate.');
      return false;
    }
    return true;
  }

  // ─── Handler Registration ──────────────────────────────────────────────────

  private registerHandlers() {
    this.registerUserCommands();
    this.registerAdminCommands();
    this.registerTextHandler();
    this.registerPhotoHandler();
    this.bot.catch((err, ctx) => {
      this.logger.error(`Bot error for ${ctx.updateType}:`, err);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  private registerUserCommands() {
    // /start
    this.bot.start(async (ctx) => {
      const { id, username, first_name } = ctx.from!;
      await this.authService.findOrCreateUser(id.toString(), username, first_name);
      const status = await this.authService.getUserStatus(id.toString());

      const isOwner = id === this.ownerId;

      await ctx.replyWithMarkdown(
        `👋 Welcome *${first_name ?? 'there'}*!` +
        (isOwner ? ' 👑 *(Owner)*' : '') +
        `\n\n` +
        `📊 *Status:* ${status.is_active ? '✅ Active' : '❌ Inactive'}\n` +
        (status.subscription_end
          ? `📅 Until: ${new Date(status.subscription_end).toLocaleDateString()}\n`
          : '') +
        `\nUse /help to see all commands.`,
      );
    });

    // /help
    this.bot.help(async (ctx) => {
      const isOwner = ctx.from?.id === this.ownerId;

      let text =
        `*📋 Commands*\n\n` +
        `*Account*\n` +
        `/activate <code> — Activate subscription\n` +
        `/status — View account info\n\n` +
        `*MTProto*\n` +
        `/connect — Link your Telegram account\n` +
        `/disconnect — Unlink session\n` +
        `/session\\_status — Check session\n\n` +
        `*Groups*\n` +
        `/sync\\_groups — Import your groups\n` +
        `/my\\_groups — List groups\n\n` +
        `*Messages*\n` +
        `/add\\_message — Add text or media message\n` +
        `/my\\_messages — List messages\n` +
        `/del\\_message <id> — Delete a message\n\n` +
        `*Schedule*\n` +
        `/set\\_schedule <sec> [global|sequential]\n` +
        `/start\\_schedule — Begin auto-send\n` +
        `/stop\\_schedule — Stop auto-send\n` +
        `/schedule\\_status — Scheduler info`;

      if (isOwner) {
        text +=
          `\n\n*👑 Admin Commands*\n` +
          `/gen\\_code <days> — Generate activation code\n` +
          `/gen\\_codes <days> <count> — Generate multiple codes\n` +
          `/all\\_users — List all registered users\n` +
          `/user\\_info <telegram\\_id> — User details\n` +
          `/ban\\_user <telegram\\_id> — Deactivate a user\n` +
          `/unban\\_user <telegram\\_id> — Reactivate a user\n` +
          `/stats — System statistics`;
      }

      await ctx.replyWithMarkdown(text);
    });

    // /activate
    this.bot.command('activate', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) return ctx.reply('Usage: /activate <code>');
      try {
        const result = await this.authService.activateWithCode(ctx.from!.id.toString(), parts[1].trim());
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /status
    this.bot.command('status', async (ctx) => {
      const status = await this.authService.getUserStatus(ctx.from!.id.toString());
      if (!status.registered) return ctx.reply('Not registered. Send /start first.');

      await ctx.replyWithMarkdown(
        `*📊 Account Status*\n\n` +
        `Active: ${status.is_active ? '✅' : '❌'}\n` +
        `Subscription: ${status.subscription_end ? new Date(status.subscription_end).toLocaleDateString() : 'None'}\n` +
        `Session: ${status.session_status}\n` +
        `Groups: ${status.groups_count}\n` +
        `Messages: ${status.messages_count}`,
      );
    });

    // /connect
    this.bot.command('connect', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'phone' });
      await ctx.reply('📱 Enter your phone number with country code:\nExample: +9647801234567');
    });

    // /disconnect
    this.bot.command('disconnect', async (ctx) => {
      try {
        const result = await this.sessionService.disconnectSession(ctx.from!.id.toString());
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /session_status
    this.bot.command('session_status', async (ctx) => {
      const s = await this.sessionService.getSessionStatus(ctx.from!.id.toString());
      await ctx.reply(`🔌 ${s}`);
    });

    // /sync_groups
    this.bot.command('sync_groups', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      try {
        await ctx.reply('⏳ Syncing groups...');
        const result = await this.groupsService.fetchAndSyncGroups(ctx.from!.id.toString());
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /my_groups
    this.bot.command('my_groups', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      const groups = await this.groupsService.getGroups(ctx.from!.id.toString());
      if (!groups.length) return ctx.reply('No groups yet. Use /sync_groups first.');

      const list = groups
        .map((g, i) => `${i + 1}. ${g.is_active ? '✅' : '❌'} *${g.group_name}*\n   ID: \`${g.group_id}\``)
        .join('\n\n');

      await ctx.replyWithMarkdown(`*📋 Groups (${groups.length}):*\n\n${list}`);
    });

    // /add_message
    this.bot.command('add_message', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'message_content', type: 'text' });
      await ctx.reply(
        '📝 Send your message text now.\nOr send a photo/document with caption for media.',
        Markup.keyboard([['❌ Cancel']]).oneTime().resize(),
      );
    });

    // /my_messages
    this.bot.command('my_messages', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      const messages = await this.messagesService.getMessages(ctx.from!.id.toString());
      if (!messages.length) return ctx.reply('No messages yet. Use /add_message.');

      const list = messages
        .map((m) => `[${m.id}] ${m.type === 'media' ? '🖼' : '📝'} ${(m.content ?? '').substring(0, 50)}`)
        .join('\n');

      await ctx.replyWithMarkdown(`*💬 Messages (${messages.length}):*\n\n\`\`\`\n${list}\n\`\`\``);
    });

    // /del_message
    this.bot.command('del_message', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
        return ctx.reply('Usage: /del_message <id>');
      }
      try {
        const result = await this.messagesService.deleteMessage(ctx.from!.id.toString(), parseInt(parts[1]));
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /set_schedule
    this.bot.command('set_schedule', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
        return ctx.reply(
          'Usage: /set_schedule <seconds> [global|sequential]\n' +
          'Example: /set_schedule 3600 sequential',
        );
      }
      const interval = parseInt(parts[1]);
      const mode = (parts[2] === 'sequential' ? 'sequential' : 'global') as 'global' | 'sequential';
      try {
        await this.scheduleService.createSchedule(ctx.from!.id.toString(), interval, mode);
        await ctx.reply(
          `✅ Schedule set!\n⏱ Every: ${interval}s\n🔄 Mode: ${mode}\n\nRun /start_schedule to begin.`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /start_schedule
    this.bot.command('start_schedule', async (ctx) => {
      if (!(await this.checkActive(ctx))) return;
      try {
        const result = await this.scheduleService.startSchedule(ctx.from!.id.toString());
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /stop_schedule
    this.bot.command('stop_schedule', async (ctx) => {
      try {
        const result = await this.scheduleService.stopSchedule(ctx.from!.id.toString());
        await ctx.reply(result.message);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /schedule_status
    this.bot.command('schedule_status', async (ctx) => {
      const s = await this.scheduleService.getScheduleStatus(ctx.from!.id.toString());
      if (!s.configured) return ctx.reply('No schedule configured. Use /set_schedule first.');
      await ctx.replyWithMarkdown(
        `*⏱ Schedule*\n\n` +
        `Running: ${s.is_running ? '✅' : '❌'}\n` +
        `Interval: ${s.interval}s\n` +
        `Mode: ${s.mode}\n` +
        `Last run: ${s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never'}`,
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN COMMANDS (Owner only)
  // ═══════════════════════════════════════════════════════════════════════════

  private registerAdminCommands() {
    // /gen_code <days>
    this.bot.command('gen_code', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
        return ctx.reply('Usage: /gen_code <days>\nExample: /gen_code 30');
      }
      const days = parseInt(parts[1]);
      try {
        const code = await this.authService.generateActivationCode(days);
        await ctx.replyWithMarkdown(
          `✅ *Activation Code Generated*\n\n` +
          `Code: \`${code}\`\n` +
          `Duration: *${days} days*\n\n` +
          `Share this code with the subscriber.`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /gen_codes <days> <count>
    this.bot.command('gen_codes', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 3 || isNaN(parseInt(parts[1])) || isNaN(parseInt(parts[2]))) {
        return ctx.reply('Usage: /gen_codes <days> <count>\nExample: /gen_codes 30 5');
      }
      const days = parseInt(parts[1]);
      const count = Math.min(parseInt(parts[2]), 20); // max 20 at once
      try {
        const codes: string[] = [];
        for (let i = 0; i < count; i++) {
          codes.push(await this.authService.generateActivationCode(days));
        }
        const list = codes.map((c, i) => `${i + 1}. \`${c}\``).join('\n');
        await ctx.replyWithMarkdown(
          `✅ *${count} Codes Generated (${days} days each)*\n\n${list}`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /all_users
    this.bot.command('all_users', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      try {
        const users = await this.authService.getAllUsers();
        if (!users.length) return ctx.reply('No users yet.');

        const now = new Date();
        const list = users
          .map((u, i) => {
            const active = u.is_active && u.subscription_end && u.subscription_end > now;
            const exp = u.subscription_end ? new Date(u.subscription_end).toLocaleDateString() : 'None';
            return `${i + 1}. ${active ? '✅' : '❌'} *${u.first_name ?? u.username ?? 'N/A'}*\n   ID: \`${u.telegram_id}\` | Until: ${exp}`;
          })
          .join('\n\n');

        await ctx.replyWithMarkdown(`*👥 All Users (${users.length}):*\n\n${list}`);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /user_info <telegram_id>
    this.bot.command('user_info', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) return ctx.reply('Usage: /user_info <telegram_id>');
      try {
        const info = await this.authService.getUserStatus(parts[1].trim());
        if (!info.registered) return ctx.reply('User not found.');
        await ctx.replyWithMarkdown(
          `*👤 User Info*\n\n` +
          `Active: ${info.is_active ? '✅' : '❌'}\n` +
          `Subscription: ${info.subscription_end ? new Date(info.subscription_end).toLocaleDateString() : 'None'}\n` +
          `Session: ${info.session_status}\n` +
          `Groups: ${info.groups_count}\n` +
          `Messages: ${info.messages_count}`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /ban_user <telegram_id>
    this.bot.command('ban_user', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) return ctx.reply('Usage: /ban_user <telegram_id>');
      try {
        await this.authService.setUserActive(parts[1].trim(), false);
        await ctx.reply(`✅ User ${parts[1]} has been deactivated.`);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /unban_user <telegram_id>
    this.bot.command('unban_user', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) return ctx.reply('Usage: /unban_user <telegram_id>');
      try {
        await this.authService.setUserActive(parts[1].trim(), true);
        await ctx.reply(`✅ User ${parts[1]} has been reactivated.`);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // /stats
    this.bot.command('stats', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      try {
        const stats = await this.authService.getSystemStats();
        await ctx.replyWithMarkdown(
          `*📊 System Statistics*\n\n` +
          `👥 Total Users: *${stats.totalUsers}*\n` +
          `✅ Active Subscriptions: *${stats.activeUsers}*\n` +
          `❌ Inactive: *${stats.inactiveUsers}*\n` +
          `🎟 Total Codes: *${stats.totalCodes}*\n` +
          `🔓 Used Codes: *${stats.usedCodes}*\n` +
          `🔒 Unused Codes: *${stats.unusedCodes}*\n` +
          `💬 Total Messages: *${stats.totalMessages}*\n` +
          `👥 Total Groups: *${stats.totalGroups}*`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLERS (multi-step flows)
  // ═══════════════════════════════════════════════════════════════════════════

  private registerTextHandler() {
    this.bot.on('text', async (ctx) => {
      const state = this.pendingStates.get(ctx.from!.id);
      if (!state) return;

      if (ctx.message.text === '❌ Cancel') {
        this.pendingStates.delete(ctx.from!.id);
        return ctx.reply('Cancelled.', Markup.removeKeyboard());
      }

      if (state.step === 'phone') {
        const phone = ctx.message.text.trim();
        try {
          const result = await this.sessionService.connectWithPhone(ctx.from!.id.toString(), phone);
          this.pendingStates.set(ctx.from!.id, { step: 'otp', phone });
          await ctx.reply(result.message, Markup.removeKeyboard());
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`);
        }
        return;
      }

      if (state.step === 'otp') {
        const code = ctx.message.text.trim();
        try {
          const result = await this.sessionService.verifyCode(ctx.from!.id.toString(), code);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(result.message);
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`);
        }
        return;
      }

      if (state.step === 'message_content') {
        try {
          const msg = await this.messagesService.createMessage(ctx.from!.id.toString(), {
            type: 'text',
            content: ctx.message.text,
          });
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`✅ Message saved (ID: ${msg.id})`, Markup.removeKeyboard());
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`);
        }
      }
    });
  }

  private registerPhotoHandler() {
    this.bot.on('photo', async (ctx) => {
      const state = this.pendingStates.get(ctx.from!.id);
      if (!state || state.step !== 'message_content') return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const caption = ctx.message.caption ?? '';
      try {
        const msg = await this.messagesService.createMessage(ctx.from!.id.toString(), {
          type: 'media',
          content: caption,
          file_id: photo.file_id,
        });
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply(`✅ Media message saved (ID: ${msg.id})`, Markup.removeKeyboard());
      } catch (e) {
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });
  }
}
