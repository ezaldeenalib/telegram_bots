import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
export declare class AuthService {
    private readonly prisma;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService);
    findOrCreateUser(telegramId: string, username?: string, firstName?: string): Promise<{
        id: number;
        created_at: Date;
        telegram_id: string;
        username: string | null;
        first_name: string | null;
        subscription_end: Date | null;
        is_active: boolean;
        updated_at: Date;
    }>;
    activateWithCode(telegramId: string, code: string): Promise<{
        message: string;
        subscription_end: Date;
    }>;
    getUserStatus(telegramId: string): Promise<{
        registered: boolean;
        is_active?: undefined;
        subscription_end?: undefined;
        session_status?: undefined;
        groups_count?: undefined;
        messages_count?: undefined;
    } | {
        registered: boolean;
        is_active: boolean;
        subscription_end: Date | null;
        session_status: string;
        groups_count: number;
        messages_count: number;
    }>;
    isUserActive(telegramId: string): Promise<boolean>;
    getAllUsers(): Promise<{
        id: number;
        created_at: Date;
        telegram_id: string;
        username: string | null;
        first_name: string | null;
        subscription_end: Date | null;
        is_active: boolean;
    }[]>;
    setUserActive(telegramId: string, active: boolean): Promise<void>;
    getSystemStats(): Promise<{
        totalUsers: number;
        activeUsers: number;
        inactiveUsers: number;
        totalCodes: number;
        usedCodes: number;
        unusedCodes: number;
        totalMessages: number;
        totalGroups: number;
    }>;
    generateActivationCode(durationDays: number, expiresInDays?: number): Promise<string>;
}
