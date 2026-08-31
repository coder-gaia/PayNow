import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { RedisService } from '../../platform/redis/redis.service';
import { type AccessTokenPayload, AuthService } from '../application/auth.service';
import { ApiKeysService } from '../application/api-keys.service';
import {
  ALLOWS_API_KEY,
  type AuthenticatedRequest,
  IS_PUBLIC,
} from '../../platform/http/auth-context';

/** Chaves de API são reconhecidas pelo prefixo, do mesmo jeito que no Stripe. */
const API_KEY_PREFIX = 'sk_';

/** Janela e teto do limite por chave. Cota por plano entra junto com os planos. */
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 300;

/**
 * Guard global de autenticação.
 *
 * Os dois tipos de credencial chegam no mesmo header `Authorization: Bearer`,
 * e são distinguidos pelo formato do valor. Uma chave de API só e aceita em
 * rota marcada com `@AllowApiKey()`: sem isso, um servidor de merchant com
 * chave válida conseguiria mexer no perfil e nas sessões de uma pessoa.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly apiKeys: ApiKeysService,
    private readonly redis: RedisService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.header('authorization'));

    if (token === null) {
      throw new UnauthorizedException('Credencial ausente. Envie Authorization: Bearer <token>.');
    }

    if (token.startsWith(API_KEY_PREFIX)) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWS_API_KEY, targets) === true;

      if (!allowed) {
        throw new UnauthorizedException('Esta rota não aceita chave de API.');
      }

      return this.authenticateApiKey(request, token);
    }

    return this.authenticateUser(request, token);
  }

  /**
   * Autentica uma pessoa pelo token de acesso.
   *
   * A verificação da assinatura não basta. Um token continua criptograficamente
   * válido depois de a conta deixar de existir, e sem confirmar o sujeito no
   * banco a credencial de uma conta apagada segue funcionando até vencer, com
   * cada rota quebrando de um jeito diferente ao não encontrar o usuário.
   *
   * O custo é uma consulta por chave primária por request autenticado. É o
   * preço de conseguir revogar, e é o mesmo que qualquer sistema paga quando
   * decide que apagar uma conta tem efeito imediato. Cache aqui traria
   * invalidação para resolver um problema que ainda não existe.
   */
  private async authenticateUser(request: AuthenticatedRequest, token: string): Promise<boolean> {
    let payload: AccessTokenPayload;

    try {
      payload = this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Token de acesso inválido ou expirado.');
    }

    const subject = await this.auth.findTokenSubject(payload.sub);

    if (subject === null) {
      // 401 e não 404: o problema não é o recurso pedido, é a credencial, que
      // deixou de valer. Quem recebe isso precisa entrar de novo, e é isso que
      // o painel faz ao encontrar este status.
      throw new UnauthorizedException('A conta desta sessão não existe mais.');
    }

    request.auth = { kind: 'user', userId: subject.id, email: subject.email };
    return true;
  }

  private async authenticateApiKey(request: AuthenticatedRequest, token: string): Promise<boolean> {
    const authenticated = await this.apiKeys.authenticate(token);

    if (authenticated === null) {
      throw new UnauthorizedException('Chave de API inválida ou revogada.');
    }

    await this.enforceRateLimit(authenticated.apiKeyId);

    request.auth = {
      kind: 'apiKey',
      apiKeyId: authenticated.apiKeyId,
      organizationId: authenticated.organizationId,
      environment: authenticated.environment,
    };

    return true;
  }

  /**
   * Limite por chave, em janela fixa no Redis.
   *
   * Janela fixa deixa passar até o dobro do teto na virada, e isso é aceito de
   * propósito: a alternativa correta é janela deslizante, que custa mais e só
   * se paga quando existir cota contratual por plano. O contador expira
   * sozinho, então não há rotina de limpeza.
   */
  private async enforceRateLimit(apiKeyId: string): Promise<void> {
    const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1_000;
    const window = Math.floor(this.clock.now().getTime() / windowMs);
    const key = `ratelimit:apikey:${apiKeyId}:${window}`;

    const count = await this.redis.client.incr(key);

    if (count === 1) {
      await this.redis.client.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    if (count > RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpException(
        `Limite de ${RATE_LIMIT_MAX_REQUESTS} requests por minuto excedido para esta chave.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
    return null;
  }

  return value;
}
