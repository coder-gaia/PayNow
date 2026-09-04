import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../platform/http/auth-context';
import { InboundWebhooksService } from '../application/inbound-webhooks.service';
import { SIGNATURE_HEADER } from '../domain/signature';

/**
 * Onde o provedor de pagamento nos procura.
 *
 * Rota pública, e tem de ser: o provedor não faz login. Quem autentica é a
 * assinatura do corpo, e é por isso que ela é conferida antes de qualquer outra
 * coisa acontecer, inclusive antes de o corpo virar objeto.
 *
 * A rota vive fora de `/organizations/:id` de propósito. O provedor não conhece
 * as nossas organizações: ele conhece a chave de idempotência que mandamos a
 * ele, e é ela que diz de quem é a cobrança. Pedir o id da organização na URL
 * seria pedir ao provedor um dado que ele não tem, e aceitar o que ele
 * respondesse seria deixar quem chama escolher a organização afetada.
 */
@ApiTags('webhooks')
@Controller('inbound-webhooks')
export class InboundWebhooksController {
  constructor(private readonly inbound: InboundWebhooksService) {}

  @Post(':provider')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Recebe um evento do provedor de pagamento' })
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature?: string,
  ) {
    // O corpo cru, e não o objeto já parseado. A assinatura cobre os bytes que
    // chegaram: reserializar reordena as chaves e a conferência falharia por
    // motivo nenhum.
    const raw = request.rawBody;

    if (raw === undefined) {
      throw new BadRequestException('Corpo ausente.');
    }

    const resultado = await this.inbound.receive(provider, raw.toString('utf8'), signature);

    if (resultado.status === 'recusado') {
      throw new UnauthorizedException(resultado.reason);
    }

    // A reentrega responde 200, e não 409. Para o provedor, duplicata recebida
    // e aceita são a mesma coisa: os dois significam "pode parar de insistir".
    // Responder erro faria ele insistir contra um evento já resolvido.
    return resultado.status === 'duplicado'
      ? { received: true, duplicate: true, eventId: resultado.eventId }
      : { received: true, duplicate: false, eventId: resultado.eventId, note: resultado.note };
  }
}
