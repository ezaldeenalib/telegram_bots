import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
export declare class GroupsService {
    private readonly prisma;
    private readonly sessionService;
    private readonly logger;
    constructor(prisma: PrismaService, sessionService: SessionService);
    fetchAndSyncGroups(telegramId: string): Promise<{
        synced: number;
        message: string;
    }>;
    getGroups(telegramId: string): Promise<{
        id: number;
        created_at: Date;
        is_active: boolean;
        user_id: number;
        group_id: string;
        group_name: string;
    }[]>;
    toggleGroup(telegramId: string, groupId: string, isActive: boolean): Promise<{
        id: number;
        created_at: Date;
        is_active: boolean;
        user_id: number;
        group_id: string;
        group_name: string;
    }>;
    deleteGroup(telegramId: string, groupId: string): Promise<{
        message: string;
    }>;
    getActiveGroupIds(userId: number): Promise<string[]>;
}
