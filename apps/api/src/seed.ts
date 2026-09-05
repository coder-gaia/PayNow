import './bigint-serialization';

import { hash } from '@node-rs/argon2';
import {
  AccountKind,
  ApiKeyEnvironment,
  BillingInterval,
  OrganizationRole,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';

/**
 * Dados de demonstração.
 *
 * Existe para que qualquer pessoa consiga exercitar o sistema inteiro sem
 * cadastrar nada a mão. O conteúdo cresce a cada fase: a fase 01 cria contas,
 * organização e chaves de API; a fase 02 acrescenta o plano de contas do
 * ledger; a fase 03, produtos, preços e assinaturas.
 *
 * E idempotente: rodar duas vezes não duplica nada é não quebra. Isso importa
 * porque `prisma migrate reset` chama o seed automaticamente. No ledger a
 * idempotência e do próprio banco: o índice único sobre o evento de origem
 * recusa o mesmo lançamento duas vezes.
 *
 * Nada aqui deve rodar em produção. O script recusa se NODE_ENV for production.
 */

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Senha única para todas as contas de demonstração. Impressa no fim. */
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
    description: 'Dona da conta. Vê tudo e pode promover e remover qualquer pessoa.',
  },
  {
    email: 'bruno@livraria-aurora.test',
    name: 'Bruno Salles',
    role: OrganizationRole.ADMIN,
    description: 'Administra membros e chaves, mas não pode mexer em quem é OWNER.',
  },
  {
    email: 'carla@livraria-aurora.test',
    name: 'Carla Nunes',
    role: OrganizationRole.MEMBER,
    description: 'Opera o dia a dia. Não administra membros nem chaves.',
  },
  {
    email: 'davi@livraria-aurora.test',
    name: 'Davi Prado',
    role: OrganizationRole.READONLY,
    description: 'Só consulta. Útil para conferir que as restrições de papel funcionam.',
  },
] as const;

/**
 * Chave de API fixa, exclusiva do ambiente de demonstração.
 *
 * Uma chave gerada aleatoriamente obrigaria a copiar o valor a cada seed. Como
 * este segredo só existe em banco local recriável, e como o valor esta no
 * repositório público e portanto vale zero, fixa-lo torna o roteiro de teste
 * copiavel e colavel.
 */
const DEMO_API_KEY_SECRET = 'sk_test_paynowdemo0000000000000000000000000000';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('O seed de demonstração não roda em produção.');
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
  await seedBilling(organization.id);
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
      name: 'Chave de demonstração',
      environment: ApiKeyEnvironment.TEST,
      prefix,
      tokenHash,
    },
  });
}

/**
 * Lançamentos de referência de docs/plano-de-contas.md.
 *
 * São os mesmos cinco cenários do documento, com os mesmos valores conferidos
 * a mão. Semear com eles serve a duas coisas ao mesmo tempo: da ao explorador
 * do painel um razão de verdade para mostrar, e prova que os lançamentos
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

  // Datas fixas, e não relativas ao momento do seed, para que o razão da
  // demonstração conte sempre a mesma história.
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
      description: 'Crédito por downgrade no meio do ciclo',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      lines: [
        { accountId: revenue, amountMinor: 10_000n },
        { accountId: customerCredit, amountMinor: -10_000n },
      ],
    },
    {
      eventType: 'invoice.issued',
      eventId: 'demo-fatura-2',
      description: 'Fatura de R$ 300,00 com R$ 100,00 de crédito aplicado',
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

/**
 * Catálogo e assinaturas de demonstração.
 *
 * Três planos e quatro clientes, cada um em um estado diferente, para que o
 * painel mostre a máquina de estados funcionando em vez de uma lista de linhas
 * iguais. As assinaturas são criadas direto no banco, sem passar pelo serviço,
 * porque o serviço publicaria eventos e lançaria no razão, e o razão de
 * demonstração já tem os cinco lançamentos de referência do plano de contas.
 */
