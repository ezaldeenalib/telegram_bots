"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotModule = void 0;
const common_1 = require("@nestjs/common");
const bot_service_1 = require("./bot.service");
const auth_module_1 = require("../auth/auth.module");
const session_module_1 = require("../session/session.module");
const groups_module_1 = require("../groups/groups.module");
const messages_module_1 = require("../messages/messages.module");
const schedule_module_1 = require("../schedule/schedule.module");
let BotModule = class BotModule {
};
exports.BotModule = BotModule;
exports.BotModule = BotModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, session_module_1.SessionModule, groups_module_1.GroupsModule, messages_module_1.MessagesModule, schedule_module_1.SchedulingModule],
        providers: [bot_service_1.BotService],
    })
], BotModule);
//# sourceMappingURL=bot.module.js.map