import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
export declare class GroupsService {
    private readonly prisma;
    private readonly sessionService;
    private readonly logger;
    constructor(prisma: PrismaService, sessionService: SessionService);
    listDialogGroupsForImport(telegramId: string, max?: number): Promise<{
        group_id: string;
        group_name: string;
    }[]>;
    saveImportedGroupsSelection(telegramId: string, selected: {
        group_id: string;
        group_name: string;
    }[]): Promise<{
        saved: number;
        message: string;
    }>;
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
        is_active: boolean;
        created_at: Date;
        user_id: number;
        group_id: string;
        group_name: string;
    }[]>;
    toggleGroup(telegramId: string, groupId: string, isActive: boolean): Promise<{
        id: number;
        is_active: boolean;
        created_at: Date;
        user_id: number;
        group_id: string;
        group_name: string;
    }>;
    deleteGroup(telegramId: string, groupId: string): Promise<{
        message: string;
    }>;
    deleteGroupByDbId(telegramId: string, prismaGroupId: number): Promise<{
        message: string;
    }>;
    getActiveGroupIds(userId: number): Promise<string[]>;
}
