/**
 * Verifica que as regras arquiteturais do ESLint realmente disparam.
 *
 * Uma regra de lint que existe no arquivo de configuracao mas nao dispara e
 * pior do que nenhuma regra: ela cria a impressao de que a fronteira esta
 * protegida enquanto o codigo pode atravessa-la a vontade. Isso aconteceu de
 * fato durante a fase 00, quando os padroes do plugin estavam ancorados na
 * raiz do repositorio e o lint rodava de dentro do pacote.
 *
 * Este script escreve modulos de sonda temporarios, roda o ESLint de verdade
 * sobre eles e exige que cada violacao esperada apareca. Depois apaga tudo.
 *
 * Uso: pnpm verify:architecture
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(repoRoot, 'apps', 'api', 'src', 'modules');

/** Cada caso descreve um arquivo de sonda e a regra que ele deve violar. */
const cases = [
  {
    name: 'modulo de dominio importando outro modulo de dominio',
    file: join(modulesDir, '__probe_beta', 'beta.ts'),
    code: [
      "import { alpha } from '../__probe_alpha/alpha';",
      '',
      'export const usa = (): number => alpha;',
      '',
    ].join('\n'),
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'modulo de dominio lendo o relogio do sistema',
    file: join(modulesDir, '__probe_beta', 'relogio.ts'),
    code: ['export const agora = (): number => Date.now();', ''].join('\n'),
    expectRule: 'no-restricted-syntax',
  },
  {
    name: 'modulo de plataforma importando um modulo de dominio',
    file: join(modulesDir, 'platform', '__probe_invasao.ts'),
    code: [
      "import { alpha } from '../__probe_alpha/alpha';",
      '',
      'export const usa = (): number => alpha;',
      '',
    ].join('\n'),
    expectRule: 'boundaries/dependencies',
  },
];

/** Arquivo de apoio que as sondas importam. Nao deve violar nada sozinho. */
const support = {
  file: join(modulesDir, '__probe_alpha', 'alpha.ts'),
  code: 'export const alpha = 1;\n',
};

const probeDirs = [
  join(modulesDir, '__probe_alpha'),
  join(modulesDir, '__probe_beta'),
  join(modulesDir, 'platform', '__probe_invasao.ts'),
];

function writeProbes() {
  for (const { file, code } of [support, ...cases]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, code, 'utf8');
  }
}

function removeProbes() {
  for (const target of probeDirs) {
    rmSync(target, { recursive: true, force: true });
  }
}

async function main() {
  writeProbes();

  let results;
  try {
    const eslint = new ESLint({ cwd: repoRoot });
    results = await eslint.lintFiles([...cases, support].map(({ file }) => file));
  } finally {
    removeProbes();
  }

  const rulesByFile = new Map(
    results.map((result) => [
      result.filePath,
      result.messages.map((message) => message.ruleId).filter(Boolean),
    ]),
  );

  const failures = [];

  for (const { name, file, expectRule } of cases) {
    const found = rulesByFile.get(file) ?? [];
    if (!found.includes(expectRule)) {
      failures.push(
        `  ${name}\n    esperava ${expectRule}, encontrou ${found.length ? found.join(', ') : 'nenhuma violacao'}`,
      );
    }
  }

  const supportViolations = rulesByFile.get(support.file) ?? [];
  if (supportViolations.length > 0) {
    failures.push(
      `  arquivo de apoio deveria estar limpo\n    encontrou ${supportViolations.join(', ')}`,
    );
  }

  if (failures.length > 0) {
    console.error('As regras arquiteturais nao estao sendo aplicadas:\n');
    console.error(failures.join('\n\n'));
    console.error('\nVeja a ADR-0001 e a secao boundaries do eslint.config.mjs.');
    process.exit(1);
  }

  console.error(`Regras arquiteturais aplicadas: ${cases.length} de ${cases.length} verificadas.`);
}

await main();
