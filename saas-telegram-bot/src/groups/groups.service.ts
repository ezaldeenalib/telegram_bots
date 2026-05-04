import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { Api } from 'telegram';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async fetchAndSyncGroups(telegramId: string): Promise<{ synced: number; message: string }> {
    const client = await this.sessionService.getClient(telegramId);
    if (!client) {
      throw new NotFoundException('No active MTProto session. Please connect first.');
    }

    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    const dialogs = await client.getDialogs({ limit: 200 });
    let synced = 0;

    for (const dialog of dialogs) {
      const entity = dialog.entity;
      if (
        entity instanceof Api.Chat ||
        entity instanceof Api.Channel
      ) {
        const groupId = entity.id.toString();
        const groupName = dialog.title ?? 'Unknown Group';

        await this.prisma.group.upsert({
          where: { user_id_group_id: { user_id: user.id, group_id: groupId } },
          create: { user_id: user.id, group_id: groupId, group_name: groupName, is_active: true },
          update: { group_name: groupName },
        });
        synced++;
      }
    }

    this.logger.log(`Synced ${synced} groups for user ${telegramId}`);
    return { synced, message: `✅ Synced ${synced} groups to your account.` };
  }

  async getGroups(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.group.findMany({
      where: { user_id: user.id },
      orderBy: { group_name: 'asc' },
    });
  }

  async toggleGroup(telegramId: string, groupId: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    const group = await this.prisma.group.findFirst({
      where: { user_id: user.id, group_id: groupId },
    });

    if (!group) throw new NotFoundException('Group not found');

    return this.prisma.group.update({
      where: { id: group.id },
      data: { is_active: isActive },
    });
  }

  async deleteGroup(telegramId: string, groupId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.group.deleteMany({
      where: { user_id: user.id, group_id: groupId },
    });

    return { message: '🗑️ Group removed.' };
  }

  async getActiveGroupIds(userId: number): Promise<string[]> {
    const groups = await this.prisma.group.findMany({
      where: { user_id: userId, is_active: true },
      select: { group_id: true },
    });
    return groups.map((g) => g.group_id);
  }
}
