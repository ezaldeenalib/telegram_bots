import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3000);
  try {
    await app.listen(port);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'EADDRINUSE') {
      Logger.error(
        `Port ${port} is already in use. Stop the other process or set PORT in .env ` +
          `(e.g. PORT=3001). Linux: ss -tlnp | grep :${port}  then kill that PID.`,
        'Bootstrap',
      );
    }
    throw err;
  }

  Logger.log(`🚀 Application is running on: http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
