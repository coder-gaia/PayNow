import './bigint-serialization';

import { hash } from '@node-rs/argon2';
import { AccountKind, ApiKeyEnvironment, OrganizationRole, PrismaClient } from '@prisma/client';

/**
 * Dados de demonstracao.
 *
 * Existe para que qualquer pessoa consiga exercitar o sistema inteiro sem
 * cadastrar nada a mao. O conteudo cresce a cada fase: a fase 01 cria contas,
 * organizacao e chaves de API; a fase 02 acrescenta o plano de contas do
 * ledger; a fase 03, produtos, precos e assinaturas.
 *
 * E idempotente: rodar duas vezes nao duplica nada e nao quebra. Isso importa
 * porque `prisma migrate reset` chama o seed automaticamente. No ledger a
 * idempotencia e do proprio banco: o indice unico sobre o evento de origem
 * recusa o mesmo lancamento duas vezes.
 *
 * Nada aqui deve rodar em producao. O script recusa se NODE_ENV for production.
 */

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Senha unica para todas as contas de demonstracao. Impressa no fim. */
const DEMO_PASSWORD = 'paynow-demo-2026';

const ORGANIZATION = {
  name: 'Livraria Aurora',
  slug: 'livraria-aurora',
} as const;

const PEOPLE = [
  {
    email: 'ana@livraria-aurora.test',
    name: 'Ana Ribeiro',
    role: OrganizationRole.OWNER,
    description: 'Dona da conta. Ve tudo e pode promover e remover qualquer pessoa.',
  },
  {
    email: 'bruno@livraria-aurora.test',
    name: 'Bruno Salles',
    role: OrganizationRole.ADMIN,
    description: 'Administra membros e chaves, mas nao pode mexer em quem e OWNER.',
  },
  {
    email: 'carla@livraria-aurora.test',
    name: 'Carla Nunes',
    role: OrganizationRole.MEMBER,
    description: 'Opera o dia a dia. Nao administra membros nem chaves.',
  },
  {
    email: 'davi@livraria-aurora.test',
    name: 'Davi Prado',
    role: OrganizationRole.READONLY,
    description: 'So consulta. Util para conferir que as restricoes de papel funcionam.',
  },
] as const;

/**
 * Chave de API fixa, exclusiva do ambiente de demonstracao.
 *
 * Uma chave gerada aleatoriamente obrigaria a copiar o valor a cada seed. Como
 * este segredo so existe em banco local recriavel, e como o valor esta no
 * repositorio publico e portanto vale zero, fixa-lo torna o roteiro de teste
 * copiavel e colavel.
 */
const DEMO_API_KEY_SECRET = 'sk_test_paynowdemo0000000000000000000000000000';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('O seed de demonstracao nao roda em producao.');
  }

  const passwordHash = await hash(DEMO_PASSWORD, ARGON2_OPTIONS);

  const organization = await prisma.organization.upsert({
    where: { slug: ORGANIZATION.slug },
    update: { name: ORGANIZATION.name },
    create: { name: ORGANIZATION.name, slug: ORGANIZATION.slug },
  });

  for (const person of PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, passwordHash },
      create: { email: person.email, name: person.name, passwordHash },
    });

    await prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: organization.id },
      },
      update: { role: person.role },
      create: { userId: user.id, organizationId: organization.id, role: person.role },
    });
  }

  await seedApiKey(organization.id);
  await seedLedger(organization.id);
  await report(organization.id);
}

async function seedApiKey(organizationId: string): Promise<void> {
  const { createHash } = await import('node:crypto');
  const prefix = DEMO_API_KEY_SECRET.slice(0, 'sk_test_'.length + 8);
  const tokenHash = createHash('sha256').update(DEMO_API_KEY_SECRET, 'utf8').digest('hex');

  await prisma.apiKey.upsert({
    where: { prefix },
    update: { revokedAt: null },
    create: {
      organizationId,
      name: 'Chave de demonstracao',
      environment: ApiKeyEnvironment.TEST,
      prefix,
      tokenHash,
    },
  });
}

/**
 * Lancamentos de referencia de docs/plano-de-contas.md.
 *
 * Sao os mesmos cinco cenarios do documento, com os mesmos valores conferidos
 * a mao. Semear com eles serve a duas coisas ao mesmo tempo: da ao explorador
 * do painel um razao de verdade para mostrar, e prova que os lancamentos
 * documentados passam pelas constraints do banco.
 */
