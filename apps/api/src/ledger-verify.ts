import './bigint-serialization';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { LedgerService } from './modules/ledger/application/ledger.service';

/**
 * Auditoria do razão pela linha de comando.
 *
 * Recalcula todos os invariantes contábeis a partir das linhas, sem confiar em
 * nenhum valor derivado que já esteja gravado. Sai com código diferente de zero
 * se algo não fechar, então serve tanto para conferência manual quanto para
 * porta de qualidade em pipeline.
 *
 * Uso: pnpm ledger:verify [organizationId]
 */
async function main(): Promise<void> {
  // Sem servidor HTTP: o comando só precisa do container de injeção.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const ledger = app.get(LedgerService);
    const organizationId = process.argv[2];
    const report = await ledger.verify(organizationId);

    const escopo = organizationId === undefined ? 'todas as organizações' : organizationId;

    console.error('');
    console.error(`  Escopo        ${escopo}`);
    console.error(`  Lançamentos   ${report.entryCount.toLocaleString('pt-BR')}`);
    console.error(`  Linhas        ${report.lineCount.toLocaleString('pt-BR')}`);
    console.error(`  Verificado em ${report.checkedAt.toISOString()}`);
    console.error('');

    if (report.balanced) {
      console.error('  Razão íntegro. Todos os lançamentos somam zero e nada foi alterado.');
      console.error('');
      return;
    }

    console.error(`  ${report.violations.length} violação(oes):`);
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
  console.error('Falha ao verificar o razão:', error);
  process.exitCode = 1;
});
