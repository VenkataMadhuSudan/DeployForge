import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadConfig } from '@deployforge/configuration';
import { AppLogger } from '@deployforge/logging';

async function bootstrap() {
  const config = loadConfig();
  const logger = new AppLogger('DeployForgeAPI');

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: [config.PUBLIC_APP_URL, 'http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-GitHub-Delivery', 'X-GitHub-Event', 'X-Hub-Signature-256'],
    },
    rawBody: true, // Needed for HMAC raw body webhook verification
  });

  app.use(cookieParser());
  app.setGlobalPrefix(config.API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // OpenAPI Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DeployForge API')
    .setDescription('Automated Website Deployment & Management Platform API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.PORT);
  logger.info(`DeployForge API listening on http://localhost:${config.PORT}/${config.API_PREFIX}`);
  logger.info(`Swagger API Docs available at http://localhost:${config.PORT}/docs`);
}

bootstrap();
