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
var MessagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let MessagesService = MessagesService_1 = class MessagesService {
    prisma;
    logger = new common_1.Logger(MessagesService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createMessage(telegramId, data) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const message = await this.prisma.message.create({
            data: {
                user_id: user.id,
                title: data.title ?? null,
                type: data.type,
                content: data.content,
                file_id: data.file_id ?? null,
            },
        });
        this.logger.log(`Message created for user ${telegramId}: ID=${message.id}`);
        return message;
    }
    async getMessages(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return this.prisma.message.findMany({
            where: { user_id: user.id },
            orderBy: { created_at: 'desc' },
        });
    }
    async getMessage(telegramId, messageId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const message = await this.prisma.message.findFirst({
            where: { id: messageId, user_id: user.id },
        });
        if (!message)
            throw new common_1.NotFoundException('Message not found');
        return message;
    }
    async updateMessage(telegramId, messageId, data) {
        await this.getMessage(telegramId, messageId);
        return this.prisma.message.update({
            where: { id: messageId },
            data,
        });
    }
    async deleteMessage(telegramId, messageId) {
        await this.getMessage(telegramId, messageId);
        await this.prisma.message.delete({ where: { id: messageId } });
        return { message: '🗑️ Message deleted.' };
    }
    async getMessagesByUserId(userId) {
        return this.prisma.message.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'asc' },
        });
    }
};
exports.MessagesService = MessagesService;
exports.MessagesService = MessagesService = MessagesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MessagesService);
//# sourceMappingURL=messages.service.js.map