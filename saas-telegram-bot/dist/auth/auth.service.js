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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const config_1 = require("@nestjs/config");
let AuthService = AuthService_1 = class AuthService {
    prisma;
    config;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    async findOrCreateUser(telegramId, username, firstName) {
        let user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
        });
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    telegram_id: telegramId,
                    username: username ?? null,
                    first_name: firstName ?? null,
                    is_active: false,
                },
            });
            this.logger.log(`New user registered: ${telegramId}`);
        }
        return user;
    }
    async activateWithCode(telegramId, code) {
        const activationCode = await this.prisma.activationCode.findUnique({
            where: { code },
        });
        if (!activationCode) {
            throw new common_1.NotFoundException('Activation code not found');
        }
        if (activationCode.is_used) {
            throw new common_1.BadRequestException('This code has already been used');
        }
        if (activationCode.expires_at && activationCode.expires_at < new Date()) {
            throw new common_1.BadRequestException('This code has expired');
        }
        const user = await this.findOrCreateUser(telegramId);
        const now = new Date();
        const currentEnd = user.subscription_end && user.subscription_end > now
            ? user.subscription_end
            : now;
        const newEnd = new Date(currentEnd);
        newEnd.setDate(newEnd.getDate() + activationCode.duration_days);
        await this.prisma.$transaction([
            this.prisma.activationCode.update({
                where: { code },
                data: {
                    is_used: true,
                    used_by_id: user.id,
                    used_at: now,
                },
            }),
            this.prisma.user.update({
                where: { id: user.id },
                data: {
                    is_active: true,
                    subscription_end: newEnd,
                },
            }),
        ]);
        this.logger.log(`User ${telegramId} activated. Subscription until: ${newEnd.toISOString()}`);
        return {
            message: `✅ Account activated! Subscription valid until: ${newEnd.toLocaleDateString()}`,
            subscription_end: newEnd,
        };
    }
    async getUserStatus(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            include: {
                sessions: { select: { status: true } },
                _count: { select: { groups: true, messages: true } },
            },
        });
        if (!user) {
            return { registered: false };
        }
        const now = new Date();
        const isSubscriptionActive = user.subscription_end
            ? user.subscription_end > now
            : false;
        if (user.is_active && !isSubscriptionActive) {
            await this.prisma.user.update({
                where: { id: user.id },
                data: { is_active: false },
            });
        }
        return {
            registered: true,
            is_active: user.is_active && isSubscriptionActive,
            subscription_end: user.subscription_end,
            session_status: user.sessions[0]?.status ?? 'none',
            groups_count: user._count.groups,
            messages_count: user._count.messages,
        };
    }
    async isUserActive(telegramId) {
        const user = await this.prisma.user.findUnique({
            where: { telegram_id: telegramId },
            select: { is_active: true, subscription_end: true },
        });
        if (!user || !user.is_active)
            return false;
        if (!user.subscription_end)
            return false;
        return user.subscription_end > new Date();
    }
    async getAllUsers() {
        return this.prisma.user.findMany({
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                telegram_id: true,
                username: true,
                first_name: true,
                is_active: true,
                subscription_end: true,
                created_at: true,
            },
        });
    }
    async setUserActive(telegramId, active) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException(`User ${telegramId} not found`);
        await this.prisma.user.update({
            where: { id: user.id },
            data: { is_active: active },
        });
    }
    async getSystemStats() {
        const [totalUsers, activeUsers, totalCodes, usedCodes, totalMessages, totalGroups] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.user.count({
                where: { is_active: true, subscription_end: { gt: new Date() } },
            }),
            this.prisma.activationCode.count(),
            this.prisma.activationCode.count({ where: { is_used: true } }),
            this.prisma.message.count(),
            this.prisma.group.count(),
        ]);
        return {
            totalUsers,
            activeUsers,
            inactiveUsers: totalUsers - activeUsers,
            totalCodes,
            usedCodes,
            unusedCodes: totalCodes - usedCodes,
            totalMessages,
            totalGroups,
        };
    }
    async generateActivationCode(durationDays, expiresInDays) {
        const { randomBytes } = await import('crypto');
        const code = randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = expiresInDays
            ? new Date(Date.now() + expiresInDays * 86400000)
            : null;
        await this.prisma.activationCode.create({
            data: {
                code,
                duration_days: durationDays,
                expires_at: expiresAt,
            },
        });
        return code;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map