import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
