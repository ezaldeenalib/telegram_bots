"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BotService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const telegraf_1 = require("telegraf");
const https_proxy_agent_1 = require("https-proxy-agent");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const auth_service_1 = require("../auth/auth.service");
const session_service_1 = require("../session/session.service");
const groups_service_1 = require("../groups/groups.service");
const messages_service_1 = require("../messages/messages.service");
const schedule_service_1 = require("../schedule/schedule.service");
const MAIN_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('📊 حالة حسابي', 'status'),
        telegraf_1.Markup.button.callback('🔑 تفعيل الاشتراك', 'activate'),
    ],
    [telegraf_1.Markup.button.callback('📲 إدارة الجلسات', 'menu_sessions')],
    [
        telegraf_1.Markup.button.callback('👥 المجموعات', 'menu_groups'),
        telegraf_1.Markup.button.callback('💬 الرسائل', 'menu_messages'),
    ],
    [telegraf_1.Markup.button.callback('⏱ جدول الإرسال', 'menu_schedule')],
]);
const SESSIONS_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('➕ إضافة جلسة (Session String)', 'add_session_string'),
        telegraf_1.Markup.button.callback('📱 ربط برقم الهاتف', 'connect'),
    ],
    [
        telegraf_1.Markup.button.callback('📋 جلساتي', 'my_sessions'),
        telegraf_1.Markup.button.callback('🔌 فصل الكل', 'disconnect'),
    ],
    [telegraf_1.Markup.button.callback('🔙 رجوع', 'main_menu')],
]);
const ADMIN_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('📊 إحصائيات النظام', 'admin_stats'),
        telegraf_1.Markup.button.callback('👥 جميع المستخدمين', 'admin_all_users'),
    ],
    [
        telegraf_1.Markup.button.callback('🎟 توليد كود واحد', 'admin_gen_code'),
        telegraf_1.Markup.button.callback('🎟🎟 توليد عدة أكواد', 'admin_gen_codes'),
    ],
    [
        telegraf_1.Markup.button.callback('✅ تفعيل مستخدم', 'admin_unban'),
        telegraf_1.Markup.button.callback('🚫 إيقاف مستخدم', 'admin_ban'),
    ],
    [telegraf_1.Markup.button.callback('🔍 بيانات مستخدم', 'admin_user_info')],
    [telegraf_1.Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
]);
const GROUPS_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('📥 جلب واختيار المجموعات', 'sync_groups'),
        telegraf_1.Markup.button.callback('📋 مجموعاتي (عرض/حذف)', 'my_groups'),
    ],
    [telegraf_1.Markup.button.callback('➕ إضافة مجموعة بالمعرف (ID)', 'add_group_by_id')],
    [telegraf_1.Markup.button.callback('🔙 رجوع', 'main_menu')],
]);
const MESSAGES_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('➕ إضافة رسالة', 'add_message'),
        telegraf_1.Markup.button.callback('📋 رسائلي', 'my_messages'),
    ],
    [telegraf_1.Markup.button.callback('🔙 رجوع', 'main_menu')],
]);
const SCHEDULE_MENU = telegraf_1.Markup.inlineKeyboard([
    [
        telegraf_1.Markup.button.callback('⚙️ ضبط الجدول', 'set_schedule'),
        telegraf_1.Markup.button.callback('📊 حالة الجدول', 'schedule_status'),
    ],
    [
        telegraf_1.Markup.button.callback('▶️ تشغيل الإرسال', 'start_schedule'),
        telegraf_1.Markup.button.callback('⏹ إيقاف الإرسال', 'stop_schedule'),
    ],
    [telegraf_1.Markup.button.callback('🔙 رجوع', 'main_menu')],
]);
const CANCEL_KB = telegraf_1.Markup.keyboard([['❌ إلغاء']]).oneTime().resize();
let BotService = BotService_1 = class BotService {
    config;
    authService;
    sessionService;
    groupsService;
    messagesService;
    scheduleService;
    logger = new common_1.Logger(BotService_1.name);
    bot;
    pendingStates = new Map();
    groupImportDrafts = new Map();
    GROUP_IMPORT_PAGE = 8;
    GROUPS_MANAGE_PAGE = 6;
    ownerId;
    handlerTimeoutMs = 600_000;
    constructor(config, authService, sessionService, groupsService, messagesService, scheduleService) {
        this.config = config;
        this.authService = authService;
        this.sessionService = sessionService;
        this.groupsService = groupsService;
        this.messagesService = messagesService;
        this.scheduleService = scheduleService;
    }
    async onModuleInit() {
        const token = this.config.get('BOT_TOKEN');
        this.ownerId = parseInt(this.config.get('OWNER_ID') ?? '0', 10);
        if (!token) {
            this.logger.warn('BOT_TOKEN not set — bot will not start');
            return;
        }
        const proxyUrl = this.config.get('HTTPS_PROXY') ||
            this.config.get('HTTP_PROXY') ||
            process.env.HTTPS_PROXY ||
            process.env.HTTP_PROXY;
        let agent;
        if (proxyUrl) {
            agent = proxyUrl.startsWith('socks')
                ? new socks_proxy_agent_1.SocksProxyAgent(proxyUrl)
                : new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
            this.logger.log(`Using proxy: ${proxyUrl}`);
        }
        const parsedTimeout = parseInt(this.config.get('BOT_HANDLER_TIMEOUT_MS') ?? '600000', 10);
        this.handlerTimeoutMs =
            Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 600_000;
        this.bot = new telegraf_1.Telegraf(token, {
            handlerTimeout: this.handlerTimeoutMs,
            ...(agent ? { telegram: { agent } } : {}),
        });
        this.registerHandlers();
        void this.bot.launch()
            .then(() => this.logger.log(`🤖 البوت يعمل | المالك: ${this.ownerId}`))
            .catch((err) => this.logger.error(`تعذّر الاتصال بـ Telegram API: ${err.message}. ` +
            'تأكد من الاتصال بالإنترنت أو استخدم VPN.'));
        const stop = () => { try {
            this.bot?.stop('SIGTERM');
        }
        catch { } };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    }
    async onModuleDestroy() {
        try {
            this.bot?.stop('SIGTERM');
        }
        catch { }
    }
    isOwner(ctx) { return ctx.from?.id === this.ownerId; }
    async checkOwner(ctx) {
        if (!this.isOwner(ctx)) {
            await this.answerCbSafe(ctx, '⛔ هذا الأمر للمالك فقط');
            await ctx.reply('⛔ هذا الأمر مخصص للمالك فقط.');
            return false;
        }
        return true;
    }
    async checkActive(ctx) {
        const active = await this.authService.isUserActive(ctx.from.id.toString());
        if (!active) {
            const msg = '❌ اشتراكك غير مفعّل.\nاضغط على زر *تفعيل الاشتراك* أو أرسل:\n`/activate <الكود>`';
            await ctx.replyWithMarkdown(msg);
            return false;
        }
        return true;
    }
    tid(ctx) { return ctx.from.id.toString(); }
    errText(err) {
        if (err instanceof Error)
            return err.message;
        return String(err);
    }
    isStaleCallbackError(err) {
        const desc = err && typeof err === 'object' && 'response' in err
            ? String(err.response?.description ?? '')
            : '';
        const d = desc.toLowerCase();
        return (d.includes('too old') ||
            d.includes('query id is invalid') ||
            d.includes('response timeout expired'));
    }
    async answerCbSafe(ctx, text) {
        if (!ctx.callbackQuery)
            return;
        try {
            await ctx.answerCbQuery(text);
        }
        catch (err) {
            if (this.isStaleCallbackError(err))
                return;
            throw err;
        }
    }
    truncateImportBtn(s, max) {
        const t = s.replace(/\n/g, ' ').trim();
        return t.length <= max ? t : t.slice(0, max - 1) + '…';
    }
    clampGroupImportPage(d) {
        const totalPages = Math.max(1, Math.ceil(d.candidates.length / this.GROUP_IMPORT_PAGE));
        d.page = Math.min(Math.max(0, d.page), totalPages - 1);
        return totalPages;
    }
    groupImportPromptText(d) {
        const totalPages = this.clampGroupImportPage(d);
        return (`📥 جلب المجموعات من حسابك المربوط\n\n` +
            `اضغط على السطر للتحديد أو إلغاء التحديد، ثم «إضافة المحدد».\n` +
            `المحدد: ${d.selected.size} من ${d.candidates.length} — صفحة ${d.page + 1}/${totalPages}`);
    }
    groupImportKeyboard(d) {
        const ps = this.GROUP_IMPORT_PAGE;
        const totalPages = this.clampGroupImportPage(d);
        const p = d.page;
        const start = p * ps;
        const slice = d.candidates.slice(start, start + ps);
        const rows = [];
        for (let i = 0; i < slice.length; i++) {
            const gi = start + i;
            const c = slice[i];
            const mark = d.selected.has(gi) ? '✅' : '☐';
            const label = `${mark} ${this.truncateImportBtn(c.group_name, 28)}`;
            rows.push([telegraf_1.Markup.button.callback(label, `gto_${gi}`)]);
        }
        const nav = [];
        if (p > 0)
            nav.push(telegraf_1.Markup.button.callback('‹ السابق', `gpg_${p - 1}`));
        if (p < totalPages - 1)
            nav.push(telegraf_1.Markup.button.callback('التالي ›', `gpg_${p + 1}`));
        if (nav.length)
            rows.push(nav);
        rows.push([
            telegraf_1.Markup.button.callback('💾 إضافة المحدد', 'gisave'),
            telegraf_1.Markup.button.callback('❌ إلغاء', 'gican'),
        ]);
        return telegraf_1.Markup.inlineKeyboard(rows);
    }
    groupsManageListPayload(groups, page) {
        const PAGE = this.GROUPS_MANAGE_PAGE;
        const n = groups.length;
        const totalPages = Math.max(1, Math.ceil(n / PAGE));
        const p = Math.min(Math.max(0, page), totalPages - 1);
        const start = p * PAGE;
        const slice = groups.slice(start, start + PAGE);
        const text = `📋 مجموعاتك (${n})` +
            (totalPages > 1 ? `  —  صفحة ${p + 1} / ${totalPages}` : '') +
            `\n\nاضغط 🗑 لإزالة المجموعة من البوت (لا يُلغي عضويتك على Telegram).`;
        const rows = [];
        for (const g of slice) {
            const idLabel = g.group_id.startsWith('-') ? g.group_id : `-${g.group_id}`;
            rows.push([
                telegraf_1.Markup.button.callback(idLabel, `grp_info_${g.id}`),
                telegraf_1.Markup.button.callback('🗑', `grp_del_${g.id}_p${p}`),
            ]);
        }
        const nav = [];
        if (p > 0)
            nav.push(telegraf_1.Markup.button.callback('‹ السابق', `grp_pg_${p - 1}`));
        if (p < totalPages - 1)
            nav.push(telegraf_1.Markup.button.callback('التالي ›', `grp_pg_${p + 1}`));
        if (nav.length)
            rows.push(nav);
        rows.push([
            telegraf_1.Markup.button.callback('➕ إضافة كروب', 'add_group_by_id'),
            telegraf_1.Markup.button.callback('🔙 الصفحة الرئيسية', 'main_menu'),
        ]);
        return { text, page: p, markup: telegraf_1.Markup.inlineKeyboard(rows) };
    }
    async safeEdit(ctx, text, extra) {
        try {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
        }
        catch {
            await ctx.replyWithMarkdown(text, extra);
        }
    }
    registerHandlers() {
        this.registerStartHelp();
        this.registerCallbacks();
        this.registerCommands();
        this.registerTextHandler();
        this.registerPhotoHandler();
        this.bot.catch((err, ctx) => {
            if (this.isStaleCallbackError(err))
                return;
            const name = err instanceof Error ? err.name : '';
            if (name === 'TimeoutError') {
                this.logger.warn(`Bot handler timed out (${ctx.updateType}). ` +
                    `Increase BOT_HANDLER_TIMEOUT_MS if needed (current: ${this.handlerTimeoutMs}ms).`);
                return;
            }
            this.logger.error(`Bot error ${ctx.updateType}:`, err);
        });
    }
    registerStartHelp() {
        this.bot.start(async (ctx) => {
            const { id, username, first_name } = ctx.from;
            await this.authService.findOrCreateUser(id.toString(), username, first_name);
            const status = await this.authService.getUserStatus(id.toString());
            const owner = id === this.ownerId;
            const greeting = `👋 أهلاً *${first_name ?? 'بك'}*${owner ? ' 👑' : ''}!\n\n` +
                `📊 *الحالة:* ${status.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
                (status.subscription_end
                    ? `📅 *ينتهي:* ${new Date(status.subscription_end).toLocaleDateString('ar-IQ')}\n`
                    : '') +
                `\nاختر من القائمة أدناه:`;
            const kb = owner
                ? telegraf_1.Markup.inlineKeyboard([
                    ...MAIN_MENU.reply_markup.inline_keyboard,
                    [telegraf_1.Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')],
                ])
                : MAIN_MENU;
            await ctx.replyWithMarkdown(greeting, kb);
        });
        this.bot.help(async (ctx) => {
            await ctx.replyWithMarkdown(`*📋 القائمة الرئيسية*\n\nاضغط على الأزرار أدناه للتنقل بين الأقسام.`, MAIN_MENU);
        });
    }
    registerCallbacks() {
        this.bot.action('main_menu', async (ctx) => {
            await this.answerCbSafe(ctx);
            const owner = ctx.from?.id === this.ownerId;
            const kb = owner
                ? telegraf_1.Markup.inlineKeyboard([
                    ...MAIN_MENU.reply_markup.inline_keyboard,
                    [telegraf_1.Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')],
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
            if (!(await this.checkOwner(ctx)))
                return;
            await this.safeEdit(ctx, '👑 *لوحة الإدارة*\n\nاختر العملية:', ADMIN_MENU);
        });
        this.bot.action('status', async (ctx) => {
            await this.answerCbSafe(ctx);
            const s = await this.authService.getUserStatus(this.tid(ctx));
            if (!s.registered) {
                await ctx.reply('❌ لم تسجّل بعد. أرسل /start');
                return;
            }
            const text = `*📊 حالة الحساب*\n\n` +
                `الحالة: ${s.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
                `الاشتراك: ${s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
                `الجلسة: ${s.session_status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}\n` +
                `المجموعات: ${s.groups_count}\n` +
                `الرسائل: ${s.messages_count}`;
            await this.safeEdit(ctx, text, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🔙 رجوع', 'main_menu')]]));
        });
        this.bot.action('activate', async (ctx) => {
            await this.answerCbSafe(ctx);
            this.pendingStates.set(ctx.from.id, { step: 'activate_code' });
            await ctx.reply('🔑 أرسل كود التفعيل الآن:', CANCEL_KB);
        });
        this.bot.action('connect', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'phone' });
            await ctx.reply('📱 أرسل رقم هاتفك مع رمز الدولة:\nمثال: +9647801234567', CANCEL_KB);
        });
        this.bot.action('disconnect', async (ctx) => {
            await this.answerCbSafe(ctx);
            try {
                const r = await this.sessionService.disconnectSession(this.tid(ctx));
                await ctx.reply(r.message, SESSIONS_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.action('add_session_string', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'session_string' });
            await ctx.replyWithMarkdown(`➕ *إضافة Session String*\n\n` +
                `أرسل Session String الخاصة بحسابك.\n\n` +
                `📌 *كيف تحصل عليها؟*\n` +
                `باستخدام Telethon أو GramJS يمكنك توليدها هكذا:\n` +
                `\`\`\`python\nfrom telethon.sync import TelegramClient\n` +
                `from telethon.sessions import StringSession\n` +
                `with TelegramClient(StringSession(), api_id, api_hash) as c:\n` +
                `    print(c.session.save())\n\`\`\`\n\n` +
                `⚠️ *لا تشارك هذه الجلسة مع أحد!*`, CANCEL_KB);
        });
        this.bot.action('my_sessions', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            const sessions = await this.sessionService.listSessions(this.tid(ctx));
            if (!sessions.length) {
                await ctx.reply('لا توجد جلسات مسجلة. اضغط *إضافة جلسة* لإضافة واحدة.', SESSIONS_MENU);
                return;
            }
            const list = sessions
                .map((s, i) => `${i + 1}. ${s.status === 'connected' ? '🟢' : '🔴'} *${s.label}*\n` +
                `   ${s.account_name ? `👤 ${s.account_name}` : ''}${s.phone ? ` 📱 ${s.phone}` : ''}\n` +
                `   المصدر: ${s.source === 'string' ? '📋 Session String' : '📱 رقم الهاتف'}`)
                .join('\n\n');
            const delBtns = sessions.map((s) => telegraf_1.Markup.button.callback(`🗑 حذف: ${s.label}`, `del_session_${s.id}`));
            const delRows = [];
            for (let i = 0; i < delBtns.length; i++)
                delRows.push([delBtns[i]]);
            delRows.push([telegraf_1.Markup.button.callback('🔙 رجوع', 'menu_sessions')]);
            await ctx.replyWithMarkdown(`*📋 جلساتك (${sessions.length}):*\n\n${list}`, telegraf_1.Markup.inlineKeyboard(delRows));
        });
        this.bot.action(/^del_session_(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx);
            const sessionId = parseInt(ctx.match[1]);
            try {
                const r = await this.sessionService.deleteSession(this.tid(ctx), sessionId);
                await ctx.reply(r.message, SESSIONS_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.action('sync_groups', async (ctx) => {
            await this.answerCbSafe(ctx, '⏳ جاري الجلب...');
            if (!(await this.checkActive(ctx)))
                return;
            const uid = ctx.from.id;
            try {
                const list = await this.groupsService.listDialogGroupsForImport(this.tid(ctx));
                if (!list.length) {
                    await ctx.reply('لم يُعثر على مجموعات أو قنوات في حواراتك.', GROUPS_MENU);
                    return;
                }
                const draft = { candidates: list, selected: new Set(), page: 0 };
                this.groupImportDrafts.set(uid, draft);
                await ctx.reply(this.groupImportPromptText(draft), {
                    ...this.groupImportKeyboard(draft),
                });
            }
            catch (e) {
                await ctx.reply(`❌ ${this.errText(e)}`, GROUPS_MENU);
            }
        });
        this.bot.action(/^gto_(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx);
            const uid = ctx.from.id;
            const gi = parseInt(ctx.match[1], 10);
            const draft = this.groupImportDrafts.get(uid);
            if (!draft || !Number.isFinite(gi) || gi < 0 || gi >= draft.candidates.length)
                return;
            if (draft.selected.has(gi))
                draft.selected.delete(gi);
            else
                draft.selected.add(gi);
            try {
                await ctx.editMessageText(this.groupImportPromptText(draft), {
                    ...this.groupImportKeyboard(draft),
                });
            }
            catch {
            }
        });
        this.bot.action(/^gpg_(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx);
            const uid = ctx.from.id;
            const newPage = parseInt(ctx.match[1], 10);
            const draft = this.groupImportDrafts.get(uid);
            if (!draft || !Number.isFinite(newPage) || newPage < 0)
                return;
            draft.page = newPage;
            this.clampGroupImportPage(draft);
            try {
                await ctx.editMessageText(this.groupImportPromptText(draft), {
                    ...this.groupImportKeyboard(draft),
                });
            }
            catch {
            }
        });
        this.bot.action('gisave', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            const uid = ctx.from.id;
            const draft = this.groupImportDrafts.get(uid);
            if (!draft) {
                await ctx.reply('انتهت جلسة الاستيراد. اضغط «جلب واختيار المجموعات» من جديد.', GROUPS_MENU);
                return;
            }
            const selectedItems = [...draft.selected]
                .sort((a, b) => a - b)
                .map((i) => draft.candidates[i])
                .filter(Boolean);
            try {
                const r = await this.groupsService.saveImportedGroupsSelection(this.tid(ctx), selectedItems);
                this.groupImportDrafts.delete(uid);
                await ctx.deleteMessage().catch(() => null);
                await ctx.reply(`✅ ${r.message}`, GROUPS_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${this.errText(e)}`);
            }
        });
        this.bot.action('gican', async (ctx) => {
            await this.answerCbSafe(ctx);
            const uid = ctx.from.id;
            this.groupImportDrafts.delete(uid);
            await ctx.deleteMessage().catch(() => null);
            await ctx.reply('تم الإلغاء.', GROUPS_MENU);
        });
        this.bot.action('my_groups', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            const groups = await this.groupsService.getGroups(this.tid(ctx));
            if (!groups.length) {
                await ctx.reply('لا توجد مجموعات. استوردها أو أضف واحدة بالمعرف.', GROUPS_MENU);
                return;
            }
            const payload = this.groupsManageListPayload(groups, 0);
            await ctx.reply(payload.text, { ...payload.markup });
        });
        this.bot.action(/^grp_info_(\d+)$/, async (ctx) => {
            const dbId = parseInt(ctx.match[1], 10);
            try {
                const groups = await this.groupsService.getGroups(this.tid(ctx));
                const g = groups.find((x) => x.id === dbId);
                const name = g ? g.group_name : 'مجموعة';
                await this.answerCbSafe(ctx, name.slice(0, 200));
            }
            catch {
                await this.answerCbSafe(ctx);
            }
        });
        this.bot.action(/^grp_pg_(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            const page = parseInt(ctx.match[1], 10);
            if (!Number.isFinite(page) || page < 0)
                return;
            const groups = await this.groupsService.getGroups(this.tid(ctx));
            if (!groups.length) {
                await ctx.deleteMessage().catch(() => null);
                await ctx.reply('لا توجد مجموعات.', GROUPS_MENU);
                return;
            }
            const payload = this.groupsManageListPayload(groups, page);
            try {
                await ctx.editMessageText(payload.text, { ...payload.markup });
            }
            catch {
                await ctx.reply(payload.text, { ...payload.markup });
            }
        });
        this.bot.action(/^grp_del_(\d+)_p(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx, '🗑 جاري الحذف...');
            if (!(await this.checkActive(ctx)))
                return;
            const dbId = parseInt(ctx.match[1], 10);
            const fromPage = parseInt(ctx.match[2], 10);
            if (!Number.isFinite(dbId) || !Number.isFinite(fromPage))
                return;
            try {
                await this.groupsService.deleteGroupByDbId(this.tid(ctx), dbId);
            }
            catch (e) {
                await ctx.reply(`❌ ${this.errText(e)}`);
                return;
            }
            const groups = await this.groupsService.getGroups(this.tid(ctx));
            if (!groups.length) {
                await ctx.deleteMessage().catch(() => null);
                await ctx.reply('✅ تم الحذف. لا توجد مجموعات أخرى في القائمة.', GROUPS_MENU);
                return;
            }
            const payload = this.groupsManageListPayload(groups, fromPage);
            try {
                await ctx.editMessageText(payload.text, { ...payload.markup });
            }
            catch {
                await ctx.reply(`✅ تم الحذف.\n\n${payload.text}`, { ...payload.markup });
            }
        });
        this.bot.action('add_group_by_id', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'group_id_input' });
            await ctx.reply('➕ إضافة مجموعة بالمعرف\n\n' +
                'أرسل أحد التالي:\n' +
                '• معرف المجموعة مثل: -1001234567890\n' +
                '• أو اسم المستخدم: @groupusername\n\n' +
                '⚠️ يجب أن يكون حسابك المربوط عضوًا في هذه المجموعة.', CANCEL_KB);
        });
        this.bot.action('add_message', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'message_content' });
            await ctx.reply('📝 أرسل نص الرسالة الآن.\nأو أرسل صورة مع تعليق للرسالة الإعلامية:', CANCEL_KB);
        });
        this.bot.action('my_messages', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            const msgs = await this.messagesService.getMessages(this.tid(ctx));
            if (!msgs.length) {
                await ctx.reply('لا توجد رسائل بعد. اضغط *إضافة رسالة*.', MESSAGES_MENU);
                return;
            }
            const list = msgs
                .map((m) => `[${m.id}] ${m.type === 'media' ? '🖼' : '📝'} ${(m.content ?? '').substring(0, 50)}`)
                .join('\n');
            const delButtons = msgs.slice(0, 10).map((m) => telegraf_1.Markup.button.callback(`🗑 حذف [${m.id}]`, `del_msg_${m.id}`));
            const rows = [];
            for (let i = 0; i < delButtons.length; i += 2) {
                rows.push(delButtons.slice(i, i + 2));
            }
            rows.push([telegraf_1.Markup.button.callback('🔙 رجوع', 'menu_messages')]);
            await ctx.replyWithMarkdown(`*💬 رسائلك (${msgs.length}):*\n\n\`\`\`\n${list}\n\`\`\``, telegraf_1.Markup.inlineKeyboard(rows));
        });
        this.bot.action(/^del_msg_(\d+)$/, async (ctx) => {
            await this.answerCbSafe(ctx);
            const msgId = parseInt(ctx.match[1]);
            try {
                await this.messagesService.deleteMessage(this.tid(ctx), msgId);
                await ctx.reply(`✅ تم حذف الرسالة [${msgId}]`, MESSAGES_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.action('set_schedule', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'set_schedule_interval' });
            await ctx.reply('⚙️ أرسل الإعداد بالصيغة التالية:\n`<ثواني> <global|sequential>`\n\nمثال:\n`3600 sequential` — كل ساعة بالتتابع\n`1800 global` — كل نصف ساعة للجميع', CANCEL_KB);
        });
        this.bot.action('schedule_status', async (ctx) => {
            await this.answerCbSafe(ctx);
            const s = await this.scheduleService.getScheduleStatus(this.tid(ctx));
            if (!s.configured) {
                await ctx.reply('لم يُضبط جدول بعد. اضغط *ضبط الجدول*.', SCHEDULE_MENU);
                return;
            }
            await ctx.replyWithMarkdown(`*⏱ حالة الجدول*\n\n` +
                `التشغيل: ${s.is_running ? '✅ يعمل' : '❌ متوقف'}\n` +
                `الفترة: كل ${s.interval} ثانية\n` +
                `الوضع: ${s.mode === 'sequential' ? '🔁 تتابعي' : '📢 للجميع'}\n` +
                `آخر إرسال: ${s.last_run_at ? new Date(s.last_run_at).toLocaleString('ar-IQ') : 'لا يوجد'}`, SCHEDULE_MENU);
        });
        this.bot.action('start_schedule', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkActive(ctx)))
                return;
            try {
                const r = await this.scheduleService.startSchedule(this.tid(ctx));
                await ctx.reply(`▶️ ${r.message}`, SCHEDULE_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`, SCHEDULE_MENU);
            }
        });
        this.bot.action('stop_schedule', async (ctx) => {
            await this.answerCbSafe(ctx);
            try {
                const r = await this.scheduleService.stopSchedule(this.tid(ctx));
                await ctx.reply(`⏹ ${r.message}`, SCHEDULE_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`, SCHEDULE_MENU);
            }
        });
        this.bot.action('admin_stats', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            const s = await this.authService.getSystemStats();
            await ctx.replyWithMarkdown(`*📊 إحصائيات النظام*\n\n` +
                `👥 إجمالي المستخدمين: *${s.totalUsers}*\n` +
                `✅ اشتراكات نشطة: *${s.activeUsers}*\n` +
                `❌ غير نشط: *${s.inactiveUsers}*\n` +
                `🎟 إجمالي الأكواد: *${s.totalCodes}*\n` +
                `🔓 مستخدمة: *${s.usedCodes}*\n` +
                `🔒 متبقية: *${s.unusedCodes}*\n` +
                `💬 الرسائل: *${s.totalMessages}*\n` +
                `👥 المجموعات: *${s.totalGroups}*`, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🔙 لوحة الإدارة', 'admin_panel')]]));
        });
        this.bot.action('admin_all_users', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            const users = await this.authService.getAllUsers();
            if (!users.length) {
                await ctx.reply('لا يوجد مستخدمون بعد.');
                return;
            }
            const now = new Date();
            const list = users.map((u, i) => {
                const active = u.is_active && u.subscription_end && u.subscription_end > now;
                const exp = u.subscription_end ? new Date(u.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد';
                return `${i + 1}. ${active ? '✅' : '❌'} *${u.first_name ?? u.username ?? 'N/A'}*\n   🆔 \`${u.telegram_id}\` | ينتهي: ${exp}`;
            }).join('\n\n');
            await ctx.replyWithMarkdown(`*👥 المستخدمون (${users.length}):*\n\n${list}`, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🔙 لوحة الإدارة', 'admin_panel')]]));
        });
        this.bot.action('admin_gen_code', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'admin_gen_code' });
            await ctx.reply('🎟 أرسل عدد أيام الاشتراك:\nمثال: `30`', CANCEL_KB);
        });
        this.bot.action('admin_gen_codes', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'admin_gen_codes' });
            await ctx.reply('🎟🎟 أرسل عدد الأيام والكمية:\nمثال: `30 5` (30 يوماً، 5 أكواد)', CANCEL_KB);
        });
        this.bot.action('admin_user_info', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'admin_user_info' });
            await ctx.reply('🔍 أرسل Telegram ID للمستخدم:', CANCEL_KB);
        });
        this.bot.action('admin_ban', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'admin_ban' });
            await ctx.reply('🚫 أرسل Telegram ID للمستخدم المراد إيقافه:', CANCEL_KB);
        });
        this.bot.action('admin_unban', async (ctx) => {
            await this.answerCbSafe(ctx);
            if (!(await this.checkOwner(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'admin_unban' });
            await ctx.reply('✅ أرسل Telegram ID للمستخدم المراد تفعيله:', CANCEL_KB);
        });
    }
    registerCommands() {
        this.bot.command('activate', async (ctx) => {
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2) {
                this.pendingStates.set(ctx.from.id, { step: 'activate_code' });
                return ctx.reply('🔑 أرسل كود التفعيل الآن:', CANCEL_KB);
            }
            try {
                const r = await this.authService.activateWithCode(this.tid(ctx), parts[1].trim());
                await ctx.reply(r.message, MAIN_MENU);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('status', async (ctx) => {
            const s = await this.authService.getUserStatus(this.tid(ctx));
            if (!s.registered)
                return ctx.reply('❌ أرسل /start أولاً.');
            await ctx.replyWithMarkdown(`*📊 حالة الحساب*\n\n` +
                `الحالة: ${s.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
                `الاشتراك: ${s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
                `الجلسة: ${s.session_status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}\n` +
                `المجموعات: ${s.groups_count}\n` +
                `الرسائل: ${s.messages_count}`, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('🔙 القائمة', 'main_menu')]]));
        });
        this.bot.command('admin', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            await ctx.replyWithMarkdown('👑 *لوحة الإدارة*', ADMIN_MENU);
        });
        this.bot.command('stats', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const s = await this.authService.getSystemStats();
            await ctx.replyWithMarkdown(`*📊 إحصائيات النظام*\n\n` +
                `👥 المستخدمون: *${s.totalUsers}* (نشط: ${s.activeUsers})\n` +
                `🎟 الأكواد: *${s.totalCodes}* (متبقي: ${s.unusedCodes})\n` +
                `💬 الرسائل: *${s.totalMessages}* | المجموعات: *${s.totalGroups}*`, ADMIN_MENU);
        });
    }
    registerTextHandler() {
        this.bot.on('text', async (ctx) => {
            const state = this.pendingStates.get(ctx.from.id);
            if (!state)
                return;
            const text = ctx.message.text.trim();
            if (text === '❌ إلغاء') {
                this.pendingStates.delete(ctx.from.id);
                return ctx.reply('✅ تم الإلغاء.', telegraf_1.Markup.removeKeyboard());
            }
            if (state.step === 'session_string') {
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply('⏳ جاري التحقق من الجلسة...', telegraf_1.Markup.removeKeyboard());
                try {
                    const r = await this.sessionService.addSessionString(this.tid(ctx), text);
                    await ctx.reply(r.message, SESSIONS_MENU);
                }
                catch (e) {
                    await ctx.reply(`❌ الجلسة غير صالحة أو منتهية.\n\n${this.errText(e)}`, SESSIONS_MENU);
                }
                return;
            }
            if (state.step === 'group_id_input') {
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply('⏳ جاري التحقق من المجموعة...', telegraf_1.Markup.removeKeyboard());
                try {
                    const r = await this.groupsService.addGroupByPeerInput(this.tid(ctx), text);
                    await ctx.reply(`✅ ${r.message}`, GROUPS_MENU);
                }
                catch (e) {
                    await ctx.reply(`❌ ${this.errText(e)}`, GROUPS_MENU);
                }
                return;
            }
            if (state.step === 'activate_code') {
                try {
                    const r = await this.authService.activateWithCode(this.tid(ctx), text);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(r.message, { ...telegraf_1.Markup.removeKeyboard(), ...MAIN_MENU });
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'phone') {
                try {
                    const r = await this.sessionService.connectWithPhone(this.tid(ctx), text);
                    this.pendingStates.set(ctx.from.id, { step: 'otp', phone: text });
                    await ctx.reply(`📨 ${r.message}`, telegraf_1.Markup.removeKeyboard());
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'otp') {
                try {
                    const r = await this.sessionService.verifyCode(this.tid(ctx), text);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ ${r.message}`, { ...telegraf_1.Markup.removeKeyboard(), ...SESSIONS_MENU });
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'message_content') {
                try {
                    const msg = await this.messagesService.createMessage(this.tid(ctx), {
                        type: 'text',
                        content: text,
                    });
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ تم حفظ الرسالة (رقم: ${msg.id})`, {
                        ...telegraf_1.Markup.removeKeyboard(),
                        ...MESSAGES_MENU,
                    });
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'set_schedule_interval') {
                const parts = text.split(' ');
                const interval = parseInt(parts[0]);
                if (isNaN(interval)) {
                    await ctx.reply('❌ صيغة خاطئة. مثال: `3600 sequential`');
                    return;
                }
                const mode = (parts[1] === 'sequential' ? 'sequential' : 'global');
                try {
                    await this.scheduleService.createSchedule(this.tid(ctx), interval, mode);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ تم ضبط الجدول!\n⏱ كل ${interval} ثانية\n🔄 الوضع: ${mode === 'sequential' ? 'تتابعي' : 'للجميع'}`, { ...telegraf_1.Markup.removeKeyboard(), ...SCHEDULE_MENU });
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'admin_gen_code') {
                const days = parseInt(text);
                if (isNaN(days)) {
                    await ctx.reply('❌ أدخل رقماً صحيحاً.');
                    return;
                }
                try {
                    const code = await this.authService.generateActivationCode(days);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.replyWithMarkdown(`✅ *كود التفعيل:*\n\`${code}\`\n⏳ المدة: *${days} يوم*`, { ...telegraf_1.Markup.removeKeyboard(), ...ADMIN_MENU });
                }
                catch (e) {
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'admin_gen_codes') {
                const parts = text.split(' ');
                const days = parseInt(parts[0]);
                const count = Math.min(parseInt(parts[1] ?? '1'), 20);
                if (isNaN(days) || isNaN(count)) {
                    await ctx.reply('❌ مثال: `30 5`');
                    return;
                }
                try {
                    const codes = [];
                    for (let i = 0; i < count; i++)
                        codes.push(await this.authService.generateActivationCode(days));
                    const list = codes.map((c, i) => `${i + 1}. \`${c}\``).join('\n');
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.replyWithMarkdown(`✅ *${count} كود تفعيل (${days} يوم لكل كود):*\n\n${list}`, { ...telegraf_1.Markup.removeKeyboard(), ...ADMIN_MENU });
                }
                catch (e) {
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'admin_user_info') {
                try {
                    const info = await this.authService.getUserStatus(text);
                    this.pendingStates.delete(ctx.from.id);
                    if (!info.registered) {
                        await ctx.reply('❌ المستخدم غير موجود.');
                        return;
                    }
                    await ctx.replyWithMarkdown(`*👤 بيانات المستخدم*\n\n` +
                        `الحالة: ${info.is_active ? '✅ مفعّل' : '❌ غير مفعّل'}\n` +
                        `الاشتراك: ${info.subscription_end ? new Date(info.subscription_end).toLocaleDateString('ar-IQ') : 'لا يوجد'}\n` +
                        `الجلسة: ${info.session_status}\n` +
                        `المجموعات: ${info.groups_count} | الرسائل: ${info.messages_count}`, { ...telegraf_1.Markup.removeKeyboard(), ...ADMIN_MENU });
                }
                catch (e) {
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'admin_ban') {
                try {
                    await this.authService.setUserActive(text, false);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ تم إيقاف المستخدم ${text}`, { ...telegraf_1.Markup.removeKeyboard(), ...ADMIN_MENU });
                }
                catch (e) {
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
            if (state.step === 'admin_unban') {
                try {
                    await this.authService.setUserActive(text, true);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ تم تفعيل المستخدم ${text}`, { ...telegraf_1.Markup.removeKeyboard(), ...ADMIN_MENU });
                }
                catch (e) {
                    await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
                }
                return;
            }
        });
    }
    registerPhotoHandler() {
        this.bot.on('photo', async (ctx) => {
            const state = this.pendingStates.get(ctx.from.id);
            if (!state || state.step !== 'message_content')
                return;
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const caption = ctx.message.caption ?? '';
            try {
                const msg = await this.messagesService.createMessage(this.tid(ctx), {
                    type: 'media',
                    content: caption,
                    file_id: photo.file_id,
                });
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply(`✅ تم حفظ الرسالة الإعلامية (رقم: ${msg.id})`, {
                    ...telegraf_1.Markup.removeKeyboard(),
                    ...MESSAGES_MENU,
                });
            }
            catch (e) {
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply(`❌ ${e.message}`, telegraf_1.Markup.removeKeyboard());
            }
        });
    }
};
exports.BotService = BotService;
exports.BotService = BotService = BotService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        auth_service_1.AuthService,
        session_service_1.SessionService,
        groups_service_1.GroupsService,
        messages_service_1.MessagesService,
        schedule_service_1.ScheduleService])
], BotService);
//# sourceMappingURL=bot.service.js.map