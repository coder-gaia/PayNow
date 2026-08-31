/**
 * Cria uma migration a partir da diferenca entre o historico aplicado e o
 * schema atual, sem depender de terminal interativo.
 *
 * `prisma migrate dev` faz o mesmo, mas pergunta antes de agir e trava quando
 * roda em CI, em script ou em qualquer contexto sem TTY. Este script usa
 * `prisma migrate diff`, que e puramente calculo, e escreve o arquivo no lugar
 * certo. Aplicar continua sendo trabalho do `pnpm db:deploy`.
 *
 * Uso: pnpm db:diff nome_da_migration
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];

if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Uso: pnpm db:diff nome_da_migration');
  console.error('O nome aceita apenas letras minusculas, numeros e sublinhado.');
  process.exit(1);
}

const shadowUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowUrl) {
  console.error('SHADOW_DATABASE_URL nao definida. Veja o .env.example.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const directory = join('prisma', 'migrations', `${stamp}_${name}`);

const sql = execFileSync(
  'pnpm',
  [
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    './prisma/migrations',
    '--to-schema-datamodel',
    './prisma/schema.prisma',
    '--shadow-database-url',
    shadowUrl,
    '--script',
  ],
  { encoding: 'utf8', shell: process.platform === 'win32' },
);

if (sql.includes('This is an empty migration')) {
  console.error('Nenhuma diferenca entre o schema e as migrations aplicadas.');
  process.exit(0);
}

mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'migration.sql'), sql, 'utf8');

console.error(`Migration criada em ${directory}`);
console.error('Revise o SQL e aplique com: pnpm db:deploy');
