import { Injectable, Logger } from '@nestjs/common';

import {
  type ChargeOutcome,
  type ChargeRequest,
  GatewayUnavailableError,
  type PaymentGateway,
  type RefundOutcome,
  type RefundRequest,
} from './payment-gateway';

/**
 * O que o gateway falso deve fazer na próxima cobrança.
 *
 * `timeout` é o caso que separa um sistema de cobrança sério de um brinquedo:
 * o provedor recebeu, talvez cobrou, e não respondeu. Quem trata isso como
 * falha cobra duas vezes; quem trata como sucesso libera acesso sem dinheiro.
 */
export type FakeScenario =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'decline'; readonly code?: string; readonly retriable?: boolean }
  | { readonly kind: 'timeout' }
  /** Falha nas primeiras N tentativas e passa na seguinte. Para a recuperação. */
  | { readonly kind: 'failThenSucceed'; readonly failures: number };

/**
 * Gateway falso, programável.
 *
 * Não é um dublê de teste no sentido usual. Ele vive no código de produção
 * porque é o gateway padrão do ambiente de demonstração, e porque a suíte
 * adversarial da fase 07 vai dirigi-lo para produzir falhas que um provedor de
 * verdade produz raramente e nunca sob demanda.
 *
 * A idempotência é implementada de verdade, e não simulada: o mesmo
 * `idempotencyKey` devolve o mesmo resultado, como o Stripe faz. Sem isso, o
 * teste de cobrança em dobro passaria por acidente, provando nada.
 *
 * O estado vive em memória, o que é adequado: um gateway de verdade também é
 * um estado que este processo não controla, e reiniciar o processo é
 * equivalente a trocar de provedor.
 *
 * Os métodos devolvem promessa sem serem `async` porque respondem na hora. A
 * porta é assíncrona de propósito, já que um provedor real é chamada de rede,
 * e manter a assinatura impede que alguém escreva código que só funciona com
 * este aqui.
 */
@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';

  private readonly logger = new Logger(FakeGateway.name);

  /** Resultado já produzido para uma chave, para responder igual na repetição. */
  private readonly porChave = new Map<string, ChargeOutcome>();

  /** Quantas vezes cada chave lógica já falhou, para o cenário de recuperação. */
  private readonly falhasPorChave = new Map<string, number>();

  private cenario: FakeScenario = { kind: 'succeed' };

  private sequencia = 0;

  /** Programa o comportamento das próximas cobranças. */
  setScenario(cenario: FakeScenario): void {
    this.cenario = cenario;
  }

  /** Volta ao caminho feliz e esquece o que já respondeu. */
  reset(): void {
    this.cenario = { kind: 'succeed' };
    this.porChave.clear();
    this.falhasPorChave.clear();
  }

  charge(request: ChargeRequest): Promise<ChargeOutcome> {
    // Idempotência antes de qualquer outra coisa. Uma repetição não é uma
    // cobrança nova, nem quando o cenário mudou no meio.
    const jaRespondido = this.porChave.get(request.idempotencyKey);

    if (jaRespondido !== undefined) {
      this.logger.debug(`Repetição reconhecida para ${request.idempotencyKey}`);
      return Promise.resolve(jaRespondido);
    }

    const resultado = this.decidir(request);

    if (resultado === null) {
      // Timeout não grava resultado: o provedor de verdade também não sabe
      // dizer, neste ponto, se cobrou ou não. Repetir a mesma chave depois de
      // um timeout deve poder resultar em sucesso.
      return Promise.reject(
        new GatewayUnavailableError(
          this.name,
          'O provedor não respondeu a tempo. A cobrança pode ou não ter acontecido.',
        ),
      );
    }

    this.porChave.set(request.idempotencyKey, resultado);
    return Promise.resolve(resultado);
  }

  refund(_request: RefundRequest): Promise<RefundOutcome> {
    this.sequencia += 1;
    return Promise.resolve({ status: 'succeeded', reference: `fake_re_${this.sequencia}` });
  }

  /** Devolve o resultado, ou null quando o cenário é não responder. */
  private decidir(request: ChargeRequest): ChargeOutcome | null {
    switch (this.cenario.kind) {
      case 'succeed':
        this.sequencia += 1;
        return { status: 'succeeded', reference: `fake_ch_${this.sequencia}` };

      case 'decline':
        return {
          status: 'failed',
          code: this.cenario.code ?? 'card_declined',
          message: 'O emissor recusou a cobrança.',
          retriable: this.cenario.retriable ?? true,
        };

      case 'timeout':
        return null;

      case 'failThenSucceed': {
        // A contagem é por fatura, e não global, para que duas assinaturas em
        // recuperação ao mesmo tempo não interfiram uma na outra.
        const chaveLogica = chaveDaFatura(request.idempotencyKey);
        const jaFalhou = this.falhasPorChave.get(chaveLogica) ?? 0;

        if (jaFalhou >= this.cenario.failures) {
          this.sequencia += 1;
          return { status: 'succeeded', reference: `fake_ch_${this.sequencia}` };
        }

        this.falhasPorChave.set(chaveLogica, jaFalhou + 1);

        return {
          status: 'failed',
          code: 'insufficient_funds',
          message: 'Saldo insuficiente.',
          retriable: true,
        };
      }
    }
  }
}

/**
 * A parte estável da chave de idempotência.
 *
 * A chave inclui o número da tentativa, então cada tentativa é uma cobrança
 * distinta para o provedor, que é o comportamento correto. Para contar
 * falhas por fatura, o cenário precisa do prefixo sem a tentativa.
 */
function chaveDaFatura(idempotencyKey: string): string {
  const ultimoSeparador = idempotencyKey.lastIndexOf(':');
  return ultimoSeparador === -1 ? idempotencyKey : idempotencyKey.slice(0, ultimoSeparador);
}
