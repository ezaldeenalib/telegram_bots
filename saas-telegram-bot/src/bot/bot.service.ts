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
  | { step: 'message_content' }
  | { step: 'activate_code' }
  | { step: 'set_schedule_interval' }
  | { step: 'session_string' }
  | { step: 'group_id_input' }
  | { step: 'admin_gen_code' }
  | { step: 'admin_gen_codes' }
  | { step: 'admin_user_info' }
  | { step: 'admin_ban' }
  | { step: 'admin_unban' }
  | null;

// ─── Inline Keyboards ───────────────────────────────────────────────────────

const MAIN_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 حالة حسابي', 'status'),
    Markup.button.callback('🔑 تفعيل الاشتراك', 'activate'),
  ],
  [Markup.button.callback('📲 إدارة الجلسات', 'menu_sessions')],
  [
    Markup.button.callback('👥 المجموعات', 'menu_groups'),
    Markup.button.callback('💬 الرسائل', 'menu_messages'),
  ],
  [Markup.button.callback('⏱ جدول الإرسال', 'menu_schedule')],
]);

const SESSIONS_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ إضافة جلسة (Session String)', 'add_session_string'),
    Markup.button.callback('📱 ربط برقم الهاتف', 'connect'),
  ],
  [
    Markup.button.callback('📋 جلساتي', 'my_sessions'),
    Markup.button.callback('🔌 فصل الكل', 'disconnect'),
  ],
  [Markup.button.callback('🔙 رجوع', 'main_menu')],
]);

const ADMIN_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('📊 إحصائيات النظام', 'admin_stats'),
    Markup.button.callback('👥 جميع المستخدمين', 'admin_all_users'),
  ],
  [
    Markup.button.callback('🎟 توليد كود واحد', 'admin_gen_code'),
    Markup.button.callback('🎟🎟 توليد عدة أكواد', 'admin_gen_codes'),
  ],
  [
    Markup.button.callback('✅ تفعيل مستخدم', 'admin_unban'),
    Markup.button.callback('🚫 إيقاف مستخدم', 'admin_ban'),
  ],
  [Markup.button.callback('🔍 بيانات مستخدم', 'admin_user_info')],
  [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
]);

const GROUPS_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('🔄 استيراد المجموعات', 'sync_groups'),
    Markup.button.callback('📋 قائمة مجموعاتي', 'my_groups'),
  ],
  [Markup.button.callback('➕ إضافة مجموعة بالمعرف (ID)', 'add_group_by_id')],
  [Markup.button.callback('🔙 رجوع', 'main_menu')],
]);

const MESSAGES_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ إضافة رسالة', 'add_message'),
    Markup.button.callback('📋 رسائلي', 'my_messages'),
  ],
  [Markup.button.callback('🔙 رجوع', 'main_menu')],
]);

const SCHEDULE_MENU = Markup.inlineKeyboard([
  [
    Markup.button.callback('⚙️ ضبط الجدول', 'set_schedule'),
    Markup.button.callback('📊 حالة الجدول', 'schedule_status'),
  ],
  [
    Markup.button.callback('▶️ تشغيل الإرسال', 'start_schedule'),
    Markup.button.callback('⏹ إيقاف الإرسال', 'stop_schedule'),
  ],
  [Markup.button.callback('🔙 رجوع', 'main_menu')],
]);

