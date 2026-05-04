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
var GroupsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const session_service_1 = require("../session/session.service");
const telegram_1 = require("telegram");
let GroupsService = GroupsService_1 = class GroupsService {
    prisma;
    sessionService;
    logger = new common_1.Logger(GroupsService_1.name);
    constructor(prisma, sessionService) {
        this.prisma = prisma;
        this.sessionService = sessionService;
    }
    async fetchAndSyncGroups(telegramId) {
        const client = await this.sessionService.getClient(telegramId);
        if (!client) {
            throw new common_1.NotFoundException('No active MTProto session. Please connect first.');
        }
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const dialogs = await client.getDialogs({ limit: 200 });
        let synced = 0;
        for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity instanceof telegram_1.Api.Chat ||
                entity instanceof telegram_1.Api.Channel) {
                const groupId = entity.id.toString();
                const groupName = dialog.title ?? 'Unknown Group';
                await this.prisma.group.upsert({
                    where: { user_id_group_id: { user_id: user.id, group_id: groupId } },
                    create: { user_id: user.id, group_id: groupId, group_name: groupName, is_active: true },
                    update: { group_name: groupName },
                });
                synced++;
            }
        }
        this.logger.log(`Synced ${synced} groups for user ${telegramId}`);
        return { synced, message: `✅ Synced ${synced} groups to your account.` };
    }
    async getGroups(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return this.prisma.group.findMany({
            where: { user_id: user.id },
            orderBy: { group_name: 'asc' },
        });
    }
    async toggleGroup(telegramId, groupId, isActive) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const group = await this.prisma.group.findFirst({
            where: { user_id: user.id, group_id: groupId },
        });
        if (!group)
            throw new common_1.NotFoundException('Group not found');
        return this.prisma.group.update({
            where: { id: group.id },
            data: { is_active: isActive },
        });
    }
    async deleteGroup(telegramId, groupId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        await this.prisma.group.deleteMany({
            where: { user_id: user.id, group_id: groupId },
        });
        return { message: '🗑️ Group removed.' };
    }
    async getActiveGroupIds(userId) {
        const groups = await this.prisma.group.findMany({
            where: { user_id: userId, is_active: true },
            select: { group_id: true },
        });
        return groups.map((g) => g.group_id);
    }
};
exports.GroupsService = GroupsService;
exports.GroupsService = GroupsService = GroupsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        session_service_1.SessionService])
], GroupsService);
//# sourceMappingURL=groups.service.js.map