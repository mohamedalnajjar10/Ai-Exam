import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common';

async function createApp() {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(express()),
  );

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Exam Prep AI Assistant')
    .setDescription('API documentation for the Exam Prep AI Assistant')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'refresh-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    customCssUrl: [
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui.css',
    ],
    customJs: [
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui-bundle.js',
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.8/swagger-ui-standalone-preset.js',
    ],
  });

  await app.init();
  return app;
}

/* ========== التشغيل المحلي ========== */
async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 8087);
  console.log('Application started');
}

// يعمل محليًا فقط (node dist/main.js) ولا يعمل على Vercel
if (require.main === module) {
  bootstrap();
}

/* ========== التشغيل على Vercel ========== */
let server: any;

export default async function handler(req: any, res: any) {
  if (!server) {
    const app = await createApp();
    server = app.getHttpAdapter().getInstance(); // نسخة express
  }
  server(req, res);
}