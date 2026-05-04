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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ScheduleService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleService = exports.SEND_MESSAGE_QUEUE = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const prisma_service_1 = require("../prisma/prisma.service");
const session_service_1 = require("../session/session.service");
const groups_service_1 = require("../groups/groups.service");
const messages_service_1 = require("../messages/messages.service");
exports.SEND_MESSAGE_QUEUE = 'send-message';
let ScheduleService = ScheduleService_1 = class ScheduleService {
    sendQueue;
    prisma;
    sessionService;
    groupsService;
    messagesService;
    logger = new common_1.Logger(ScheduleService_1.name);
    constructor(sendQueue, prisma, sessionService, groupsService, messagesService) {
        this.sendQueue = sendQueue;
        this.prisma = prisma;
        this.sessionService = sessionService;
        this.groupsService = groupsService;
        this.messagesService = messagesService;
    }
    async createSchedule(telegramId, interval, mode = 'global') {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const existing = await this.prisma.schedule.findFirst({ where: { user_id: user.id } });
        if (existing) {
            return this.prisma.schedule.update({
                where: { id: existing.id },
                data: { interval, mode },
            });
        }
        return this.prisma.schedule.create({
            data: { user_id: user.id, interval, mode },
        });
    }
    async startSchedule(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const schedule = await this.prisma.schedule.findFirst({ where: { user_id: user.id } });
        if (!schedule)
            throw new common_1.BadRequestException('No schedule configured. Use /set_schedule first.');
        if (schedule.is_running) {
            return { message: '⚠️ Schedule is already running.' };
        }
        await this.prisma.schedule.update({
            where: { id: schedule.id },
            data: { is_running: true },
        });
        await this.enqueueJob(user.id, schedule.interval);
        this.logger.log(`Schedule started for user ${telegramId} every ${schedule.interval}s`);
        return { message: `✅ Schedule started! Sending every ${schedule.interval} seconds.` };
    }
    async stopSchedule(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        await this.prisma.schedule.updateMany({
            where: { user_id: user.id },
            data: { is_running: false },
        });
        const jobs = await this.sendQueue.getJobs(['delayed', 'waiting', 'active']);
        for (const job of jobs) {
            if (job.data?.userId === user.id) {
                await job.remove();
            }
        }
        this.logger.log(`Schedule stopped for user ${telegramId}`);
        return { message: '⏹️ Schedule stopped.' };
    }
    async getScheduleStatus(telegramId) {
        const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
        if (!user)
            return { configured: false };
        const schedule = await this.prisma.schedule.findFirst({ where: { user_id: user.id } });
        if (!schedule)
            return { configured: false };
        return {
            configured: true,
            is_running: schedule.is_running,
            interval: schedule.interval,
            mode: schedule.mode,
            last_run_at: schedule.last_run_at,
        };
    }
    async enqueueJob(userId, intervalSeconds) {
        await this.sendQueue.add('send', { userId }, { delay: intervalSeconds * 1000, attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
    }
    async processSendJob(userId) {
        const schedule = await this.prisma.schedule.findFirst({
            where: { user_id: userId, is_running: true },
        });
        if (!schedule)
            return;
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return;
        const now = new Date();
        if (!user.is_active || !user.subscription_end || user.subscription_end < now) {
            await this.prisma.schedule.update({
                where: { id: schedule.id },
                data: { is_running: false },
            });
            this.logger.warn(`Schedule halted for user ${userId}: subscription expired`);
            return;
        }
        const client = await this.sessionService.getClient(user.telegram_id);
        if (!client) {
            this.logger.warn(`No active client for user ${userId}, skipping`);
            await this.enqueueJob(userId, schedule.interval);
            return;
        }
        const groupIds = await this.groupsService.getActiveGroupIds(userId);
        const messages = await this.messagesService.getMessagesByUserId(userId);
        if (groupIds.length === 0 || messages.length === 0) {
            this.logger.warn(`No groups or messages for user ${userId}`);
            await this.enqueueJob(userId, schedule.interval);
            return;
        }
        let messageToSend = messages[0];
        if (schedule.mode === 'sequential') {
            const idx = schedule.message_index % messages.length;
            messageToSend = messages[idx];
            await this.prisma.schedule.update({
                where: { id: schedule.id },
                data: { message_index: idx + 1, last_run_at: now },
            });
        }
        else {
            await this.prisma.schedule.update({
                where: { id: schedule.id },
                data: { last_run_at: now },
            });
        }
        let sent = 0;
        for (const groupId of groupIds) {
            try {
                if (messageToSend.type === 'text') {
                    await client.sendMessage(groupId, { message: messageToSend.content });
                }
                else if (messageToSend.type === 'media' && messageToSend.file_id) {
                    await client.sendMessage(groupId, {
                        message: messageToSend.content,
                        file: messageToSend.file_id,
                    });
                }
                sent++;
                await new Promise((r) => setTimeout(r, 500));
            }
            catch (error) {
                this.logger.error(`Failed to send to group ${groupId}: ${error.message}`);
            }
        }
        this.logger.log(`Sent to ${sent}/${groupIds.length} groups for user ${userId}`);
        const updatedSchedule = await this.prisma.schedule.findFirst({ where: { id: schedule.id } });
        if (updatedSchedule?.is_running) {
            await this.enqueueJob(userId, schedule.interval);
        }
    }
};
exports.ScheduleService = ScheduleService;
exports.ScheduleService = ScheduleService = ScheduleService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_1.InjectQueue)(exports.SEND_MESSAGE_QUEUE)),
    __metadata("design:paramtypes", [Object, prisma_service_1.PrismaService,
        session_service_1.SessionService,
        groups_service_1.GroupsService,
        messages_service_1.MessagesService])
], ScheduleService);
//# sourceMappingURL=schedule.service.js.map