async function seedBilling(organizationId: string): Promise<void> {
  const planos = [
    { nome: 'Básico', valor: 2_900n, trial: 0 },
    { nome: 'Pro', valor: 10_000n, trial: 14 },
    { nome: 'Enterprise', valor: 30_000n, trial: 0 },
  ];

  const precos = new Map<string, string>();

  for (const plano of planos) {
    const product = await prisma.product.upsert({
      where: { organizationId_name: { organizationId, name: plano.nome } },
      update: {},
      create: {
        organizationId,
        name: plano.nome,
        description: `Plano ${plano.nome} da Livraria Aurora`,
      },
    });

    const existente = await prisma.price.findFirst({ where: { productId: product.id } });
    const price =
      existente ??
      (await prisma.price.create({
        data: {
          organizationId,
          productId: product.id,
          amountMinor: plano.valor,
          currency: 'BRL',
          interval: BillingInterval.MONTH,
          trialDays: plano.trial,
        },
      }));

    precos.set(plano.nome, price.id);
  }

  const clientes = [
    {
      email: 'contato@padaria-lua.test',
      nome: 'Padaria Lua',
      plano: 'Pro',
      estado: SubscriptionStatus.ACTIVE,
    },
    {
      email: 'financeiro@studio-vega.test',
      nome: 'Studio Vega',
      plano: 'Enterprise',
      estado: SubscriptionStatus.ACTIVE,
    },
    {
      email: 'ola@bike-norte.test',
      nome: 'Bike Norte',
      plano: 'Pro',
      estado: SubscriptionStatus.TRIALING,
    },
    {
      email: 'contas@mercado-sul.test',
      nome: 'Mercado Sul',
      plano: 'Básico',
      estado: SubscriptionStatus.PAST_DUE,
    },
    // A página inicial traz depoimentos declaradamente fictícios, e cada
    // negócio citado é um link para a assinatura correspondente aqui. Este
    // entrou junto com a página, para que a promessa do link valha para todos:
    // um link que leva a lugar nenhum desmentiria a página inteira, que existe
    // para defender que tudo nela é conferível.
    {
      email: 'contato@cafe-meridiano.test',
      nome: 'Café Meridiano',
      plano: 'Pro',
      estado: SubscriptionStatus.ACTIVE,
    },
  ];

  // Ciclo fixo, para que a demonstração conte sempre a mesma história.
  const inicioDoCiclo = new Date('2026-08-01T12:00:00Z');
  const fimDoCiclo = new Date('2026-09-01T12:00:00Z');

  for (const cliente of clientes) {
    const customer = await prisma.customer.upsert({
      where: { organizationId_email: { organizationId, email: cliente.email } },
      update: { name: cliente.nome, ...meioDePagamento(cliente.email) },
      create: {
        organizationId,
        email: cliente.email,
        name: cliente.nome,
        ...meioDePagamento(cliente.email),
      },
    });

    const jaTem = await prisma.subscription.findFirst({ where: { customerId: customer.id } });
    if (jaTem !== null) {
      continue;
    }

    const priceId = precos.get(cliente.plano)!;
    const emTeste = cliente.estado === SubscriptionStatus.TRIALING;

    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        customerId: customer.id,
        priceId,
        status: cliente.estado,
        currentPeriodStart: inicioDoCiclo,
        currentPeriodEnd: fimDoCiclo,
        trialEndsAt: emTeste ? new Date('2026-09-10T12:00:00Z') : null,
      },
    });

    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        toStatus: cliente.estado,
        reason: descreverEstado(cliente.estado),
        occurredAt: inicioDoCiclo,
      },
    });
  }
}

/**
 * Meio de pagamento de demonstração.
 *
 * O token é inventado e o gateway falso aceita qualquer um, o que é o
 * comportamento correto de um ambiente onde não existe cartão de verdade. O
 * que importa aqui é que o campo esteja preenchido: sem ele a cobrança é
 * recusada antes de chegar ao provedor, e a tela de faturas nasceria sem nada
 * para demonstrar.
 *
 * Nunca é número de cartão. Ver ADR-0014.
 */
function meioDePagamento(email: string) {
  return {
    paymentMethodToken: `pm_demo_${email.split('@')[0] ?? 'cliente'}`,
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
  };
}

function descreverEstado(estado: SubscriptionStatus): string {
  switch (estado) {
    case SubscriptionStatus.TRIALING:
      return 'Assinatura criada com 14 dias de teste';
    case SubscriptionStatus.PAST_DUE:
      return 'Cobrança falhou, recuperação em andamento';
    default:
      return 'Assinatura ativa desde o início do ciclo';
  }
}

/**
 * Centavos em reais, para o relatório impresso no terminal.
 *
 * Feito em bigint, e não com divisão por 100, porque dividir traz de volta o
 * ponto flutuante que a ADR-0002 existe para manter fora do sistema. Vale
 * também para saída de terminal: uma vez que a conversão entra no código, ela
 * acaba copiada para algum lugar onde importa.
 */
function reais(minor: bigint): string {
  const negativo = minor < 0n;
  const absoluto = negativo ? -minor : minor;
  const centavos = (absoluto % 100n).toString().padStart(2, '0');

  return `${negativo ? '-' : ''}${(absoluto / 100n).toString()},${centavos}`;
}

async function report(organizationId: string): Promise<void> {
  const members = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: { role: 'asc' },
  });

  const lines = [
    '',
    'Dados de demonstração prontos.',
    '',
    `  Organização   ${ORGANIZATION.name}  (${organizationId})`,
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

  lines.push('', '  Razão');
  for (const saldo of saldos) {
    lines.push(`    ${saldo.code.padEnd(22)} ${reais(saldo.balance).padStart(11)}`);
  }
  const total = saldos.reduce((soma, saldo) => soma + saldo.balance, 0n);
  lines.push(`    ${'soma (deve ser zero)'.padEnd(22)} ${reais(total).padStart(11)}`);

  const assinaturas = await prisma.subscription.findMany({
    where: { organizationId },
    include: { customer: true, price: { include: { product: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (assinaturas.length > 0) {
    lines.push('', '  Assinaturas');
    for (const assinatura of assinaturas) {
      lines.push(
        `    ${assinatura.status.padEnd(10)} ${assinatura.customer.name.padEnd(16)} ` +
          `${assinatura.price.product.name.padEnd(12)} ` +
          `R$ ${reais(assinatura.price.amountMinor).padStart(9)}`,
      );
    }
  }

  const faturas = await prisma.invoice.findMany({
    where: { organizationId },
    include: { customer: true, payments: true },
    orderBy: { number: 'asc' },
  });

  if (faturas.length > 0) {
    lines.push('', '  Faturas');
    for (const fatura of faturas) {
      lines.push(
        `    nº ${String(fatura.number).padEnd(3)} ${fatura.status.padEnd(14)} ` +
          `${fatura.customer.name.padEnd(16)} R$ ${reais(fatura.amountMinor).padStart(9)} ` +
          `${fatura.payments.length} tentativa(s)`,
      );
    }
  }

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
    console.error('Falha ao popular os dados de demonstração:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
