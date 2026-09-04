import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WebhookDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../../platform/prisma/prisma.service';
import { generateWebhookSecret } from '../domain/signature';

export interface CreateEndpointInput {
  readonly url: string;
  readonly description?: string;
  readonly eventTypes?: string[];
}

/**
 * Cadastro dos endereços que recebem eventos.
 *
 * A validação da URL é mais rígida do que parece necessário, e o motivo é
 * segurança e não capricho: um endereço de webhook é uma URL que o **servidor**
 * vai buscar, então aceitar qualquer coisa transforma este cadastro em um
 * caminho de SSRF. Quem cadastrar `http://169.254.169.254/...` faz o servidor
 * ler credenciais de instância e mandar para si mesmo.
 */
@Injectable()
export class WebhookEndpointsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, input: CreateEndpointInput) {
    const url = this.validarUrl(input.url);
    const secret = generateWebhookSecret();

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url,
        description: input.description ?? null,
        secret,
        eventTypes: input.eventTypes ?? [],
      },
    });

    // O segredo volta uma vez, no cadastro, e nunca mais. Mesmo desenho da
    // chave de API: quem não guardou gera outro.
    return { endpoint, secret };
  }

  async list(organizationId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(organizationId: string, endpointId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, organizationId },
    });

    if (endpoint === null) {
      throw new NotFoundException('Endereço de webhook não encontrado.');
    }

    return endpoint;
  }

  async setEnabled(organizationId: string, endpointId: string, enabled: boolean, agora: Date) {
    await this.findById(organizationId, endpointId);

    return this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { enabled, disabledAt: enabled ? null : agora },
    });
  }

  /** Gera um segredo novo. O anterior deixa de valer imediatamente. */
  async rotateSecret(organizationId: string, endpointId: string) {
    await this.findById(organizationId, endpointId);
    const secret = generateWebhookSecret();

    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { secret },
    });

    return { endpoint, secret };
  }

  async remove(organizationId: string, endpointId: string): Promise<void> {
    await this.findById(organizationId, endpointId);
    await this.prisma.webhookEndpoint.delete({ where: { id: endpointId } });
  }

  async deliveries(organizationId: string, options: { endpointId?: string } = {}) {
    return this.prisma.webhookDelivery.findMany({
      where: {
        organizationId,
        ...(options.endpointId === undefined ? {} : { endpointId: options.endpointId }),
      },
      include: { endpoint: { select: { url: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async stats(organizationId: string) {
    const [pending, succeeded, failed] = await Promise.all([
      this.prisma.webhookDelivery.count({
        where: { organizationId, status: WebhookDeliveryStatus.PENDING },
      }),
      this.prisma.webhookDelivery.count({
        where: { organizationId, status: WebhookDeliveryStatus.SUCCEEDED },
      }),
      this.prisma.webhookDelivery.count({
        where: { organizationId, status: WebhookDeliveryStatus.FAILED },
      }),
    ]);

    return { pending, succeeded, failed };
  }

  /**
   * Recusa o que não pode ser buscado com segurança pelo servidor.
   *
   * A lista de endereços internos é a defesa mínima contra SSRF. Ela não é
   * completa: DNS pode resolver um nome público para um endereço interno, e
   * cobrir isso exige resolver o nome antes de conectar e recusar o endereço
   * resolvido. Isso entra no endurecimento da fase 09 e está nomeado como
   * lacuna na ADR-0016.
   */
  private validarUrl(bruta: string): string {
    let url: URL;

    try {
      url = new URL(bruta);
    } catch {
      throw new BadRequestException('URL inválida.');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('O endereço precisa ser http ou https.');
    }

    const host = url.hostname.toLowerCase();

    const interno =
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      /^127\./u.test(host) ||
      /^10\./u.test(host) ||
      /^192\.168\./u.test(host) ||
      /^169\.254\./u.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./u.test(host);

    // Em desenvolvimento o alvo natural é a própria máquina, e recusar isso
    // tornaria o recurso indemonstrável. A permissão é explícita e some fora de
    // desenvolvimento.
    if (interno && process.env['NODE_ENV'] === 'production') {
      throw new BadRequestException(
        'Endereços internos não são aceitos: o servidor buscaria a si mesmo.',
      );
    }

    return url.toString();
  }
}
