import { Inject, Injectable, Logger } from '@nestjs/common';
import { InboundEventStatus, Prisma } from '@prisma/client';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import type { GatewayNotification } from '../../platform/payments/gateway-notification';
import { GatewayNotifications } from '../../platform/payments/gateway-notifications.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { verifyWebhook } from '../domain/signature';

/**
 * O que o provedor manda. Formato dele, não nosso.
 *
 * Deliberadamente frouxo: um provedor acrescenta campo sem avisar, e recusar o
 * corpo inteiro por causa de um campo desconhecido faria uma mudança compatível
 * dele virar indisponibilidade nossa.
 */
interface CorpoEntrada {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly data?: Record<string, unknown>;
}

export type InboundResult =
  | { readonly status: 'aceito'; readonly eventId: string; readonly note: string }
  | { readonly status: 'duplicado'; readonly eventId: string }
  | { readonly status: 'recusado'; readonly reason: string };

/**
 * Webhooks de entrada.
 *
 * Duas defesas contra reentrega, e as duas são necessárias.
 *
 * A primeira é o índice único sobre (provedor, id externo): o mesmo evento
 * entregue duas vezes é recusado pelo banco. Ela sozinha não basta, e o motivo
 * é o intervalo entre gravar o recibo e aplicar o efeito. Se o processo morrer
 * ali no meio, o recibo existe, o efeito não, e a reentrega do provedor bate no
 * índice e é descartada como duplicata: o desfecho da cobrança se perde.
 *
 * A segunda é a checagem de estado no lado que aplica, que só aceita desfecho
 * de uma cobrança ainda pendente. Ela cobre o buraco acima, porque um recibo
 * que ficou em RECEIVED pode ser reprocessado sem risco de aplicar duas vezes.
 *
 * A ordem também é deliberada: o recibo é gravado **antes** de qualquer efeito,
 * em transação própria. Gravar tudo junto seria mais simples e daria exatamente
 * uma aplicação por evento, mas quando o processamento falhasse por motivo
 * permanente a transação voltaria atrás e levaria o recibo junto. O provedor
 * insistiria, nós falharíamos de novo, e não haveria rastro nenhum de nada
 * disso ter acontecido. Ver ADR-0016.
 */
@Injectable()
export class InboundWebhooksService {
  private readonly logger = new Logger(InboundWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: GatewayNotifications,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Recebe, grava e aplica.
   *
   * `body` é o texto exato que chegou. Ele não pode ser reserializado antes de
   * chegar aqui: a assinatura cobre os bytes recebidos, e a ordem das chaves
   * muda ao passar por JSON.parse e JSON.stringify.
   */
  async receive(
    provider: string,
    body: string,
    signature: string | undefined,
  ): Promise<InboundResult> {
    const secret = this.segredoDe(provider);

    if (secret === null) {
      return { status: 'recusado', reason: 'Provedor desconhecido.' };
    }

    const verificacao = verifyWebhook(body, signature, secret, this.clock.now());

    if (!verificacao.valid) {
      // Sem detalhe na resposta: dizer "a assinatura não confere" e "o instante
      // está fora da janela" com palavras diferentes ajuda quem está tentando
      // adivinhar o segredo. O detalhe fica no log.
      this.logger.warn(`Webhook de ${provider} recusado: ${verificacao.reason}`);
      return { status: 'recusado', reason: 'Assinatura inválida.' };
    }

    let corpo: CorpoEntrada;

    try {
      corpo = JSON.parse(body) as CorpoEntrada;
    } catch {
      return { status: 'recusado', reason: 'O corpo não é JSON.' };
    }

    const externalId = typeof corpo.id === 'string' ? corpo.id : null;
    const eventType = typeof corpo.type === 'string' ? corpo.type : null;

    if (externalId === null || eventType === null) {
      // Sem id não há deduplicação possível, e aceitar assim mesmo seria
      // aceitar aplicar o mesmo desfecho quantas vezes o provedor reenviar.
      return { status: 'recusado', reason: 'O evento precisa de id e type.' };
    }

    const recibo = await this.gravarRecibo(provider, externalId, eventType, body);

    if (recibo.kind === 'duplicado') {
      return { status: 'duplicado', eventId: externalId };
    }

    return this.aplicar(recibo.id, eventType, corpo, externalId);
  }

  /**
   * Reprocessa o que ficou para trás.
   *
   * Existe por causa do intervalo descrito na documentação da classe: um recibo
   * em RECEIVED é um evento que chegou e cujo efeito não se sabe se aconteceu.
   * A checagem de estado do lado que aplica é o que torna isto seguro de chamar
   * à vontade.
   */
  async reprocessPending(limite = 50): Promise<{ retomados: number; falhos: number }> {
    const pendentes = await this.prisma.inboundWebhookEvent.findMany({
      where: { status: InboundEventStatus.RECEIVED },
      orderBy: { receivedAt: 'asc' },
      take: limite,
    });

    let retomados = 0;
    let falhos = 0;

    for (const pendente of pendentes) {
      let corpo: CorpoEntrada;

      try {
        corpo = JSON.parse(pendente.body) as CorpoEntrada;
      } catch {
        // Um corpo que não é JSON nunca vai ser aplicado, por mais vezes que
        // seja tentado. Deixá-lo em RECEIVED faria a varredura tropeçar nele a
        // cada minuto, para sempre. Fechar como FAILED tira-o do caminho sem
        // apagar o que chegou.
        await this.fechar(pendente.id, InboundEventStatus.FAILED, 'O corpo guardado não é JSON.');
        falhos += 1;
        continue;
      }

      try {
        await this.aplicar(pendente.id, pendente.eventType, corpo, pendente.externalId);
        retomados += 1;
      } catch {
        // `aplicar` relança de propósito, para o provedor reentregar quando é
        // ele que está esperando resposta. Aqui não há ninguém esperando, e um
        // recibo problemático não pode impedir os seguintes de serem retomados.
        // Ele já ficou marcado como FAILED lá dentro, e o erro já foi
        // registrado, então engolir aqui não esconde nada.
        falhos += 1;
      }
    }

    return { retomados, falhos };
  }

  /**
   * Grava o recibo, ou reconhece que o evento já tinha chegado.
   *
   * União marcada, e não `string | 'duplicado'`: o id de um recibo também é
   * texto, e as duas respostas ficariam indistinguíveis para o compilador. Um
   * provedor que resolvesse chamar um evento de `duplicado` seria tratado como
   * duplicata.
   */
  private async gravarRecibo(
    provider: string,
    externalId: string,
    eventType: string,
    body: string,
  ): Promise<{ kind: 'novo'; id: string } | { kind: 'duplicado' }> {
    try {
      const recibo = await this.prisma.inboundWebhookEvent.create({
        data: { provider, externalId, eventType, body },
        select: { id: true },
      });

      return { kind: 'novo', id: recibo.id };
    } catch (erro) {
      // P2002 é violação de índice único, e aqui ela não é erro: é a
      // deduplicação funcionando. O provedor reentregou o mesmo evento.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return { kind: 'duplicado' };
      }

      throw erro;
    }
  }

