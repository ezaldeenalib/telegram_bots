import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleService, SEND_MESSAGE_QUEUE } from './schedule.service';
import { ScheduleProcessor } from './schedule.processor';
import { SessionModule } from '../session/session.module';
import { GroupsModule } from '../groups/groups.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: SEND_MESSAGE_QUEUE }),
    SessionModule,
    GroupsModule,
    MessagesModule,
  ],
  providers: [ScheduleService, ScheduleProcessor],
  exports: [ScheduleService],
})
export class SchedulingModule {}
