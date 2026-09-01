import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import type { Env } from '../../../config/env';
import type { Email, Mailer } from './mailer';

/**
 * Envio por SMTP.
 *
 * Aponta para o Mailpit em desenvolvimento, que fica em http://localhost:8025.
 * Nenhum email sai da máquina, o que é o único comportamento aceitável em um
 * ambiente cujos endereços são inventados: um seed com dez clientes de teste
 * não pode virar dez emails para pessoas que não existem.
 *
 * A conexão não é verificada na inicialização de propósito. O sistema precisa
 * subir com o servidor de email fora do ar, porque não poder enviar recibo não
 * é motivo para não poder cobrar. A falha aparece na entrega, onde o outbox a
 * registra e reagenda.
 */
@Injectable()
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('SMTP_FROM', { infer: true });

    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      // O Mailpit não fala TLS e não pede autenticação. Em produção isto vira
      // configuração, e é por isso que a porta existe: a troca não toca em
      // nenhum lugar que saiba o que é um recibo.
      secure: false,
      ignoreTLS: true,
    });
  }

  async send(email: Email): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    });

    this.logger.debug(`Email enviado para ${email.to}: ${email.subject}`);
  }
}