async function seedLedger(organizationId: string): Promise<void> {
  const conta = async (code: string, kind: AccountKind): Promise<string> => {
    const account = await prisma.account.upsert({
      where: { organizationId_code_currency: { organizationId, code, currency: 'BRL' } },
      update: {},
      create: { organizationId, code, kind, currency: 'BRL' },
    });
    return account.id;
  };

  const receivable = await conta('customer:receivable', AccountKind.ASSET);
  const clearing = await conta('gateway:clearing', AccountKind.ASSET);
  const revenue = await conta('merchant:revenue', AccountKind.REVENUE);
  const platformFee = await conta('platform:fee', AccountKind.REVENUE);
  const customerCredit = await conta('customer:credit', AccountKind.LIABILITY);
  const refunds = await conta('merchant:refunds', AccountKind.CONTRA_REVENUE);

  // Datas fixas, e nao relativas ao momento do seed, para que o razao da
  // demonstracao conte sempre a mesma historia.
  const entradas = [
    {
      eventType: 'invoice.issued',
      eventId: 'demo-fatura-1',
      description: 'Fatura de R$ 100,00 emitida',
      occurredAt: new Date('2026-08-01T12:00:00Z'),
      lines: [
        { accountId: receivable, amountMinor: 10_000n },
        { accountId: revenue, amountMinor: -10_000n },
      ],
    },
    {
      eventType: 'payment.succeeded',
      eventId: 'demo-pagamento-1',
      description: 'Pagamento confirmado, com taxa de plataforma de 3%',
      occurredAt: new Date('2026-08-02T12:00:00Z'),
      lines: [
        { accountId: clearing, amountMinor: 10_000n },
        { accountId: receivable, amountMinor: -10_000n },
        { accountId: revenue, amountMinor: 300n },
        { accountId: platformFee, amountMinor: -300n },
      ],
    },
    {
      eventType: 'refund.issued',
      eventId: 'demo-estorno-1',
      description: 'Estorno parcial de R$ 40,00',
      occurredAt: new Date('2026-08-05T12:00:00Z'),
      lines: [
        { accountId: refunds, amountMinor: 4_000n },
        { accountId: clearing, amountMinor: -4_000n },
      ],
    },
    {
      eventType: 'subscription.downgraded',
      eventId: 'demo-downgrade-1',
      description: 'Credito por downgrade no meio do ciclo',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      lines: [
        { accountId: revenue, amountMinor: 10_000n },
        { accountId: customerCredit, amountMinor: -10_000n },
      ],
    },
    {
      eventType: 'invoice.issued',
      eventId: 'demo-fatura-2',
      description: 'Fatura de R$ 300,00 com R$ 100,00 de credito aplicado',
      occurredAt: new Date('2026-08-15T12:00:00Z'),
      lines: [
        { accountId: receivable, amountMinor: 20_000n },
        { accountId: customerCredit, amountMinor: 10_000n },
        { accountId: revenue, amountMinor: -30_000n },
      ],
    },
  ];

  for (const entrada of entradas) {
    const existente = await prisma.journalEntry.findUnique({
      where: {
        organizationId_eventType_eventId: {
          organizationId,
          eventType: entrada.eventType,
          eventId: entrada.eventId,
        },
      },
    });

    if (existente !== null) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          organizationId,
          eventType: entrada.eventType,
          eventId: entrada.eventId,
          description: entrada.description,
          occurredAt: entrada.occurredAt,
        },
      });

      await tx.journalLine.createMany({
        data: entrada.lines.map((line) => ({
          entryId: entry.id,
          accountId: line.accountId,
          amountMinor: line.amountMinor,
          currency: 'BRL',
        })),
      });
    });
  }
}

async function report(organizationId: string): Promise<void> {
  const members = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: { role: 'asc' },
  });

  const lines = [
    '',
    'Dados de demonstracao prontos.',
    '',
    `  Organizacao   ${ORGANIZATION.name}  (${organizationId})`,
    `  Senha         ${DEMO_PASSWORD}   (a mesma para todas as contas)`,
    '',
    '  Contas',
  ];

  for (const person of PEOPLE) {
    const found = members.find((membership) => membership.user.email === person.email);
    lines.push(
      `    ${person.role.padEnd(8)} ${person.email.padEnd(32)} ${found ? '' : '(faltando)'}`,
    );
    lines.push(`             ${person.description}`);
  }

  const saldos = await prisma.$queryRaw<{ code: string; balance: bigint }[]>`
    SELECT a.code, COALESCE(SUM(l.amount_minor), 0)::bigint AS balance
      FROM accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
     WHERE a.organization_id = ${organizationId}::uuid
     GROUP BY a.code
     ORDER BY a.code
  `;

  lines.push('', '  Razao');
  for (const saldo of saldos) {
    const reais = (Number(saldo.balance) / 100).toFixed(2).padStart(10);
    lines.push(`    ${saldo.code.padEnd(22)} ${reais}`);
  }
  const total = saldos.reduce((soma, saldo) => soma + saldo.balance, 0n);
  lines.push(
    `    ${'soma (deve ser zero)'.padEnd(22)} ${(Number(total) / 100).toFixed(2).padStart(10)}`,
  );

  lines.push(
    '',
    '  Chave de API de teste',
    `    ${DEMO_API_KEY_SECRET}`,
    '',
    '  Experimente',
    '    curl -s localhost:3333/v1/auth/login -H "content-type: application/json" \\',
    `      -d '{"email":"${PEOPLE[0].email}","password":"${DEMO_PASSWORD}"}'`,
    '',
    `    curl -s localhost:3333/v1/merchant/me -H "authorization: Bearer ${DEMO_API_KEY_SECRET}"`,
    '',
  );

  console.error(lines.join('\n'));
}

main()
  .catch((error: unknown) => {
    console.error('Falha ao popular os dados de demonstracao:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
