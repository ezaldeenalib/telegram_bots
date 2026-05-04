import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createMessage(
    telegramId: string,
    data: { title?: string; type: string; content: string; file_id?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    const message = await this.prisma.message.create({
      data: {
        user_id: user.id,
        title: data.title ?? null,
        type: data.type,
        content: data.content,
        file_id: data.file_id ?? null,
      },
    });

    this.logger.log(`Message created for user ${telegramId}: ID=${message.id}`);
    return message;
  }

  async getMessages(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.message.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
    });
  }

  async getMessage(telegramId: string, messageId: number) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, user_id: user.id },
    });

    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  async updateMessage(
    telegramId: string,
    messageId: number,
    data: Partial<{ title: string; content: string; file_id: string; type: string }>,
  ) {
    await this.getMessage(telegramId, messageId);

    return this.prisma.message.update({
      where: { id: messageId },
      data,
    });
  }

  async deleteMessage(telegramId: string, messageId: number) {
    await this.getMessage(telegramId, messageId);

    await this.prisma.message.delete({ where: { id: messageId } });
    return { message: '🗑️ Message deleted.' };
  }

  async getMessagesByUserId(userId: number) {
    return this.prisma.message.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
    });
  }
}
