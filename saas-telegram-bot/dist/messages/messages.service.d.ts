import { PrismaService } from '../prisma/prisma.service';
export declare class MessagesService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    createMessage(telegramId: string, data: {
        title?: string;
        type: string;
        content: string;
        file_id?: string;
    }): Promise<{
        id: number;
        created_at: Date;
        updated_at: Date;
        user_id: number;
        title: string | null;
        type: string;
        content: string;
        file_id: string | null;
    }>;
    getMessages(telegramId: string): Promise<{
        id: number;
        created_at: Date;
        updated_at: Date;
        user_id: number;
        title: string | null;
        type: string;
        content: string;
        file_id: string | null;
    }[]>;
    getMessage(telegramId: string, messageId: number): Promise<{
        id: number;
        created_at: Date;
        updated_at: Date;
        user_id: number;
        title: string | null;
        type: string;
        content: string;
        file_id: string | null;
    }>;
    updateMessage(telegramId: string, messageId: number, data: Partial<{
        title: string;
        content: string;
        file_id: string;
        type: string;
    }>): Promise<{
        id: number;
        created_at: Date;
        updated_at: Date;
        user_id: number;
        title: string | null;
        type: string;
        content: string;
        file_id: string | null;
    }>;
    deleteMessage(telegramId: string, messageId: number): Promise<{
        message: string;
    }>;
    getMessagesByUserId(userId: number): Promise<{
        id: number;
        created_at: Date;
        updated_at: Date;
        user_id: number;
        title: string | null;
        type: string;
        content: string;
        file_id: string | null;
    }[]>;
}
