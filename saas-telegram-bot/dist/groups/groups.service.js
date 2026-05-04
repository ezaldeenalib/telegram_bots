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
    async listDialogGroupsForImport(telegramId, max = 80) {
        const client = await this.sessionService.getClient(telegramId);
        if (!client) {
            throw new common_1.NotFoundException('لا توجد جلسة MTProto نشطة. اربط حسابك أولاً.');
        }
        const dialogs = await client.getDialogs({ limit: 200 });
        const items = [];
        for (const dialog of dialogs) {
            const entity = dialog.entity;
            if (entity instanceof telegram_1.Api.Chat || entity instanceof telegram_1.Api.Channel) {
                const groupId = entity.id.toString();
                const groupName = (dialog.title ?? 'مجموعة').replace(/\s+/g, ' ').trim().slice(0, 120);
                items.push({ group_id: groupId, group_name: groupName || 'مجموعة' });
            }
        }
        return items.slice(0, max);
    }
    async saveImportedGroupsSelection(telegramId, selected) {
        if (!selected.length) {
            throw new common_1.BadRequestException('لم يتم اختيار أي مجموعة. اضغط على المجموعات لتحديدها ☑');
        }
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('المستخدم غير موجود.');
        let saved = 0;
        for (const g of selected) {
            await this.prisma.group.upsert({
                where: { user_id_group_id: { user_id: user.id, group_id: g.group_id } },
                create: {
                    user_id: user.id,
                    group_id: g.group_id,
                    group_name: g.group_name.slice(0, 200),
                    is_active: true,
                },
                update: { group_name: g.group_name.slice(0, 200), is_active: true },
            });
            saved++;
        }
        this.logger.log(`[saveImportedGroupsSelection] user ${telegramId} saved ${saved} groups`);
        return { saved, message: `تمت إضافة ${saved} مجموعة إلى قائمتك.` };
    }
    async fetchAndSyncGroups(telegramId) {
        const list = await this.listDialogGroupsForImport(telegramId, 500);
        await this.saveImportedGroupsSelection(telegramId, list);
        return { synced: list.length, message: `تم استيراد ${list.length} مجموعة (الكل).` };
    }
    async addGroupByPeerInput(telegramId, rawInput) {
        const client = await this.sessionService.getClient(telegramId);
        if (!client) {
            throw new common_1.NotFoundException('لا توجد جلسة MTProto نشطة. اربط حسابك من «إدارة الجلسات» أولاً.');
        }
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('المستخدم غير موجود.');
        const input = rawInput.trim();
        if (!input)
            throw new common_1.BadRequestException('أرسل معرّف المجموعة أو رابطها.');
        let entity;
        try {
            const resolved = await client.getEntity(input);
            if (resolved instanceof telegram_1.Api.Chat || resolved instanceof telegram_1.Api.Channel) {
                entity = resolved;
            }
            else {
                throw new common_1.BadRequestException('هذا المعرف ليس مجموعة أو قناة.');
            }
        }
        catch (e) {
            if (e instanceof common_1.BadRequestException)
                throw e;
            this.logger.warn(`[addGroupByPeerInput] getEntity failed for ${telegramId}: ${e.message}`);
            throw new common_1.BadRequestException('تعذّر العثور على المجموعة. تأكد من المعرف، وأن حسابك المربوط عضو فيها.');
        }
        let groupId;
        let groupName;
        if (entity instanceof telegram_1.Api.Chat) {
            groupId = entity.id.toString();
            groupName = entity.title ?? 'مجموعة';
        }
        else {
            groupId = entity.id.toString();
            groupName = entity.title ?? 'قناة';
        }
        await this.prisma.group.upsert({
            where: { user_id_group_id: { user_id: user.id, group_id: groupId } },
            create: { user_id: user.id, group_id: groupId, group_name: groupName, is_active: true },
            update: { group_name: groupName, is_active: true },
        });
        this.logger.log(`[addGroupByPeerInput] user ${telegramId} added group ${groupId} (${groupName})`);
        return {
            message: `تمت إضافة «${groupName}» بنجاح.\nالمعرّف المخزّن: ${groupId}`,
            group_id: groupId,
            group_name: groupName,
        };
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
            throw new common_1.NotFoundException('المستخدم غير موجود.');
        await this.prisma.group.deleteMany({
            where: { user_id: user.id, group_id: groupId },
        });
        return { message: 'تمت إزالة المجموعة من قائمتك.' };
    }
    async deleteGroupByDbId(telegramId, prismaGroupId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('المستخدم غير موجود.');
        const group = await this.prisma.group.findFirst({
            where: { id: prismaGroupId, user_id: user.id },
        });
        if (!group)
            throw new common_1.NotFoundException('المجموعة غير موجودة أو لا تخصّك.');
        await this.prisma.group.delete({ where: { id: prismaGroupId } });
        this.logger.log(`[deleteGroupByDbId] user ${telegramId} deleted group #${prismaGroupId} (${group.group_id})`);
        return { message: `تم حذف «${group.group_name}» من قائمة البوت.` };
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