import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { GroupsService } from '../groups/groups.service';
import { MessagesService } from '../messages/messages.service';
import { Api } from 'telegram';

export const SEND_MESSAGE_QUEUE = 'send-message';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    @InjectQueue(SEND_MESSAGE_QUEUE) private readonly sendQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly groupsService: GroupsService,
    private readonly messagesService: MessagesService,
  ) {}

  async createSchedule(
    telegramId: string,
    interval: number,
    mode: 'global' | 'sequential' = 'global',
  ) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

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

  async startSchedule(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    const schedule = await this.prisma.schedule.findFirst({ where: { user_id: user.id } });
    if (!schedule) throw new BadRequestException('No schedule configured. Use /set_schedule first.');

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

  async stopSchedule(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

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

  async getScheduleStatus(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) return { configured: false };

    const schedule = await this.prisma.schedule.findFirst({ where: { user_id: user.id } });
    if (!schedule) return { configured: false };

    return {
      configured: true,
      is_running: schedule.is_running,
      interval: schedule.interval,
      mode: schedule.mode,
      last_run_at: schedule.last_run_at,
    };
  }

  private async enqueueJob(userId: number, intervalSeconds: number) {
    await this.sendQueue.add(
      'send',
      { userId },
      { delay: intervalSeconds * 1000, attempts: 3, backoff: { type: 'fixed', delay: 5000 } },
    );
  }

  async processSendJob(userId: number) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { user_id: userId, is_running: true },
    });

    if (!schedule) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

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
    } else {
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
        } else if (messageToSend.type === 'media' && messageToSend.file_id) {
          await client.sendMessage(groupId, {
            message: messageToSend.content,
            file: messageToSend.file_id,
          });
        }
        sent++;
        await new Promise((r) => setTimeout(r, 500));
      } catch (error) {
        this.logger.error(`Failed to send to group ${groupId}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`Sent to ${sent}/${groupIds.length} groups for user ${userId}`);

    const updatedSchedule = await this.prisma.schedule.findFirst({ where: { id: schedule.id } });
    if (updatedSchedule?.is_running) {
      await this.enqueueJob(userId, schedule.interval);
    }
  }
}