  private async aplicar(
    reciboId: string,
    eventType: string,
    corpo: CorpoEntrada,
    externalId: string,
  ): Promise<InboundResult> {
    const notificacao = this.traduzir(eventType, corpo);

    if (notificacao === null) {
      const note = `O tipo ${eventType} não é tratado.`;
      await this.fechar(reciboId, InboundEventStatus.IGNORED, note);
      return { status: 'aceito', eventId: externalId, note };
    }

    try {
      const { result, note } = await this.notifications.apply(notificacao);

      await this.fechar(
        reciboId,
        result === 'aplicada' ? InboundEventStatus.PROCESSED : InboundEventStatus.IGNORED,
        note,
      );

      return { status: 'aceito', eventId: externalId, note };
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      await this.fechar(reciboId, InboundEventStatus.FAILED, motivo);

      this.logger.error(`Falha ao aplicar o evento ${externalId}: ${motivo}`);

      // Erro para o provedor, de propósito: ele reentrega, e a reentrega é a
      // chance de acertar. Responder 200 aqui esconderia a falha e faria o
      // desfecho da cobrança se perder em silêncio.
      throw erro;
    }
  }

  private async fechar(reciboId: string, status: InboundEventStatus, note: string): Promise<void> {
    await this.prisma.inboundWebhookEvent.update({
      where: { id: reciboId },
      data: { status, note, processedAt: this.clock.now() },
    });
  }

  /**
   * O formato do provedor virando o nosso.
   *
   * Este é o único lugar do sistema que conhece o vocabulário de fora, e é
   * proposital: o resto fala GatewayNotification. Quando entrar um provedor de
   * verdade, é este método que ganha um irmão.
   */
  private traduzir(eventType: string, corpo: CorpoEntrada): GatewayNotification | null {
    const dados = corpo.data ?? {};
    const chave = dados['idempotencyKey'];
    const idempotencyKey = typeof chave === 'string' ? chave : null;

    if (idempotencyKey === null) {
      return null;
    }

    if (eventType === 'charge.succeeded') {
      const referencia = dados['reference'];
      return typeof referencia === 'string'
        ? { kind: 'charge.succeeded', idempotencyKey, reference: referencia }
        : null;
    }

    if (eventType === 'charge.failed') {
      const codigo = dados['code'];
      const mensagem = dados['message'];

      return {
        kind: 'charge.failed',
        idempotencyKey,
        code: typeof codigo === 'string' ? codigo : 'provider_declined',
        message: typeof mensagem === 'string' ? mensagem : 'Recusada pelo provedor.',
        // Na dúvida, retentável: desistir cedo de uma cobrança recuperável
        // custa a assinatura inteira, e insistir custa uma requisição.
        retriable: dados['retriable'] !== false,
      };
    }

    return null;
  }

  /**
   * O segredo do provedor.
   *
   * Por variável de ambiente e não por tabela, porque não é dado da
   * organização: é credencial de infraestrutura, uma por provedor, e o mesmo
   * segredo vale para todas as organizações. Guardá-lo em tabela sugeriria uma
   * multiplicidade que não existe.
   */
  private segredoDe(provider: string): string | null {
    if (provider !== 'fake') {
      return null;
    }

    return process.env['INBOUND_WEBHOOK_SECRET'] ?? 'whsec_fake_provider_desenvolvimento';
  }
}
