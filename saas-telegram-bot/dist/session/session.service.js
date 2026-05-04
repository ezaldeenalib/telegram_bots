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
var SessionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const config_1 = require("@nestjs/config");
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
const Logger_1 = require("telegram/extensions/Logger");
const encryption_util_1 = require("../common/encryption.util");
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
let SessionService = SessionService_1 = class SessionService {
    prisma;
    config;
    logger = new common_1.Logger(SessionService_1.name);
    activeClients = new Map();
    pendingLogins = new Map();
    rateLimits = new Map();
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    getApiId() {
        return parseInt(this.config.get('TELEGRAM_API_ID') ?? '0', 10);
    }
    getApiHash() {
        return this.config.get('TELEGRAM_API_HASH') ?? '';
    }
    makeClientKey(telegramId, sessionId) {
        return `${telegramId}_${sessionId}`;
    }
    buildClient(sessionStr) {
        return new telegram_1.TelegramClient(new sessions_1.StringSession(sessionStr), this.getApiId(), this.getApiHash(), {
            connectionRetries: 3,
            baseLogger: new Logger_1.Logger(Logger_1.LogLevel.NONE),
        });
    }
    checkRateLimit(telegramId) {
        const now = Date.now();
        const entry = this.rateLimits.get(telegramId);
        if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            this.rateLimits.set(telegramId, { count: 1, windowStart: now });
            return;
        }
        if (entry.count >= RATE_LIMIT_MAX) {
            const remaining = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 60000);
            throw new common_1.HttpException(`تجاوزت الحد المسموح به. انتظر ${remaining} دقيقة وأعد المحاولة.`, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        entry.count++;
    }
    async getUserOrThrow(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
        });
        if (!user)
            throw new common_1.NotFoundException('المستخدم غير موجود.');
        return user;
    }
    async addSessionString(telegramId, rawSessionString, label = 'جلسة جديدة') {
        this.checkRateLimit(telegramId);
        const sessionStr = rawSessionString.trim();
        if (!sessionStr || sessionStr.length < 20) {
            throw new common_1.BadRequestException('الجلسة المُرسلة قصيرة جداً أو غير صالحة.');
        }
        const client = this.buildClient(sessionStr);
        let me;
        try {
            await client.connect();
            me = await client.getMe();
        }
        catch (err) {
            try {
                await client.disconnect();
            }
            catch { }
            this.logger.warn(`[addSessionString] invalid session for user ${telegramId}: ${err.message.substring(0, 60)}`);
            throw new common_1.BadRequestException('❌ الجلسة غير صالحة أو منتهية. تأكد من صحة Session String.');
        }
        const accountName = me.username ? `@${me.username}` : (me.firstName ?? 'غير معروف');
        const accountId = me.id?.toString() ?? '';
        const user = await this.getUserOrThrow(telegramId);
        const encryptedSession = (0, encryption_util_1.encrypt)(sessionStr);
        const saved = await this.prisma.session.create({
            data: {
                user_id: user.id,
                label,
                session_string: encryptedSession,
                account_name: accountName,
                account_id: accountId,
                source: 'string',
                status: 'connected',
            },
        });
        const key = this.makeClientKey(telegramId, saved.id);
        this.activeClients.set(key, client);
        this.logger.log(`[addSessionString] session #${saved.id} added for user ${telegramId} → ${accountName}`);
        return {
            message: `✅ تم ربط حسابك بنجاح!\n` +
                `👤 الحساب: ${accountName}\n` +
                `🆔 المعرف: ${accountId}`,
            accountName,
            accountId,
        };
    }
    async connectWithPhone(telegramId, phone) {
        const apiId = this.getApiId();
        const apiHash = this.getApiHash();
        const client = this.buildClient('');
        await client.connect();
        const result = await client.sendCode({ apiId, apiHash }, phone);
        this.pendingLogins.set(telegramId, {
            client,
            phone,
            phoneCodeHash: result.phoneCodeHash,
        });
        return {
            phoneCodeHash: result.phoneCodeHash,
            message: '✅ تم إرسال رمز التحقق إلى هاتفك!',
        };
    }
    async verifyCode(telegramId, code) {
        const pending = this.pendingLogins.get(telegramId);
        if (!pending) {
            throw new common_1.BadRequestException('لا توجد جلسة معلقة. ابدأ بـ /connect أولاً.');
        }
        const { client, phone, phoneCodeHash } = pending;
        try {
            await client.invoke(new telegram_1.Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
            const sessionStr = client.session.save();
            const encryptedSession = (0, encryption_util_1.encrypt)(sessionStr);
            const user = await this.getUserOrThrow(telegramId);
            const saved = await this.prisma.session.create({
                data: {
                    user_id: user.id,
                    label: `هاتف ${phone}`,
                    session_string: encryptedSession,
                    phone,
                    source: 'phone',
                    status: 'connected',
                },
            });
            const key = this.makeClientKey(telegramId, saved.id);
            this.activeClients.set(key, client);
            this.pendingLogins.delete(telegramId);
            this.logger.log(`[verifyCode] phone session #${saved.id} for user ${telegramId}`);
            return { message: '✅ تم تسجيل الدخول بنجاح!' };
        }
        catch (error) {
            this.pendingLogins.delete(telegramId);
            throw new common_1.BadRequestException(`فشل تسجيل الدخول: ${error.message}`);
        }
    }
    async getClient(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            include: { sessions: { where: { status: 'connected' }, orderBy: { created_at: 'asc' } } },
        });
        if (!user || !user.sessions.length)
            return null;
        for (const session of user.sessions) {
            const key = this.makeClientKey(telegramId, session.id);
            const cached = this.activeClients.get(key);
            if (cached?.connected)
                return cached;
            try {
                const decrypted = (0, encryption_util_1.decrypt)(session.session_string);
                const client = this.buildClient(decrypted);
                await client.connect();
                this.activeClients.set(key, client);
                return client;
            }
            catch {
                await this.prisma.session.update({
                    where: { id: session.id },
                    data: { status: 'disconnected' },
                });
            }
        }
        return null;
    }
    async listSessions(telegramId) {
        const user = await this.getUserOrThrow(telegramId);
        return this.prisma.session.findMany({
            where: { user_id: user.id },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                label: true,
                account_name: true,
                account_id: true,
                phone: true,
                source: true,
                status: true,
                created_at: true,
            },
        });
    }
    async deleteSession(telegramId, sessionId) {
        const user = await this.getUserOrThrow(telegramId);
        const session = await this.prisma.session.findFirst({
            where: { id: sessionId, user_id: user.id },
        });
        if (!session)
            throw new common_1.NotFoundException('الجلسة غير موجودة.');
        const key = this.makeClientKey(telegramId, sessionId);
        const client = this.activeClients.get(key);
        if (client) {
            try {
                await client.disconnect();
            }
            catch { }
            this.activeClients.delete(key);
        }
        await this.prisma.session.delete({ where: { id: sessionId } });
        this.logger.log(`[deleteSession] session #${sessionId} deleted for user ${telegramId}`);
        return { message: `🗑️ تم حذف الجلسة "${session.label}" بنجاح.` };
    }
    async disconnectSession(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            return { message: '🔌 لا توجد جلسات.' };
        const sessions = await this.prisma.session.findMany({ where: { user_id: user.id } });
        for (const s of sessions) {
            const key = this.makeClientKey(telegramId, s.id);
            const client = this.activeClients.get(key);
            if (client) {
                try {
                    await client.disconnect();
                }
                catch { }
                this.activeClients.delete(key);
            }
        }
        await this.prisma.session.updateMany({
            where: { user_id: user.id },
            data: { status: 'disconnected' },
        });
        return { message: '🔌 تم قطع جميع الجلسات.' };
    }
    async getSessionStatus(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            include: {
                sessions: {
                    select: { id: true, label: true, status: true, account_name: true, phone: true },
                },
            },
        });
        if (!user || !user.sessions.length)
            return 'لا توجد جلسات مسجلة.';
        return user.sessions
            .map((s) => `#${s.id} | ${s.label} | ${s.status === 'connected' ? '🟢 متصل' : '🔴 غير متصل'}` +
            (s.account_name ? ` | ${s.account_name}` : '') +
            (s.phone ? ` | ${s.phone}` : ''))
            .join('\n');
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = SessionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], SessionService);
//# sourceMappingURL=session.service.js.map