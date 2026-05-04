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
const encryption_util_1 = require("../common/encryption.util");
let SessionService = SessionService_1 = class SessionService {
    prisma;
    config;
    logger = new common_1.Logger(SessionService_1.name);
    activeClients = new Map();
    pendingLogins = new Map();
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
    async connectWithPhone(telegramId, phone) {
        const apiId = this.getApiId();
        const apiHash = this.getApiHash();
        const client = new telegram_1.TelegramClient(new sessions_1.StringSession(''), apiId, apiHash, {
            connectionRetries: 3,
        });
        await client.connect();
        const result = await client.sendCode({ apiId, apiHash }, phone);
        this.pendingLogins.set(telegramId, {
            client,
            phone,
            phoneCodeHash: result.phoneCodeHash,
            resolve: () => { },
        });
        return {
            phoneCodeHash: result.phoneCodeHash,
            message: '✅ OTP sent to your phone! Use /verify_code <OTP> to complete login.',
        };
    }
    async verifyCode(telegramId, code) {
        const pending = this.pendingLogins.get(telegramId);
        if (!pending) {
            throw new common_1.BadRequestException('No pending login session. Start with /connect first.');
        }
        const { client, phone, phoneCodeHash } = pending;
        try {
            await client.invoke(new telegram_1.Api.auth.SignIn({
                phoneNumber: phone,
                phoneCodeHash,
                phoneCode: code,
            }));
            const sessionString = client.session.save();
            const encryptedSession = (0, encryption_util_1.encrypt)(sessionString);
            const user = await this.prisma.user.findUnique({
                where: { telegram_id: telegramId },
            });
            if (!user)
                throw new common_1.BadRequestException('User not found');
            await this.prisma.session.upsert({
                where: { user_id: user.id },
                create: { user_id: user.id, session_string: encryptedSession, phone, status: 'connected' },
                update: { session_string: encryptedSession, phone, status: 'connected' },
            });
            this.activeClients.set(telegramId, client);
            this.pendingLogins.delete(telegramId);
            this.logger.log(`Session saved for user ${telegramId}`);
            return { message: '✅ Account connected successfully!' };
        }
        catch (error) {
            this.pendingLogins.delete(telegramId);
            throw new common_1.BadRequestException(`Login failed: ${error.message}`);
        }
    }
    async getClient(telegramId) {
        const cached = this.activeClients.get(telegramId);
        if (cached?.connected)
            return cached;
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            include: { sessions: true },
        });
        if (!user || !user.sessions[0])
            return null;
        const decrypted = (0, encryption_util_1.decrypt)(user.sessions[0].session_string);
        const client = new telegram_1.TelegramClient(new sessions_1.StringSession(decrypted), this.getApiId(), this.getApiHash(), { connectionRetries: 3 });
        await client.connect();
        this.activeClients.set(telegramId, client);
        return client;
    }
    async disconnectSession(telegramId) {
        const client = this.activeClients.get(telegramId);
        if (client) {
            await client.disconnect();
            this.activeClients.delete(telegramId);
        }
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (user) {
            await this.prisma.session.updateMany({
                where: { user_id: user.id },
                data: { status: 'disconnected' },
            });
        }
        return { message: '🔌 Session disconnected.' };
    }
    async getSessionStatus(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            include: { sessions: { select: { status: true, phone: true } } },
        });
        if (!user || !user.sessions[0])
            return 'No session found';
        const s = user.sessions[0];
        return `Status: ${s.status} | Phone: ${s.phone ?? 'N/A'}`;
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = SessionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], SessionService);
//# sourceMappingURL=session.service.js.map