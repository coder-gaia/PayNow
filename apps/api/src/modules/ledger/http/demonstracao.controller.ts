import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../platform/http/auth-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { LedgerService } from '../application/ledger.service';

/** A organização que a página inicial mostra. A mesma que o seed cria. */
const DEMONSTRACAO = 'livraria-aurora';

/** Quantos lançamentos a página mostra. Ela não é um extrato. */
const LIMITE = 6;

/**
 * O razão da demonstração, sem login.
 *
 * Existe por causa da página inicial, que é um lançamento contábil e afirma
 * exatamente uma coisa: a soma fecha em zero. Uma página que **afirmasse** isso
 * contradiria o produto, cuja tese é que corretude se verifica. Então o número
 * do rodapé é calculado agora, a cada visita, a partir das linhas.
 *
 * Somente leitura, e é o ponto. O desenho original previa botões que **escrevem**
 * numa organização pública, e escrever sem autenticação é superfície de abuso
 * que precisa de limite de taxa e de uma rotina que recicle os dados, as duas
 * coisas da fase 09. Enquanto elas não existem, a página mostra lançamentos que
 * já estão no razão. Continua sendo verdade conferível: quem duvidar entra no
 * painel e encontra as mesmas linhas.
 */
@ApiTags('demonstração')
@Controller('demonstracao')
export class DemonstracaoController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('razao')
  @Public()
  @ApiOperation({
    summary: 'O razão da organização de demonstração',
    description:
      'Sem autenticação, e somente leitura. A verificação é recalculada a partir das linhas ' +
      'a cada chamada: é o número que a página inicial mostra no rodapé.',
  })
  async razao() {
    const organization = await this.prisma.organization.findUnique({
      where: { slug: DEMONSTRACAO },
      select: { id: true, name: true },
    });

    if (organization === null) {
      // Sem seed não há demonstração. Dizer isso é melhor do que devolver uma
      // página vazia que parece um sistema quebrado.
      throw new NotFoundException(
        'A organização de demonstração não existe neste ambiente. Rode `pnpm db:seed`.',
      );
    }

    const [entries, verification] = await Promise.all([
      this.ledger.entries(organization.id, LIMITE),
      this.ledger.verify(organization.id),
    ]);

    return {
      organization: organization.name,
      entries: entries.map((entry) => ({
        id: entry.id,
        description: entry.description,
        eventType: entry.eventType,
        occurredAt: entry.occurredAt,
        lines: entry.lines.map((line) => ({
          account: line.account,
          label: line.label,
          amountMinor: line.amount.minor.toString(),
          currency: line.amount.currencyCode,
        })),
      })),
      verification: {
        balanced: verification.balanced,
        entryCount: verification.entryCount,
        lineCount: verification.lineCount,
        checkedAt: verification.checkedAt,
        violations: verification.violations,
      },
    };
  }
}
