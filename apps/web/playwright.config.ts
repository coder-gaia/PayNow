import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de interface.
 *
 * Existem porque a fase 01 do painel entregou dois bugs que só aparecem com o
 * navegador de verdade: um `<select>` não controlado que mantinha na tela um
 * papel recusado pelo servidor, e um botão preso em "Revogando..." porque a
 * confirmação esperava um clique dentro de uma transição do React. Nenhum dos
 * dois seria pego por teste de unidade ou por teste de API.
 *
 * Exigem a pilha inteira de pé: PostgreSQL, Redis, a API e os dados de
 * demonstração. Ver o README.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: process.env['CI'] === 'true' ? 1 : 0,
  // Serial de propósito: os testes compartilham a organização de demonstração,
  // e rodar em paralelo faria um mexer no papel que o outro está conferindo.
  workers: 1,
  reporter: process.env['CI'] === 'true' ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env['PAYNOW_WEB_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
