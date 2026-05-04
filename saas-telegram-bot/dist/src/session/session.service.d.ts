import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { TelegramClient } from 'telegram';
export declare class SessionService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    private activeClients;
    private pendingLogins;
    constructor(prisma: PrismaService, config: ConfigService);
    private getApiId;
    private getApiHash;
    connectWithPhone(telegramId: string, phone: string): Promise<{
        phoneCodeHash: string;
        message: string;
    }>;
    verifyCode(telegramId: string, code: string): Promise<{
        message: string;
    }>;
    getClient(telegramId: string): Promise<TelegramClient | null>;
    disconnectSession(telegramId: string): Promise<{
        message: string;
    }>;
    getSessionStatus(telegramId: string): Promise<string>;
}
