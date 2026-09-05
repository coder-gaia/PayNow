import 'reflect-metadata';
import './bigint-serialization';

import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import type { Env } from './config/env';

/** Rotas de infraestrutura ficam fora do versionamento da API pública. */
const UNVERSIONED_ROUTES = ['health/live', 'health/ready'];

async function bootstrap(): Promise<void> {
  // `rawBody` guarda os bytes exatos da requisição ao lado do corpo parseado.
  // O webhook de entrada precisa deles: a assinatura do provedor cobre o que
  // chegou, e `JSON.parse` seguido de `JSON.stringify` reordena as chaves, o
  // que faria toda entrega legítima ser recusada.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService<Env, true>);

  /**
   * Cabeçalhos de segurança.
   *
   * `contentSecurityPolicy` fica desligado porque esta aplicação serve JSON e a
   * documentação do Swagger, que carrega os próprios scripts. Uma CSP montada
   * às pressas para caber no Swagger seria uma CSP que não protege nada e dá a
   * impressão contrária.
   *
   * `crossOriginEmbedderPolicy` também sai: ele quebra a página do Swagger e
   * não defende nada que importe aqui.
   */
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  const origens = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origem) => origem.trim())
    .filter((origem) => origem !== '');

  if (origens.length > 0) {
    // `credentials` porque o painel manda cookie. É exatamente por isso que a
    // lista é explícita: com credencial, um `*` libera qualquer site a agir em
    // nome de quem estiver logado.
    app.enableCors({ origin: origens, credentials: true });
  }

  app.setGlobalPrefix('v1', { exclude: UNVERSIONED_ROUTES });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Encerramento gracioso: o Nest chama onModuleDestroy nos serviços, que
  // fecham as conexões com PostgreSQL e Redis antes do processo morrer.
  app.enableShutdownHooks();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Paynow')
        .setDescription(
          'Motor de cobrança recorrente com ledger de partidas dobradas. ' +
            'O saldo não é armazenado: é derivado do livro contábil.',
        )
        .setVersion('0.1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'usuário')
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
