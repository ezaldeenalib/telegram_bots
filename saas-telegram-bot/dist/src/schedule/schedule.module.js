"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulingModule = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const schedule_service_1 = require("./schedule.service");
const schedule_processor_1 = require("./schedule.processor");
const session_module_1 = require("../session/session.module");
const groups_module_1 = require("../groups/groups.module");
const messages_module_1 = require("../messages/messages.module");
let SchedulingModule = class SchedulingModule {
};
exports.SchedulingModule = SchedulingModule;
exports.SchedulingModule = SchedulingModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bull_1.BullModule.registerQueue({ name: schedule_service_1.SEND_MESSAGE_QUEUE }),
            session_module_1.SessionModule,
            groups_module_1.GroupsModule,
            messages_module_1.MessagesModule,
        ],
        providers: [schedule_service_1.ScheduleService, schedule_processor_1.ScheduleProcessor],
        exports: [schedule_service_1.ScheduleService],
    })
], SchedulingModule);
//# sourceMappingURL=schedule.module.js.map