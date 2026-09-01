import { Global, Module } from '@nestjs/common';

import { MAILER } from './mailer';
import { SmtpMailer } from './smtp-mailer';

/** Ver a porta em mailer.ts. A escolha de implementação é da composição. */
@Global()
@Module({
  providers: [{ provide: MAILER, useClass: SmtpMailer }],
  exports: [MAILER],
})
export class MailModule {}
