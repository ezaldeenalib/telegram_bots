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
    ownerId;
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
            if (proxyUrl.startsWith('socks')) {
                agent = new socks_proxy_agent_1.SocksProxyAgent(proxyUrl);
                this.logger.log(`Using SOCKS proxy: ${proxyUrl}`);
            }
            else {
                agent = new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
                this.logger.log(`Using HTTPS proxy: ${proxyUrl}`);
            }
        }
        this.bot = new telegraf_1.Telegraf(token, agent ? { telegram: { agent } } : {});
        this.registerHandlers();
        void this.bot
            .launch()
            .then(() => {
            this.logger.log(`🤖 Bot launched | Owner: ${this.ownerId}`);
        })
            .catch((err) => {
            this.logger.error(`Cannot reach Telegram API (${err.message}). ` +
                `If Telegram is blocked on your network, set HTTPS_PROXY in .env or use a VPN, then restart.`);
        });
        const stopBot = () => {
            try {
                this.bot?.stop('SIGTERM');
            }
            catch {
            }
        };
        process.once('SIGINT', stopBot);
        process.once('SIGTERM', stopBot);
    }
    async onModuleDestroy() {
        try {
            this.bot?.stop('SIGTERM');
        }
        catch {
        }
    }
    isOwner(ctx) {
        return ctx.from?.id === this.ownerId;
    }
    async checkOwner(ctx) {
        if (!this.isOwner(ctx)) {
            await ctx.reply('⛔ This command is restricted to the bot owner.');
            return false;
        }
        return true;
    }
    async checkActive(ctx) {
        const isActive = await this.authService.isUserActive(ctx.from.id.toString());
        if (!isActive) {
            await ctx.reply('❌ Your subscription is inactive.\nUse /activate <code> to activate.');
            return false;
        }
        return true;
    }
    registerHandlers() {
        this.registerUserCommands();
        this.registerAdminCommands();
        this.registerTextHandler();
        this.registerPhotoHandler();
        this.bot.catch((err, ctx) => {
            this.logger.error(`Bot error for ${ctx.updateType}:`, err);
        });
    }
    registerUserCommands() {
        this.bot.start(async (ctx) => {
            const { id, username, first_name } = ctx.from;
            await this.authService.findOrCreateUser(id.toString(), username, first_name);
            const status = await this.authService.getUserStatus(id.toString());
            const isOwner = id === this.ownerId;
            await ctx.replyWithMarkdown(`👋 Welcome *${first_name ?? 'there'}*!` +
                (isOwner ? ' 👑 *(Owner)*' : '') +
                `\n\n` +
                `📊 *Status:* ${status.is_active ? '✅ Active' : '❌ Inactive'}\n` +
                (status.subscription_end
                    ? `📅 Until: ${new Date(status.subscription_end).toLocaleDateString()}\n`
                    : '') +
                `\nUse /help to see all commands.`);
        });
        this.bot.help(async (ctx) => {
            const isOwner = ctx.from?.id === this.ownerId;
            let text = `*📋 Commands*\n\n` +
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
        this.bot.command('activate', async (ctx) => {
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2)
                return ctx.reply('Usage: /activate <code>');
            try {
                const result = await this.authService.activateWithCode(ctx.from.id.toString(), parts[1].trim());
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('status', async (ctx) => {
            const status = await this.authService.getUserStatus(ctx.from.id.toString());
            if (!status.registered)
                return ctx.reply('Not registered. Send /start first.');
            await ctx.replyWithMarkdown(`*📊 Account Status*\n\n` +
                `Active: ${status.is_active ? '✅' : '❌'}\n` +
                `Subscription: ${status.subscription_end ? new Date(status.subscription_end).toLocaleDateString() : 'None'}\n` +
                `Session: ${status.session_status}\n` +
                `Groups: ${status.groups_count}\n` +
                `Messages: ${status.messages_count}`);
        });
        this.bot.command('connect', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'phone' });
            await ctx.reply('📱 Enter your phone number with country code:\nExample: +9647801234567');
        });
        this.bot.command('disconnect', async (ctx) => {
            try {
                const result = await this.sessionService.disconnectSession(ctx.from.id.toString());
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('session_status', async (ctx) => {
            const s = await this.sessionService.getSessionStatus(ctx.from.id.toString());
            await ctx.reply(`🔌 ${s}`);
        });
        this.bot.command('sync_groups', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            try {
                await ctx.reply('⏳ Syncing groups...');
                const result = await this.groupsService.fetchAndSyncGroups(ctx.from.id.toString());
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('my_groups', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            const groups = await this.groupsService.getGroups(ctx.from.id.toString());
            if (!groups.length)
                return ctx.reply('No groups yet. Use /sync_groups first.');
            const list = groups
                .map((g, i) => `${i + 1}. ${g.is_active ? '✅' : '❌'} *${g.group_name}*\n   ID: \`${g.group_id}\``)
                .join('\n\n');
            await ctx.replyWithMarkdown(`*📋 Groups (${groups.length}):*\n\n${list}`);
        });
        this.bot.command('add_message', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            this.pendingStates.set(ctx.from.id, { step: 'message_content', type: 'text' });
            await ctx.reply('📝 Send your message text now.\nOr send a photo/document with caption for media.', telegraf_1.Markup.keyboard([['❌ Cancel']]).oneTime().resize());
        });
        this.bot.command('my_messages', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            const messages = await this.messagesService.getMessages(ctx.from.id.toString());
            if (!messages.length)
                return ctx.reply('No messages yet. Use /add_message.');
            const list = messages
                .map((m) => `[${m.id}] ${m.type === 'media' ? '🖼' : '📝'} ${(m.content ?? '').substring(0, 50)}`)
                .join('\n');
            await ctx.replyWithMarkdown(`*💬 Messages (${messages.length}):*\n\n\`\`\`\n${list}\n\`\`\``);
        });
        this.bot.command('del_message', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
                return ctx.reply('Usage: /del_message <id>');
            }
            try {
                const result = await this.messagesService.deleteMessage(ctx.from.id.toString(), parseInt(parts[1]));
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('set_schedule', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
                return ctx.reply('Usage: /set_schedule <seconds> [global|sequential]\n' +
                    'Example: /set_schedule 3600 sequential');
            }
            const interval = parseInt(parts[1]);
            const mode = (parts[2] === 'sequential' ? 'sequential' : 'global');
            try {
                await this.scheduleService.createSchedule(ctx.from.id.toString(), interval, mode);
                await ctx.reply(`✅ Schedule set!\n⏱ Every: ${interval}s\n🔄 Mode: ${mode}\n\nRun /start_schedule to begin.`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('start_schedule', async (ctx) => {
            if (!(await this.checkActive(ctx)))
                return;
            try {
                const result = await this.scheduleService.startSchedule(ctx.from.id.toString());
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('stop_schedule', async (ctx) => {
            try {
                const result = await this.scheduleService.stopSchedule(ctx.from.id.toString());
                await ctx.reply(result.message);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('schedule_status', async (ctx) => {
            const s = await this.scheduleService.getScheduleStatus(ctx.from.id.toString());
            if (!s.configured)
                return ctx.reply('No schedule configured. Use /set_schedule first.');
            await ctx.replyWithMarkdown(`*⏱ Schedule*\n\n` +
                `Running: ${s.is_running ? '✅' : '❌'}\n` +
                `Interval: ${s.interval}s\n` +
                `Mode: ${s.mode}\n` +
                `Last run: ${s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never'}`);
        });
    }
    registerAdminCommands() {
        this.bot.command('gen_code', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2 || isNaN(parseInt(parts[1]))) {
                return ctx.reply('Usage: /gen_code <days>\nExample: /gen_code 30');
            }
            const days = parseInt(parts[1]);
            try {
                const code = await this.authService.generateActivationCode(days);
                await ctx.replyWithMarkdown(`✅ *Activation Code Generated*\n\n` +
                    `Code: \`${code}\`\n` +
                    `Duration: *${days} days*\n\n` +
                    `Share this code with the subscriber.`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('gen_codes', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 3 || isNaN(parseInt(parts[1])) || isNaN(parseInt(parts[2]))) {
                return ctx.reply('Usage: /gen_codes <days> <count>\nExample: /gen_codes 30 5');
            }
            const days = parseInt(parts[1]);
            const count = Math.min(parseInt(parts[2]), 20);
            try {
                const codes = [];
                for (let i = 0; i < count; i++) {
                    codes.push(await this.authService.generateActivationCode(days));
                }
                const list = codes.map((c, i) => `${i + 1}. \`${c}\``).join('\n');
                await ctx.replyWithMarkdown(`✅ *${count} Codes Generated (${days} days each)*\n\n${list}`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('all_users', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            try {
                const users = await this.authService.getAllUsers();
                if (!users.length)
                    return ctx.reply('No users yet.');
                const now = new Date();
                const list = users
                    .map((u, i) => {
                    const active = u.is_active && u.subscription_end && u.subscription_end > now;
                    const exp = u.subscription_end ? new Date(u.subscription_end).toLocaleDateString() : 'None';
                    return `${i + 1}. ${active ? '✅' : '❌'} *${u.first_name ?? u.username ?? 'N/A'}*\n   ID: \`${u.telegram_id}\` | Until: ${exp}`;
                })
                    .join('\n\n');
                await ctx.replyWithMarkdown(`*👥 All Users (${users.length}):*\n\n${list}`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('user_info', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2)
                return ctx.reply('Usage: /user_info <telegram_id>');
            try {
                const info = await this.authService.getUserStatus(parts[1].trim());
                if (!info.registered)
                    return ctx.reply('User not found.');
                await ctx.replyWithMarkdown(`*👤 User Info*\n\n` +
                    `Active: ${info.is_active ? '✅' : '❌'}\n` +
                    `Subscription: ${info.subscription_end ? new Date(info.subscription_end).toLocaleDateString() : 'None'}\n` +
                    `Session: ${info.session_status}\n` +
                    `Groups: ${info.groups_count}\n` +
                    `Messages: ${info.messages_count}`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('ban_user', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2)
                return ctx.reply('Usage: /ban_user <telegram_id>');
            try {
                await this.authService.setUserActive(parts[1].trim(), false);
                await ctx.reply(`✅ User ${parts[1]} has been deactivated.`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('unban_user', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            const parts = ctx.message.text.split(' ');
            if (parts.length < 2)
                return ctx.reply('Usage: /unban_user <telegram_id>');
            try {
                await this.authService.setUserActive(parts[1].trim(), true);
                await ctx.reply(`✅ User ${parts[1]} has been reactivated.`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
        this.bot.command('stats', async (ctx) => {
            if (!(await this.checkOwner(ctx)))
                return;
            try {
                const stats = await this.authService.getSystemStats();
                await ctx.replyWithMarkdown(`*📊 System Statistics*\n\n` +
                    `👥 Total Users: *${stats.totalUsers}*\n` +
                    `✅ Active Subscriptions: *${stats.activeUsers}*\n` +
                    `❌ Inactive: *${stats.inactiveUsers}*\n` +
                    `🎟 Total Codes: *${stats.totalCodes}*\n` +
                    `🔓 Used Codes: *${stats.usedCodes}*\n` +
                    `🔒 Unused Codes: *${stats.unusedCodes}*\n` +
                    `💬 Total Messages: *${stats.totalMessages}*\n` +
                    `👥 Total Groups: *${stats.totalGroups}*`);
            }
            catch (e) {
                await ctx.reply(`❌ ${e.message}`);
            }
        });
    }
    registerTextHandler() {
        this.bot.on('text', async (ctx) => {
            const state = this.pendingStates.get(ctx.from.id);
            if (!state)
                return;
            if (ctx.message.text === '❌ Cancel') {
                this.pendingStates.delete(ctx.from.id);
                return ctx.reply('Cancelled.', telegraf_1.Markup.removeKeyboard());
            }
            if (state.step === 'phone') {
                const phone = ctx.message.text.trim();
                try {
                    const result = await this.sessionService.connectWithPhone(ctx.from.id.toString(), phone);
                    this.pendingStates.set(ctx.from.id, { step: 'otp', phone });
                    await ctx.reply(result.message, telegraf_1.Markup.removeKeyboard());
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`);
                }
                return;
            }
            if (state.step === 'otp') {
                const code = ctx.message.text.trim();
                try {
                    const result = await this.sessionService.verifyCode(ctx.from.id.toString(), code);
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(result.message);
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`);
                }
                return;
            }
            if (state.step === 'message_content') {
                try {
                    const msg = await this.messagesService.createMessage(ctx.from.id.toString(), {
                        type: 'text',
                        content: ctx.message.text,
                    });
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`✅ Message saved (ID: ${msg.id})`, telegraf_1.Markup.removeKeyboard());
                }
                catch (e) {
                    this.pendingStates.delete(ctx.from.id);
                    await ctx.reply(`❌ ${e.message}`);
                }
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
                const msg = await this.messagesService.createMessage(ctx.from.id.toString(), {
                    type: 'media',
                    content: caption,
                    file_id: photo.file_id,
                });
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply(`✅ Media message saved (ID: ${msg.id})`, telegraf_1.Markup.removeKeyboard());
            }
            catch (e) {
                this.pendingStates.delete(ctx.from.id);
                await ctx.reply(`❌ ${e.message}`);
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