const CANCEL_KB = Markup.keyboard([['❌ إلغاء']]).oneTime().resize();

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Telegraf;
  private pendingStates = new Map<number, PendingState>();
  private ownerId: number;
  /** Telegraf `handlerTimeout` (ms) — stored for logging in catch */
  private handlerTimeoutMs = 600_000;

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

    const proxyUrl =
      this.config.get<string>('HTTPS_PROXY') ||
      this.config.get<string>('HTTP_PROXY') ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY;

    let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
    if (proxyUrl) {
      agent = proxyUrl.startsWith('socks')
        ? new SocksProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl);
      this.logger.log(`Using proxy: ${proxyUrl}`);
    }

    // MTProto (dialogs, getEntity, connect) can exceed Telegraf default 90s
    const parsedTimeout = parseInt(
      this.config.get<string>('BOT_HANDLER_TIMEOUT_MS') ?? '600000',
      10,
    );
    this.handlerTimeoutMs =
      Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 600_000;

    this.bot = new Telegraf(token, {
      handlerTimeout: this.handlerTimeoutMs,
      ...(agent ? { telegram: { agent } } : {}),
    });
    this.registerHandlers();

    void this.bot.launch()
      .then(() => this.logger.log(`🤖 البوت يعمل | المالك: ${this.ownerId}`))
      .catch((err: Error) =>
        this.logger.error(
          `تعذّر الاتصال بـ Telegram API: ${err.message}. ` +
          'تأكد من الاتصال بالإنترنت أو استخدم VPN.',
        ),
      );

    const stop = () => { try { this.bot?.stop('SIGTERM'); } catch { /* */ } };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }

  async onModuleDestroy() {
    try { this.bot?.stop('SIGTERM'); } catch { /* */ }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private isOwner(ctx: Context) { return ctx.from?.id === this.ownerId; }

  private async checkOwner(ctx: Context): Promise<boolean> {
    if (!this.isOwner(ctx)) {
      await this.answerCbSafe(ctx, '⛔ هذا الأمر للمالك فقط');
      await ctx.reply('⛔ هذا الأمر مخصص للمالك فقط.');
      return false;
    }
    return true;
  }

  private async checkActive(ctx: Context): Promise<boolean> {
    const active = await this.authService.isUserActive(ctx.from!.id.toString());
    if (!active) {
      const msg = '❌ اشتراكك غير مفعّل.\nاضغط على زر *تفعيل الاشتراك* أو أرسل:\n`/activate <الكود>`';
      await ctx.replyWithMarkdown(msg);
      return false;
    }
    return true;
  }

  private tid(ctx: Context) { return ctx.from!.id.toString(); }

  /** Plain-text bot errors — avoid Telegram Markdown parse failures */
  private errText(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  /** Telegram rejects answerCallbackQuery if the user tapped an old button (>~1 min) or after bot restart */
  private isStaleCallbackError(err: unknown): boolean {
    const desc =
      err && typeof err === 'object' && 'response' in err
        ? String((err as { response?: { description?: string } }).response?.description ?? '')
        : '';
    const d = desc.toLowerCase();
    return (
      d.includes('too old') ||
      d.includes('query id is invalid') ||
      d.includes('response timeout expired')
    );
  }

  /** Always call for callback_query handlers — never throw on expired query */
  private async answerCbSafe(ctx: Context, text?: string): Promise<void> {
    if (!ctx.callbackQuery) return;
    try {
      await ctx.answerCbQuery(text);
    } catch (err) {
      if (this.isStaleCallbackError(err)) return;
      throw err;
    }
  }

  private async safeEdit(ctx: Context, text: string, extra?: object) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra } as any);
    } catch {
      await ctx.replyWithMarkdown(text, extra);
    }
  }

  // ─── Handler Registration ──────────────────────────────────────────────────

  private registerHandlers() {
    this.registerStartHelp();
    this.registerCallbacks();
    this.registerCommands();
    this.registerTextHandler();
    this.registerPhotoHandler();
    this.bot.catch((err, ctx) => {
      if (this.isStaleCallbackError(err)) return;
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError') {
        this.logger.warn(
          `Bot handler timed out (${ctx.updateType}). ` +
            `Increase BOT_HANDLER_TIMEOUT_MS if needed (current: ${this.handlerTimeoutMs}ms).`,
        );
        return;
      }
      this.logger.error(`Bot error ${ctx.updateType}:`, err);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // /start & /help
  // ═══════════════════════════════════════════════════════════════════════════

  private registerStartHelp() {
    this.bot.start(async (ctx) => {
      const { id, username, first_name } = ctx.from!;
      await this.authService.findOrCreateUser(id.toString(), username, first_name);
      const status = await this.authService.getUserStatus(id.toString());
      const owner = id === this.ownerId;

      const greeting =
        `👋 أهلاً *${first_name ?? 'بك'}*${owner ? ' 👑' : ''}!\n\n` +
        `📊 *الحالة:* ${status.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
        (status.subscription_end
          ? `📅 *ينتهي:* ${new Date(status.subscription_end).toLocaleDateString('ar-IQ')}\n`
          : '') +
        `\nاختر من القائمة أدناه:`;

      const kb = owner
        ? Markup.inlineKeyboard([
            ...MAIN_MENU.reply_markup.inline_keyboard,
            [Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')],
          ])
        : MAIN_MENU;

      await ctx.replyWithMarkdown(greeting, kb);
    });

    this.bot.help(async (ctx) => {
      await ctx.replyWithMarkdown(
        `*📋 القائمة الرئيسية*\n\nاضغط على الأزرار أدناه للتنقل بين الأقسام.`,
        MAIN_MENU,
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE CALLBACKS
  // ═══════════════════════════════════════════════════════════════════════════

  private registerCallbacks() {
    // ─── Navigation ──────────────────────────────────────────────────────────
    this.bot.action('main_menu', async (ctx) => {
      await this.answerCbSafe(ctx);
      const owner = ctx.from?.id === this.ownerId;
      const kb = owner
        ? Markup.inlineKeyboard([
            ...MAIN_MENU.reply_markup.inline_keyboard,
            [Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')],
          ])
        : MAIN_MENU;
      await this.safeEdit(ctx, '🏠 *القائمة الرئيسية*\n\nاختر قسماً:', kb);
    });

    this.bot.action('menu_sessions', async (ctx) => {
      await this.answerCbSafe(ctx);
      await this.safeEdit(ctx, '📲 *إدارة الجلسات*\n\nيمكنك ربط حسابك عبر رقم الهاتف أو عبر Session String مباشرةً:', SESSIONS_MENU);
    });

    this.bot.action('menu_groups', async (ctx) => {
      await this.answerCbSafe(ctx);
      await this.safeEdit(ctx, '👥 *إدارة المجموعات*\n\nاختر العملية المطلوبة:', GROUPS_MENU);
    });

    this.bot.action('menu_messages', async (ctx) => {
      await this.answerCbSafe(ctx);
      await this.safeEdit(ctx, '💬 *إدارة الرسائل*\n\nاختر العملية المطلوبة:', MESSAGES_MENU);
    });

    this.bot.action('menu_schedule', async (ctx) => {
      await this.answerCbSafe(ctx);
      await this.safeEdit(ctx, '⏱ *جدول الإرسال التلقائي*\n\nاختر العملية المطلوبة:', SCHEDULE_MENU);
    });

    this.bot.action('admin_panel', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      await this.safeEdit(ctx, '👑 *لوحة الإدارة*\n\nاختر العملية:', ADMIN_MENU);
    });

    // ─── Account ─────────────────────────────────────────────────────────────
    this.bot.action('status', async (ctx) => {
      await this.answerCbSafe(ctx);
      const s = await this.authService.getUserStatus(this.tid(ctx));
      if (!s.registered) { await ctx.reply('❌ لم تسجّل بعد. أرسل /start'); return; }
      const text =
        `*📊 حالة الحساب*\n\n` +
        `الحالة: ${s.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
        `الاشتراك: ${s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
        `الجلسة: ${s.session_status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}\n` +
        `المجموعات: ${s.groups_count}\n` +
        `الرسائل: ${s.messages_count}`;
      await this.safeEdit(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'main_menu')]]));
    });

    this.bot.action('activate', async (ctx) => {
      await this.answerCbSafe(ctx);
      this.pendingStates.set(ctx.from!.id, { step: 'activate_code' });
      await ctx.reply('🔑 أرسل كود التفعيل الآن:', CANCEL_KB);
    });

    this.bot.action('connect', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'phone' });
      await ctx.reply('📱 أرسل رقم هاتفك مع رمز الدولة:\nمثال: +9647801234567', CANCEL_KB);
    });

    // OTP result redirects back to sessions menu
    // (handled in text handler - phone/otp steps)

    this.bot.action('disconnect', async (ctx) => {
      await this.answerCbSafe(ctx);
      try {
        const r = await this.sessionService.disconnectSession(this.tid(ctx));
        await ctx.reply(r.message, SESSIONS_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // ─── Session String ───────────────────────────────────────────────────────

    this.bot.action('add_session_string', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'session_string' });
      await ctx.replyWithMarkdown(
        `➕ *إضافة Session String*\n\n` +
        `أرسل Session String الخاصة بحسابك.\n\n` +
        `📌 *كيف تحصل عليها؟*\n` +
        `باستخدام Telethon أو GramJS يمكنك توليدها هكذا:\n` +
        `\`\`\`python\nfrom telethon.sync import TelegramClient\n` +
        `from telethon.sessions import StringSession\n` +
        `with TelegramClient(StringSession(), api_id, api_hash) as c:\n` +
        `    print(c.session.save())\n\`\`\`\n\n` +
        `⚠️ *لا تشارك هذه الجلسة مع أحد!*`,
        CANCEL_KB,
      );
    });

    this.bot.action('my_sessions', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      const sessions = await this.sessionService.listSessions(this.tid(ctx));
      if (!sessions.length) {
        await ctx.reply('لا توجد جلسات مسجلة. اضغط *إضافة جلسة* لإضافة واحدة.', SESSIONS_MENU);
        return;
      }

      const list = sessions
        .map(
          (s, i) =>
            `${i + 1}. ${s.status === 'connected' ? '🟢' : '🔴'} *${s.label}*\n` +
            `   ${s.account_name ? `👤 ${s.account_name}` : ''}${s.phone ? ` 📱 ${s.phone}` : ''}\n` +
            `   المصدر: ${s.source === 'string' ? '📋 Session String' : '📱 رقم الهاتف'}`,
        )
        .join('\n\n');

      type BtnRowS = ReturnType<typeof Markup.button.callback>[];
      const delBtns: BtnRowS = sessions.map((s) =>
        Markup.button.callback(`🗑 حذف: ${s.label}`, `del_session_${s.id}`),
      );
      const delRows: BtnRowS[] = [];
      for (let i = 0; i < delBtns.length; i++) delRows.push([delBtns[i]]);
      delRows.push([Markup.button.callback('🔙 رجوع', 'menu_sessions')]);

      await ctx.replyWithMarkdown(
        `*📋 جلساتك (${sessions.length}):*\n\n${list}`,
        Markup.inlineKeyboard(delRows),
      );
    });

    this.bot.action(/^del_session_(\d+)$/, async (ctx) => {
      await this.answerCbSafe(ctx);
      const sessionId = parseInt((ctx.match as RegExpMatchArray)[1]);
      try {
        const r = await this.sessionService.deleteSession(this.tid(ctx), sessionId);
        await ctx.reply(r.message, SESSIONS_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // ─── Groups ──────────────────────────────────────────────────────────────
    this.bot.action('sync_groups', async (ctx) => {
      await this.answerCbSafe(ctx, '⏳ جاري الاستيراد...');
      if (!(await this.checkActive(ctx))) return;
      try {
        await ctx.reply('⏳ جاري استيراد مجموعاتك...');
        const r = await this.groupsService.fetchAndSyncGroups(this.tid(ctx));
        await ctx.reply(`✅ ${r.message}`, GROUPS_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`, GROUPS_MENU);
      }
    });

    this.bot.action('my_groups', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      const groups = await this.groupsService.getGroups(this.tid(ctx));
      if (!groups.length) {
        await ctx.reply('لا توجد مجموعات. استوردها أو أضف واحدة بالمعرف.', GROUPS_MENU);
        return;
      }
      const list = groups
        .map((g, i) => `${i + 1}. ${g.is_active ? '✅' : '❌'} ${g.group_name} (ID: ${g.group_id})`)
        .join('\n');
      await ctx.reply(`📋 مجموعاتك (${groups.length}):\n\n${list}`, GROUPS_MENU);
    });

    this.bot.action('add_group_by_id', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'group_id_input' });
      await ctx.reply(
        '➕ إضافة مجموعة بالمعرف\n\n' +
          'أرسل أحد التالي:\n' +
          '• معرف المجموعة مثل: -1001234567890\n' +
          '• أو اسم المستخدم: @groupusername\n\n' +
          '⚠️ يجب أن يكون حسابك المربوط عضوًا في هذه المجموعة.',
        CANCEL_KB,
      );
    });

    // ─── Messages ────────────────────────────────────────────────────────────
    this.bot.action('add_message', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'message_content' });
      await ctx.reply('📝 أرسل نص الرسالة الآن.\nأو أرسل صورة مع تعليق للرسالة الإعلامية:', CANCEL_KB);
    });

    this.bot.action('my_messages', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      const msgs = await this.messagesService.getMessages(this.tid(ctx));
      if (!msgs.length) {
        await ctx.reply('لا توجد رسائل بعد. اضغط *إضافة رسالة*.', MESSAGES_MENU);
        return;
      }
      const list = msgs
        .map((m) => `[${m.id}] ${m.type === 'media' ? '🖼' : '📝'} ${(m.content ?? '').substring(0, 50)}`)
        .join('\n');

      // Build delete buttons (up to 5 rows of 2)
      type BtnRow = ReturnType<typeof Markup.button.callback>[];
      const delButtons: BtnRow = msgs.slice(0, 10).map((m) =>
        Markup.button.callback(`🗑 حذف [${m.id}]`, `del_msg_${m.id}`),
      );
      const rows: BtnRow[] = [];
      for (let i = 0; i < delButtons.length; i += 2) {
        rows.push(delButtons.slice(i, i + 2));
      }
      rows.push([Markup.button.callback('🔙 رجوع', 'menu_messages')]);

      await ctx.replyWithMarkdown(
        `*💬 رسائلك (${msgs.length}):*\n\n\`\`\`\n${list}\n\`\`\``,
        Markup.inlineKeyboard(rows),
      );
    });

    // Dynamic del_msg_* callback
    this.bot.action(/^del_msg_(\d+)$/, async (ctx) => {
      await this.answerCbSafe(ctx);
      const msgId = parseInt((ctx.match as RegExpMatchArray)[1]);
      try {
        await this.messagesService.deleteMessage(this.tid(ctx), msgId);
        await ctx.reply(`✅ تم حذف الرسالة [${msgId}]`, MESSAGES_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    // ─── Schedule ─────────────────────────────────────────────────────────────
    this.bot.action('set_schedule', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'set_schedule_interval' });
      await ctx.reply(
        '⚙️ أرسل الإعداد بالصيغة التالية:\n`<ثواني> <global|sequential>`\n\nمثال:\n`3600 sequential` — كل ساعة بالتتابع\n`1800 global` — كل نصف ساعة للجميع',
        CANCEL_KB,
      );
    });

    this.bot.action('schedule_status', async (ctx) => {
      await this.answerCbSafe(ctx);
      const s = await this.scheduleService.getScheduleStatus(this.tid(ctx));
      if (!s.configured) {
        await ctx.reply('لم يُضبط جدول بعد. اضغط *ضبط الجدول*.', SCHEDULE_MENU);
        return;
      }
      await ctx.replyWithMarkdown(
        `*⏱ حالة الجدول*\n\n` +
        `التشغيل: ${s.is_running ? '✅ يعمل' : '❌ متوقف'}\n` +
        `الفترة: كل ${s.interval} ثانية\n` +
        `الوضع: ${s.mode === 'sequential' ? '🔁 تتابعي' : '📢 للجميع'}\n` +
        `آخر إرسال: ${s.last_run_at ? new Date(s.last_run_at).toLocaleString('ar-IQ') : 'لا يوجد'}`,
        SCHEDULE_MENU,
      );
    });

    this.bot.action('start_schedule', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkActive(ctx))) return;
      try {
        const r = await this.scheduleService.startSchedule(this.tid(ctx));
        await ctx.reply(`▶️ ${r.message}`, SCHEDULE_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`, SCHEDULE_MENU);
      }
    });

    this.bot.action('stop_schedule', async (ctx) => {
      await this.answerCbSafe(ctx);
      try {
        const r = await this.scheduleService.stopSchedule(this.tid(ctx));
        await ctx.reply(`⏹ ${r.message}`, SCHEDULE_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`, SCHEDULE_MENU);
      }
    });

    // ─── Admin callbacks ──────────────────────────────────────────────────────
    this.bot.action('admin_stats', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      const s = await this.authService.getSystemStats();
      await ctx.replyWithMarkdown(
        `*📊 إحصائيات النظام*\n\n` +
        `👥 إجمالي المستخدمين: *${s.totalUsers}*\n` +
        `✅ اشتراكات نشطة: *${s.activeUsers}*\n` +
        `❌ غير نشط: *${s.inactiveUsers}*\n` +
        `🎟 إجمالي الأكواد: *${s.totalCodes}*\n` +
        `🔓 مستخدمة: *${s.usedCodes}*\n` +
        `🔒 متبقية: *${s.unusedCodes}*\n` +
        `💬 الرسائل: *${s.totalMessages}*\n` +
        `👥 المجموعات: *${s.totalGroups}*`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 لوحة الإدارة', 'admin_panel')]]),
      );
    });

    this.bot.action('admin_all_users', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      const users = await this.authService.getAllUsers();
      if (!users.length) { await ctx.reply('لا يوجد مستخدمون بعد.'); return; }
      const now = new Date();
      const list = users.map((u, i) => {
        const active = u.is_active && u.subscription_end && u.subscription_end > now;
        const exp = u.subscription_end ? new Date(u.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد';
        return `${i + 1}. ${active ? '✅' : '❌'} *${u.first_name ?? u.username ?? 'N/A'}*\n   🆔 \`${u.telegram_id}\` | ينتهي: ${exp}`;
      }).join('\n\n');
      await ctx.replyWithMarkdown(
        `*👥 المستخدمون (${users.length}):*\n\n${list}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 لوحة الإدارة', 'admin_panel')]]),
      );
    });

    this.bot.action('admin_gen_code', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'admin_gen_code' });
      await ctx.reply('🎟 أرسل عدد أيام الاشتراك:\nمثال: `30`', CANCEL_KB);
    });

    this.bot.action('admin_gen_codes', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'admin_gen_codes' });
      await ctx.reply('🎟🎟 أرسل عدد الأيام والكمية:\nمثال: `30 5` (30 يوماً، 5 أكواد)', CANCEL_KB);
    });

    this.bot.action('admin_user_info', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'admin_user_info' });
      await ctx.reply('🔍 أرسل Telegram ID للمستخدم:', CANCEL_KB);
    });

    this.bot.action('admin_ban', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'admin_ban' });
      await ctx.reply('🚫 أرسل Telegram ID للمستخدم المراد إيقافه:', CANCEL_KB);
    });

    this.bot.action('admin_unban', async (ctx) => {
      await this.answerCbSafe(ctx);
      if (!(await this.checkOwner(ctx))) return;
      this.pendingStates.set(ctx.from!.id, { step: 'admin_unban' });
      await ctx.reply('✅ أرسل Telegram ID للمستخدم المراد تفعيله:', CANCEL_KB);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SLASH COMMANDS (backward compat)
  // ═══════════════════════════════════════════════════════════════════════════

  private registerCommands() {
    this.bot.command('activate', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 2) {
        this.pendingStates.set(ctx.from!.id, { step: 'activate_code' });
        return ctx.reply('🔑 أرسل كود التفعيل الآن:', CANCEL_KB);
      }
      try {
        const r = await this.authService.activateWithCode(this.tid(ctx), parts[1].trim());
        await ctx.reply(r.message, MAIN_MENU);
      } catch (e) {
        await ctx.reply(`❌ ${(e as Error).message}`);
      }
    });

    this.bot.command('status', async (ctx) => {
      const s = await this.authService.getUserStatus(this.tid(ctx));
      if (!s.registered) return ctx.reply('❌ أرسل /start أولاً.');
      await ctx.replyWithMarkdown(
        `*📊 حالة الحساب*\n\n` +
        `الحالة: ${s.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
        `الاشتراك: ${s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
        `الجلسة: ${s.session_status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}\n` +
        `المجموعات: ${s.groups_count}\n` +
        `الرسائل: ${s.messages_count}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 القائمة', 'main_menu')]]),
      );
    });

    this.bot.command('admin', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      await ctx.replyWithMarkdown('👑 *لوحة الإدارة*', ADMIN_MENU);
    });

    // Stats shortcut for owner
    this.bot.command('stats', async (ctx) => {
      if (!(await this.checkOwner(ctx))) return;
      const s = await this.authService.getSystemStats();
      await ctx.replyWithMarkdown(
        `*📊 إحصائيات النظام*\n\n` +
        `👥 المستخدمون: *${s.totalUsers}* (نشط: ${s.activeUsers})\n` +
        `🎟 الأكواد: *${s.totalCodes}* (متبقي: ${s.unusedCodes})\n` +
        `💬 الرسائل: *${s.totalMessages}* | المجموعات: *${s.totalGroups}*`,
        ADMIN_MENU,
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT HANDLER (multi-step flows)
  // ═══════════════════════════════════════════════════════════════════════════

  private registerTextHandler() {
    this.bot.on('text', async (ctx) => {
      const state = this.pendingStates.get(ctx.from!.id);
      if (!state) return;

      const text = ctx.message.text.trim();

      if (text === '❌ إلغاء') {
        this.pendingStates.delete(ctx.from!.id);
        return ctx.reply('✅ تم الإلغاء.', Markup.removeKeyboard());
      }

      // ── Session String ────────────────────────────────────────────────────
      if (state.step === 'session_string') {
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply('⏳ جاري التحقق من الجلسة...', Markup.removeKeyboard());
        try {
          const r = await this.sessionService.addSessionString(this.tid(ctx), text);
          await ctx.reply(r.message, SESSIONS_MENU);
        } catch (e) {
          await ctx.reply(
            `❌ الجلسة غير صالحة أو منتهية.\n\n${this.errText(e)}`,
            SESSIONS_MENU,
          );
        }
        return;
      }

      // ── Add group by ID ───────────────────────────────────────────────────
      if (state.step === 'group_id_input') {
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply('⏳ جاري التحقق من المجموعة...', Markup.removeKeyboard());
        try {
          const r = await this.groupsService.addGroupByPeerInput(this.tid(ctx), text);
          await ctx.reply(`✅ ${r.message}`, GROUPS_MENU);
        } catch (e) {
          await ctx.reply(`❌ ${this.errText(e)}`, GROUPS_MENU);
        }
        return;
      }

      // ── Activate ─────────────────────────────────────────────────────────
      if (state.step === 'activate_code') {
        try {
          const r = await this.authService.activateWithCode(this.tid(ctx), text);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(r.message, { ...Markup.removeKeyboard(), ...MAIN_MENU });
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Phone ─────────────────────────────────────────────────────────────
      if (state.step === 'phone') {
        try {
          const r = await this.sessionService.connectWithPhone(this.tid(ctx), text);
          this.pendingStates.set(ctx.from!.id, { step: 'otp', phone: text });
          await ctx.reply(`📨 ${r.message}`, Markup.removeKeyboard());
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── OTP ──────────────────────────────────────────────────────────────
      if (state.step === 'otp') {
        try {
          const r = await this.sessionService.verifyCode(this.tid(ctx), text);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`✅ ${r.message}`, { ...Markup.removeKeyboard(), ...SESSIONS_MENU });
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Message content ───────────────────────────────────────────────────
      if (state.step === 'message_content') {
        try {
          const msg = await this.messagesService.createMessage(this.tid(ctx), {
            type: 'text',
            content: text,
          });
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`✅ تم حفظ الرسالة (رقم: ${msg.id})`, {
            ...Markup.removeKeyboard(),
            ...MESSAGES_MENU,
          });
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Schedule interval ─────────────────────────────────────────────────
      if (state.step === 'set_schedule_interval') {
        const parts = text.split(' ');
        const interval = parseInt(parts[0]);
        if (isNaN(interval)) {
          await ctx.reply('❌ صيغة خاطئة. مثال: `3600 sequential`');
          return;
        }
        const mode = (parts[1] === 'sequential' ? 'sequential' : 'global') as 'global' | 'sequential';
        try {
          await this.scheduleService.createSchedule(this.tid(ctx), interval, mode);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(
            `✅ تم ضبط الجدول!\n⏱ كل ${interval} ثانية\n🔄 الوضع: ${mode === 'sequential' ? 'تتابعي' : 'للجميع'}`,
            { ...Markup.removeKeyboard(), ...SCHEDULE_MENU },
          );
        } catch (e) {
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Admin: gen_code ───────────────────────────────────────────────────
      if (state.step === 'admin_gen_code') {
        const days = parseInt(text);
        if (isNaN(days)) { await ctx.reply('❌ أدخل رقماً صحيحاً.'); return; }
        try {
          const code = await this.authService.generateActivationCode(days);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.replyWithMarkdown(
            `✅ *كود التفعيل:*\n\`${code}\`\n⏳ المدة: *${days} يوم*`,
            { ...Markup.removeKeyboard(), ...ADMIN_MENU },
          );
        } catch (e) {
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Admin: gen_codes ──────────────────────────────────────────────────
      if (state.step === 'admin_gen_codes') {
        const parts = text.split(' ');
        const days = parseInt(parts[0]);
        const count = Math.min(parseInt(parts[1] ?? '1'), 20);
        if (isNaN(days) || isNaN(count)) { await ctx.reply('❌ مثال: `30 5`'); return; }
        try {
          const codes: string[] = [];
          for (let i = 0; i < count; i++) codes.push(await this.authService.generateActivationCode(days));
          const list = codes.map((c, i) => `${i + 1}. \`${c}\``).join('\n');
          this.pendingStates.delete(ctx.from!.id);
          await ctx.replyWithMarkdown(
            `✅ *${count} كود تفعيل (${days} يوم لكل كود):*\n\n${list}`,
            { ...Markup.removeKeyboard(), ...ADMIN_MENU },
          );
        } catch (e) {
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Admin: user_info ──────────────────────────────────────────────────
      if (state.step === 'admin_user_info') {
        try {
          const info = await this.authService.getUserStatus(text);
          this.pendingStates.delete(ctx.from!.id);
          if (!info.registered) { await ctx.reply('❌ المستخدم غير موجود.'); return; }
          await ctx.replyWithMarkdown(
            `*👤 بيانات المستخدم*\n\n` +
            `الحالة: ${info.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
            `الاشتراك: ${info.subscription_end ? new Date(info.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
            `الجلسة: ${info.session_status}\n` +
            `المجموعات: ${info.groups_count} | الرسائل: ${info.messages_count}`,
            { ...Markup.removeKeyboard(), ...ADMIN_MENU },
          );
        } catch (e) {
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Admin: ban ────────────────────────────────────────────────────────
      if (state.step === 'admin_ban') {
        try {
          await this.authService.setUserActive(text, false);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`✅ تم إيقاف المستخدم ${text}`, { ...Markup.removeKeyboard(), ...ADMIN_MENU });
        } catch (e) {
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }

      // ── Admin: unban ──────────────────────────────────────────────────────
      if (state.step === 'admin_unban') {
        try {
          await this.authService.setUserActive(text, true);
          this.pendingStates.delete(ctx.from!.id);
          await ctx.reply(`✅ تم تفعيل المستخدم ${text}`, { ...Markup.removeKeyboard(), ...ADMIN_MENU });
        } catch (e) {
          await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
        }
        return;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  private registerPhotoHandler() {
    this.bot.on('photo', async (ctx) => {
      const state = this.pendingStates.get(ctx.from!.id);
      if (!state || state.step !== 'message_content') return;

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const caption = ctx.message.caption ?? '';
      try {
        const msg = await this.messagesService.createMessage(this.tid(ctx), {
          type: 'media',
          content: caption,
          file_id: photo.file_id,
        });
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply(`✅ تم حفظ الرسالة الإعلامية (رقم: ${msg.id})`, {
          ...Markup.removeKeyboard(),
          ...MESSAGES_MENU,
        });
      } catch (e) {
        this.pendingStates.delete(ctx.from!.id);
        await ctx.reply(`❌ ${(e as Error).message}`, Markup.removeKeyboard());
      }
    });
  }
}
