/**
 * Conventional Commits, validado no CI (ver .github/workflows/ci.yml).
 *
 * A validação roda no pipeline e não em git hook por decisão deliberada:
 * hooks locais falham de forma diferente entre Windows, macOS e Linux, e uma
 * regra de qualidade que só vale em algumas máquinas não é uma regra.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'money',
        'contracts',
        'ledger',
        'identity',
        'billing',
        'payments',
        'webhooks',
        'platform',
        'db',
        'chaos',
        'infra',
        'ci',
        'docs',
        'deps',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
  },
};
