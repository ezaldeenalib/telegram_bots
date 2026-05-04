import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
    return { synced, message: `تم استيراد ${synced} مجموعة إلى حسابك.` };
  }

  /**
   * Resolve a group/channel by ID or @username via MTProto and save it for this bot user.
   * Requires an active gramJS session. User must be a member of the target chat.
   */
  async addGroupByPeerInput(
    telegramId: string,
    rawInput: string,
  ): Promise<{ message: string; group_id: string; group_name: string }> {
    const client = await this.sessionService.getClient(telegramId);
    if (!client) {
      throw new NotFoundException('لا توجد جلسة MTProto نشطة. اربط حسابك من «إدارة الجلسات» أولاً.');
    }

    const user = await this.prisma.user.findUnique({ where: { telegram_id: telegramId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود.');

    const input = rawInput.trim();
    if (!input) throw new BadRequestException('أرسل معرّف المجموعة أو رابطها.');

    let entity: Api.Chat | Api.Channel;
    try {
      const resolved = await client.getEntity(input);
      if (resolved instanceof Api.Chat || resolved instanceof Api.Channel) {
        entity = resolved;
      } else {
        throw new BadRequestException('هذا المعرف ليس مجموعة أو قناة.');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`[addGroupByPeerInput] getEntity failed for ${telegramId}: ${(e as Error).message}`);
      throw new BadRequestException(
        'تعذّر العثور على المجموعة. تأكد من المعرف، وأن حسابك المربوط عضو فيها.',
      );
    }

    let groupId: string;
    let groupName: string;

    if (entity instanceof Api.Chat) {
      groupId = entity.id.toString();
      groupName = entity.title ?? 'مجموعة';
    } else {
      groupId = entity.id.toString();
      groupName = entity.title ?? 'قناة';
    }

    await this.prisma.group.upsert({
      where: { user_id_group_id: { user_id: user.id, group_id: groupId } },
      create: { user_id: user.id, group_id: groupId, group_name: groupName, is_active: true },
      update: { group_name: groupName, is_active: true },
    });

    this.logger.log(`[addGroupByPeerInput] user ${telegramId} added group ${groupId} (${groupName})`);
    return {
      message: `تمت إضافة «${groupName}» بنجاح.\nالمعرّف المخزّن: ${groupId}`,
      group_id: groupId,
      group_name: groupName,
    };
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
