import type { Job } from 'bull';
import { ScheduleService } from './schedule.service';
export declare class ScheduleProcessor {
    private readonly scheduleService;
    private readonly logger;
    constructor(scheduleService: ScheduleService);
    handleSend(job: Job<{
        userId: number;
    }>): Promise<void>;
}
