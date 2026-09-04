import { Global, Module } from '@nestjs/common';

import { FakeGateway } from './fake-gateway';
import { GatewayNotifications } from './gateway-notifications.service';
import { PAYMENT_GATEWAY } from './payment-gateway';

/**
 * Quem implementa a porta de gateway.
 *
 * A escolha vive aqui, e não no módulo que cobra, porque é decisão de
 * composição e não de domínio. Trocar o gateway falso pelo Stripe é editar
 * este arquivo, e nada mais. Ver ADR-0011.
 *
 * O gateway falso é o padrão de propósito. Ele não é um dublê de teste: é o
 * gateway do ambiente de demonstração, e é o que a suíte adversarial da fase
 * 07 vai dirigir para produzir falhas que um provedor real produz raramente e
 * nunca sob demanda.
 */
@Global()
@Module({
  providers: [
    FakeGateway,
    { provide: PAYMENT_GATEWAY, useExisting: FakeGateway },
    GatewayNotifications,
  ],
  exports: [PAYMENT_GATEWAY, FakeGateway, GatewayNotifications],
})
export class PaymentsGatewayModule {}
