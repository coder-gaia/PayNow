import './bigint-serialization';

import { hash } from '@node-rs/argon2';
import { ApiKeyEnvironment, OrganizationRole, PrismaClient } from '@prisma/client';

/**
 * Dados de demonstracao.
 *
 * Existe para que qualquer pessoa consiga exercitar o sistema inteiro sem
 * cadastrar nada a mao. O conteudo cresce a cada fase: a fase 01 cria contas,
 * organizacao e chaves de API; a fase 02 acrescenta o plano de contas do
 * ledger; a fase 03, produtos, precos e assinaturas.
 *
 * E idempotente: rodar duas vezes nao duplica nada e nao quebra. Isso importa
 * porque `prisma migrate reset` chama o seed automaticamente.
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
