import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { from, type Observable, switchMap } from 'rxjs';

import { ClockScopeStorage } from './clock-scope';
import { OrganizationClockService } from './organization-clock.service';

/**
 * Abre o escopo de tempo do request.
 *
 * A borda é aqui, e é aqui de propósito: é o último ponto em que ainda se sabe
 * qual organização está sendo servida sem que ninguém tenha precisado passar o
 * identificador adiante. Do controller para baixo, todo mundo pergunta as
 * horas ao relógio injetado e recebe a resposta certa.
 *
 * Requests sem organização na rota, como login e health, seguem sem escopo, e
 * o relógio cai no de parede. Não faz sentido resolver relógio virtual para
 * quem ainda não disse em nome de quem está agindo.
 *
 * O interceptor devolve um Observable porque a resolução do relógio é
 * assíncrona e o escopo precisa envolver a execução inteira do handler. O
 * `switchMap` garante que `next.handle()` seja assinado de dentro do `run`, e
 * não fora dele: assinar fora deixaria o handler rodando sem escopo, que é o
 * erro clássico de misturar AsyncLocalStorage com RxJS.
 */
@Injectable()
export class ClockScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly clocks: OrganizationClockService,
    private readonly scopes: ClockScopeStorage,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const organizationId = organizationIdFrom(request);

    if (organizationId === null) {
      return next.handle();
    }

    return from(this.clocks.resolve(organizationId)).pipe(
      switchMap((scope) => this.scopes.run(scope, () => next.handle())),
    );
  }
}

/**
 * Identificador da organização, quando a rota tem um.
 *
 * Vem do parâmetro de rota e não do corpo nem da query. O parâmetro é o que o
 * guard de papel já usou para decidir o acesso, então usar a mesma fonte
 * garante que o relógio e a autorização falem da mesma organização.
 */
function organizationIdFrom(request: Request): string | null {
  const params = request.params as Record<string, string | undefined>;
  const value = params['organizationId'];

  return typeof value === 'string' && value.length > 0 ? value : null;
}
