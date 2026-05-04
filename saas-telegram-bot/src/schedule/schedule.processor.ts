import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { SEND_MESSAGE_QUEUE, ScheduleService } from './schedule.service';

@Processor(SEND_MESSAGE_QUEUE)
export class ScheduleProcessor {
  private readonly logger = new Logger(ScheduleProcessor.name);

  constructor(private readonly scheduleService: ScheduleService) {}

  @Process('send')
  async handleSend(job: Job<{ userId: number }>) {
    this.logger.debug(`Processing job for userId: ${job.data.userId}`);
    try {
      await this.scheduleService.processSendJob(job.data.userId);
    } catch (error) {
      this.logger.error(`Job failed for userId ${job.data.userId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
