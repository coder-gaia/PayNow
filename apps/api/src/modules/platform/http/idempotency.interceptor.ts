import { createHash } from 'node:crypto';

import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { from, type Observable, of, switchMap, tap } from 'rxjs';

import { CLOCK, type Clock } from '../clock/clock';
import { addHours } from '../clock/duration';
import type { AuthenticatedRequest } from './auth-context';
import { PrismaService } from '../prisma/prisma.service';

const HEADER = 'idempotency-key';

/** Quanto tempo uma resposta fica guardada. O mesmo que o Stripe usa. */
const RETENTION_HOURS = 24;

/**
 * Idempotência de requisição, no modelo do Stripe.
 *
 * O problema é velho e não tem solução do lado do cliente. Um POST que cria
 * uma cobrança sai, a resposta se perde na rede, e quem chamou fica sem saber
 * se cobrou. Repetir pode cobrar duas vezes; não repetir pode deixar de cobrar.
 * A única saída é o servidor reconhecer a repetição.
 *
 * Funciona assim: quem chama escolhe uma chave e a envia no cabeçalho
 * `Idempotency-Key`. A primeira chamada executa e tem a resposta guardada. Uma
 * repetição com a mesma chave recebe aquela resposta de volta, sem executar
 * nada.
 *
 * Três decisões merecem nota.
 *
 * **É opcional.** Sem o cabeçalho, nada acontece, exatamente como no Stripe.
 * Forçar idempotência em toda rota obrigaria todo cliente a gerar chave até
 * para operações que não movem dinheiro.
 *
 * **A requisição é impressa em digital.** Reusar a mesma chave com um corpo
 * diferente é o erro mais comum de quem implementa idempotência do lado do
 * cliente, e o defeito é silencioso: a segunda chamada receberia a resposta da
 * primeira e quem chamou concluiria que cobrou o novo valor. Aqui isso é 422.
 *
 * **A chave é escopada por cliente.** Uma chave escolhida por um merchant não
 * colide com a de outro, e ninguém consegue adivinhar a chave alheia para ler
 * uma resposta que não é sua.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = request.header(HEADER);

    // Só POST. GET já é idempotente por definição, e DELETE repetido é
    // inofensivo: o recurso continua ausente.
    if (key === undefined || key.length === 0 || request.method !== 'POST') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return from(this.reservar(request, key)).pipe(
      switchMap((reserva) => {
        if (reserva.kind === 'repeticao') {
          response.status(reserva.status);
          response.setHeader('idempotent-replay', 'true');
          return of(reserva.body);
        }

        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.concluir(reserva.id, response.statusCode, body);
            },
            error: () => {
              // A reserva é apagada para que a repetição possa tentar de novo.
              //
              // Guardar a falha faria um erro transitório virar permanente
              // para aquela chave, e quem chamou não teria como sair disso a
              // não ser inventando uma chave nova, que é justamente o que a
              // idempotência existe para evitar.
              //
              // Isso reabre, em tese, a janela de cobrança em dobro: o handler
              // pode ter cobrado antes de falhar. Quem fecha essa janela é a
              // camada de baixo, onde a chave enviada ao provedor deriva da
              // fatura e da tentativa. As duas defesas resolvem problemas
              // diferentes e por isso convivem.
              void this.descartar(reserva.id);
            },
          }),
        );
      }),
    );
  }

  /**
   * Tenta tomar a chave para si.
   *
   * A corrida é resolvida pelo banco, e não por leitura seguida de escrita: o
   * índice único em (escopo, chave) é o que garante que só um request ganha,
   * mesmo com dois chegando no mesmo milissegundo.
   */
  private async reservar(
    request: AuthenticatedRequest,
    key: string,
  ): Promise<
    { kind: 'reserva'; id: string } | { kind: 'repeticao'; status: number; body: unknown }
  > {
    const agora = this.clock.now();
    const scope = escopo(request);
    const requestHash = digital(request);

    try {
      const criado = await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          key,
          method: request.method,
          path: request.path,
          requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          expiresAt: addHours(agora, RETENTION_HOURS),
        },
      });

      return { kind: 'reserva', id: criado.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existente = await this.prisma.idempotencyRecord.findUniqueOrThrow({
      where: { scope_key: { scope, key } },
    });

    if (existente.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'Esta chave de idempotência já foi usada com outro corpo de requisição. ' +
          'Cada pedido distinto precisa da própria chave.',
      );
    }

    if (existente.status === IdempotencyStatus.IN_PROGRESS) {
      // A original ainda está rodando. Responder a resposta dela seria
      // inventar, e executar de novo seria o dobro do efeito.
      throw new ConflictException(
        'Uma requisição com esta chave de idempotência está em andamento. Tente de novo em ' +
          'instantes.',
      );
    }

    this.logger.debug(`Repetição reconhecida para a chave ${key}`);

    return {
      kind: 'repeticao',
      status: existente.responseStatus ?? 200,
      body: existente.responseBody,
    };
  }

  private async concluir(id: string, status: number, body: unknown): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.update({
        where: { id },
        data: {
          status: IdempotencyStatus.COMPLETED,
          responseStatus: status,
          // O corpo passa por JSON porque é assim que ele vai voltar na
          // repetição. Serializar agora garante que a repetição responda
          // exatamente o mesmo texto, inclusive para os `bigint` que o
          // serializador da aplicação transforma em string.
          responseBody: JSON.parse(JSON.stringify(body ?? null)) as Prisma.InputJsonValue,
          completedAt: this.clock.now(),
        },
      });
    } catch (error) {
      // Falhar aqui não pode derrubar uma resposta que já deu certo. O efeito
      // é apenas que a repetição vai reexecutar, que é o comportamento de
      // antes de existir idempotência.
      this.logger.error('Não foi possível guardar a resposta idempotente', error);
    }
  }

  private async descartar(id: string): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.delete({ where: { id } });
    } catch {
      // Se a reserva já sumiu, não há o que descartar.
    }
  }
}

/**
 * A quem a chave pertence.
 *
 * Chave de API primeiro, porque é o caso de integração, que é quem de fato usa
 * idempotência. Depois o usuário, para o painel. Sem credencial não há escopo
 * possível, e a rota anônima cai no escopo público.
 */
function escopo(request: AuthenticatedRequest): string {
  const auth = request.auth;

  if (auth === undefined) {
    return 'anonimo';
  }

  return auth.kind === 'apiKey' ? `apikey:${auth.apiKeyId}` : `user:${auth.userId}`;
}

/**
 * Digital da requisição.
 *
 * Método, caminho e corpo. O cabeçalho fica de fora de propósito: repetir o
 * mesmo pedido com um `user-agent` diferente continua sendo o mesmo pedido.
 */
function digital(request: Request): string {
  const corpo = JSON.stringify(request.body ?? null);

  return createHash('sha256').update(`${request.method} ${request.path} ${corpo}`).digest('hex');
}
