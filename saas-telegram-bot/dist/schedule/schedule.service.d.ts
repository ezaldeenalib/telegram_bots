import type { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { GroupsService } from '../groups/groups.service';
import { MessagesService } from '../messages/messages.service';
export declare const SEND_MESSAGE_QUEUE = "send-message";
export declare class ScheduleService {
    private readonly sendQueue;
    private readonly prisma;
    private readonly sessionService;
    private readonly groupsService;
    private readonly messagesService;
    private readonly logger;
    constructor(sendQueue: Queue, prisma: PrismaService, sessionService: SessionService, groupsService: GroupsService, messagesService: MessagesService);
    createSchedule(telegramId: string, interval: number, mode?: 'global' | 'sequential'): Promise<{
        id: number;
        user_id: number;
        created_at: Date;
        updated_at: Date;
        interval: number;
        mode: string;
        message_index: number;
        is_running: boolean;
        last_run_at: Date | null;
    }>;
    startSchedule(telegramId: string): Promise<{
        message: string;
    }>;
    stopSchedule(telegramId: string): Promise<{
        message: string;
    }>;
    getScheduleStatus(telegramId: string): Promise<{
        configured: boolean;
        is_running?: undefined;
        interval?: undefined;
        mode?: undefined;
        last_run_at?: undefined;
    } | {
        configured: boolean;
        is_running: boolean;
        interval: number;
        mode: string;
        last_run_at: Date | null;
    }>;
    private enqueueJob;
    processSendJob(userId: number): Promise<void>;
}
