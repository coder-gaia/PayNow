import 'reflect-metadata';
import './bigint-serialization';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import type { Env } from './config/env';

/** Rotas de infraestrutura ficam fora do versionamento da API publica. */
const UNVERSIONED_ROUTES = ['health/live', 'health/ready'];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('v1', { exclude: UNVERSIONED_ROUTES });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Encerramento gracioso: o Nest chama onModuleDestroy nos servicos, que
  // fecham as conexoes com PostgreSQL e Redis antes do processo morrer.
  app.enableShutdownHooks();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Paynow')
        .setDescription(
          'Motor de cobranca recorrente com ledger de partidas dobradas. ' +
            'O saldo nao e armazenado: e derivado do livro contabil.',
        )
        .setVersion('0.1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'usuario')
        .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header' }, 'merchant')
        .build(),
    ),
    { jsonDocumentUrl: 'docs/openapi.json' },
  );

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Paynow no ar em http://localhost:${port}`);
  logger.log(`Documentacao em http://localhost:${port}/docs`);
  logger.log(
    config.get('WORKER_ENABLED', { infer: true })
      ? 'Worker ligado no mesmo processo (ADR-0012)'
      : 'Worker desligado neste processo',
  );
}

void bootstrap();
