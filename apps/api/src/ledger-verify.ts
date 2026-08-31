import './bigint-serialization';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { LedgerService } from './modules/ledger/application/ledger.service';

/**
 * Auditoria do razao pela linha de comando.
 *
 * Recalcula todos os invariantes contabeis a partir das linhas, sem confiar em
 * nenhum valor derivado que ja esteja gravado. Sai com codigo diferente de zero
 * se algo nao fechar, entao serve tanto para conferencia manual quanto para
 * porta de qualidade em pipeline.
 *
 * Uso: pnpm ledger:verify [organizationId]
 */
async function main(): Promise<void> {
  // Sem servidor HTTP: o comando so precisa do container de injecao.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const ledger = app.get(LedgerService);
    const organizationId = process.argv[2];
    const report = await ledger.verify(organizationId);

    const escopo = organizationId === undefined ? 'todas as organizacoes' : organizationId;

    console.error('');
    console.error(`  Escopo        ${escopo}`);
    console.error(`  Lancamentos   ${report.entryCount.toLocaleString('pt-BR')}`);
    console.error(`  Linhas        ${report.lineCount.toLocaleString('pt-BR')}`);
    console.error(`  Verificado em ${report.checkedAt.toISOString()}`);
    console.error('');

    if (report.balanced) {
      console.error('  Razao integro. Todos os lancamentos somam zero e nada foi alterado.');
      console.error('');
      return;
    }

    console.error(`  ${report.violations.length} violacao(oes):`);
    console.error('');
    for (const violation of report.violations) {
      console.error(`    - ${violation}`);
    }
    console.error('');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Falha ao verificar o razao:', error);
  process.exitCode = 1;
});
