/**
 * Conventional Commits, validado no CI (ver .github/workflows/ci.yml).
 *
 * A validacao roda no pipeline e nao em git hook por decisao deliberada:
 * hooks locais falham de forma diferente entre Windows, macOS e Linux, e uma
 * regra de qualidade que so vale em algumas maquinas nao e uma regra.
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
        'catalog',
        'subscriptions',
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
