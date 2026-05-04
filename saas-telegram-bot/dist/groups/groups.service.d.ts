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
    addGroupByPeerInput(telegramId: string, rawInput: string): Promise<{
        message: string;
        group_id: string;
        group_name: string;
    }>;
    getGroups(telegramId: string): Promise<{
        id: number;
        user_id: number;
        group_id: string;
        group_name: string;
        is_active: boolean;
        created_at: Date;
    }[]>;
    toggleGroup(telegramId: string, groupId: string, isActive: boolean): Promise<{
        id: number;
        user_id: number;
        group_id: string;
        group_name: string;
        is_active: boolean;
        created_at: Date;
    }>;
    deleteGroup(telegramId: string, groupId: string): Promise<{
        message: string;
    }>;
    getActiveGroupIds(userId: number): Promise<string[]>;
}
