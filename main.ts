import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', 'api/v1').replace(/^\/+|\/+$/g, '');

  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));

  const origins = config.get<string>('CORS_ORIGINS', '')
    .split(',').map((value: string) => value.trim()).filter(Boolean);
  app.enableCors({
    origin: config.get<string>('NODE_ENV') === 'production' ? origins : origins.length ? origins : false,
    credentials: true,
  });

  app.enableShutdownHooks();
  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}

void bootstrap();
