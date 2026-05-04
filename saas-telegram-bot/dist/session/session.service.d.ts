import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { TelegramClient } from 'telegram';
export declare class SessionService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    private activeClients;
    private pendingLogins;
    private rateLimits;
    constructor(prisma: PrismaService, config: ConfigService);
    private getApiId;
    private getApiHash;
    private makeClientKey;
    private buildClient;
    private checkRateLimit;
    private getUserOrThrow;
    addSessionString(telegramId: string, rawSessionString: string, label?: string): Promise<{
        message: string;
        accountName: string;
        accountId: string;
    }>;
    connectWithPhone(telegramId: string, phone: string): Promise<{
        phoneCodeHash: string;
        message: string;
    }>;
    verifyCode(telegramId: string, code: string): Promise<{
        message: string;
    }>;
    getClient(telegramId: string): Promise<TelegramClient | null>;
    listSessions(telegramId: string): Promise<{
        id: number;
        created_at: Date;
        label: string;
        phone: string | null;
        account_name: string | null;
        account_id: string | null;
        source: string;
        status: string;
    }[]>;
    deleteSession(telegramId: string, sessionId: number): Promise<{
        message: string;
    }>;
    disconnectSession(telegramId: string): Promise<{
        message: string;
    }>;
    getSessionStatus(telegramId: string): Promise<string>;
}
