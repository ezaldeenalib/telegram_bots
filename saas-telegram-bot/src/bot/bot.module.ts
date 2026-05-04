import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import { GroupsModule } from '../groups/groups.module';
import { MessagesModule } from '../messages/messages.module';
import { SchedulingModule } from '../schedule/schedule.module';

@Module({
  imports: [AuthModule, SessionModule, GroupsModule, MessagesModule, SchedulingModule],
  providers: [BotService],
})
export class BotModule {}
