"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ScheduleProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleProcessor = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const schedule_service_1 = require("./schedule.service");
let ScheduleProcessor = ScheduleProcessor_1 = class ScheduleProcessor {
    scheduleService;
    logger = new common_1.Logger(ScheduleProcessor_1.name);
    constructor(scheduleService) {
        this.scheduleService = scheduleService;
    }
    async handleSend(job) {
        this.logger.debug(`Processing job for userId: ${job.data.userId}`);
        try {
            await this.scheduleService.processSendJob(job.data.userId);
        }
        catch (error) {
            this.logger.error(`Job failed for userId ${job.data.userId}: ${error.message}`);
            throw error;
        }
    }
};
exports.ScheduleProcessor = ScheduleProcessor;
__decorate([
    (0, bull_1.Process)('send'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ScheduleProcessor.prototype, "handleSend", null);
exports.ScheduleProcessor = ScheduleProcessor = ScheduleProcessor_1 = __decorate([
    (0, bull_1.Processor)(schedule_service_1.SEND_MESSAGE_QUEUE),
    __metadata("design:paramtypes", [schedule_service_1.ScheduleService])
], ScheduleProcessor);
//# sourceMappingURL=schedule.processor.js.map