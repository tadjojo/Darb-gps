import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : true,
    credentials: true,
  });

  const port = process.env.PORT || 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`DARB GPS API running on port ${port}`);
}

bootstrap();
