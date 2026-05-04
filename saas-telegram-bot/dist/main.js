"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const port = Number(process.env.PORT ?? 3000);
    try {
        await app.listen(port);
    }
    catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code === 'EADDRINUSE') {
            common_1.Logger.error(`Port ${port} is already in use. Stop the other process or set PORT in .env ` +
                `(e.g. PORT=3001). Linux: ss -tlnp | grep :${port}  then kill that PID.`, 'Bootstrap');
        }
        throw err;
    }
    common_1.Logger.log(`🚀 Application is running on: http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
//# sourceMappingURL=main.js.map