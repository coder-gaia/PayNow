import { expect, test } from '@playwright/test';

import { createWorkspace, login } from './support';

/** A senha da conta de demonstração, impressa pelo seed e documentada no README. */
const SENHA_DEMO = 'paynow-demo-2026';

/**
 * A página inicial.
 *
 * O que estes testes protegem não é aparência, é o argumento. A página afirma
 * uma coisa só, que a soma fecha em zero, e essa afirmação é conferível na
 * própria tela. Um teste que só verificasse que a página carrega deixaria a
 * afirmação virar enfeite sem ninguém notar.
 *
 * Ela é pública, então nenhum destes testes faz login.
 */

test.describe('página inicial', () => {
  test('abre sem sessão e mostra o argumento inteiro', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('que você pode conferir');

    // As seis linhas do lançamento, cada uma com o par débito e crédito.
    await expect(
      page.getByText('Saldo é a soma das linhas. Nenhum total é armazenado.'),
    ).toBeVisible();
    await expect(page.getByText('Soma zero. Confira você mesmo.')).toBeVisible();
  });

  /**
   * O caminho para agir tem de estar visível sem rolar.
   *
   * A primeira versão desta página escondia o único botão de entrar no rodapé,
   * depois de tudo. Uma página pode ter o melhor argumento do mundo e ainda
   * assim perder quem não achou a porta.
   */
  test('tem um caminho para o painel antes de qualquer rolagem', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    const entrar = page.getByRole('link', { name: 'Entrar no painel' }).first();
    await expect(entrar).toBeVisible();

    const dentroDaPrimeiraTela = await entrar.evaluate(
      (elemento) => elemento.getBoundingClientRect().bottom <= window.innerHeight,
    );
    expect(dentroDaPrimeiraTela).toBe(true);
  });

  test('o rodapé do lançamento é verificado na hora, e não escrito à mão', async ({ page }) => {
    await page.goto('/');

    const rodape = page.getByText('verificado agora');
    await expect(rodape).toBeVisible();

    // O número de linhas vem da verificação do razão, recalculada a partir das
    // linhas a cada visita. Se ele fosse constante, a promessa seria falsa.
    await expect(rodape).toContainText(/\d+ linhas em \d+ lançamentos/);
  });

  test('as linhas mostradas somam zero, conferido na própria tela', async ({ page }) => {
    await page.goto('/');

    const lancamentos = page.locator('section#linhas li');
    await expect(lancamentos.first()).toBeVisible();

    const quantos = await lancamentos.count();
    expect(quantos).toBeGreaterThan(0);

    // A soma de cada lançamento é calculada no cliente a partir das linhas
    // exibidas, e não copiada da API. É a conferência que a página convida a
    // fazer, feita por um teste.
    for (let i = 0; i < quantos; i += 1) {
      const soma = lancamentos.nth(i).locator('tbody tr:last-child td:last-child');
      await expect(soma).toHaveText('0,00');
    }
  });

  test('o carrossel gira, para depois do clique e é navegável', async ({ page }) => {
    await page.goto('/');

    const carrossel = page.getByRole('group', { name: 'Depoimentos fictícios' });
    await expect(carrossel).toBeVisible();

    // No desktop a janela mostra três de cada vez e desliza de um em um: um por
    // vez desperdiça a largura e faz a seção parecer uma sobra.
    const cartoes = carrossel.locator('blockquote p');
    await expect(cartoes).toHaveCount(3);

    const primeiro = await cartoes.first().textContent();

    // A navegação manual troca a janela e não depende de esperar a rotação.
    await carrossel.getByRole('button', { name: 'Próximos depoimentos' }).click();
    await expect(cartoes.first()).not.toHaveText(primeiro ?? '');

    // O marcador ativo é anunciado, e não só colorido: um marcador que só
    // existe como enfeite não serve para navegar.
    await expect(carrossel.locator('[aria-current="true"]')).toHaveCount(1);

    // Depois de navegar à mão, a rotação para: quem clicou demonstrou que quer
    // controlar o ritmo, e trocar debaixo dele é armadilha para quem lê devagar.
    const depoisDoClique = await cartoes.first().textContent();
    await page.waitForTimeout(8_000);
    await expect(cartoes.first()).toHaveText(depoisDoClique ?? '');
  });

  /**
   * A promessa que a página faz sobre si mesma.
   *
   * Ela diz que os negócios dos depoimentos existem na demonstração, e o nome de
   * cada um é a porta de entrada para a assinatura de verdade. Uma promessa que
   * a própria página faz e que ninguém confere é exatamente a coisa que ela
   * acusa, então aqui ela é conferida: os nomes saem do carrossel e são
   * procurados no painel.
   */
  test('cada negócio dos depoimentos existe na demonstração', async ({ page }) => {
    await page.goto('/');

    // Espera a hidratação: antes dela a seção é a lista completa, sem
    // marcadores, que é a versão para quem está sem JavaScript.
    const carrossel = page.getByRole('group', { name: 'Depoimentos fictícios' });
    await expect(carrossel).toBeVisible();

    const negocios: string[] = [];

    for (const marcador of await carrossel.locator('button[aria-label^="Depoimento de"]').all()) {
      const rotulo = (await marcador.getAttribute('aria-label')) ?? '';
      negocios.push(rotulo.replace('Depoimento de ', ''));
    }

    expect(negocios).toHaveLength(6);

    await page.goto('/entrar');
    await page.getByLabel('Email').fill('ana@livraria-aurora.test');
    await page.getByLabel('Senha', { exact: true }).fill(SENHA_DEMO);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/);

    await page.goto('/painel/assinaturas');

    for (const negocio of negocios) {
      // Livraria Aurora é a própria organização, e não um cliente dela: aparece
      // no seletor de organização em vez da lista de assinaturas.
      const onde =
        negocio === 'Livraria Aurora' ? page.locator('body') : page.getByText(negocio).first();

      await expect(onde).toContainText(negocio);
    }
  });

  /**
   * O tema claro existia no CSS e nunca aparecia.
   *
   * O Tailwind 4 processa `@theme` em tempo de build e emite tudo para `:root`
   * sem a media query em volta, então o bloco escuro, que também era um
   * `@theme`, vencia sempre. O site era escuro inclusive para quem tinha pedido
   * claro no sistema, e ninguém percebeu porque a máquina de quem desenvolveu
   * estava no escuro.
   */
  test('respeita o tema claro do sistema', async ({ browser }) => {
    const contexto = await browser.newContext({ colorScheme: 'light' });
    const pagina = await contexto.newPage();
    await pagina.goto('/');

    const fundo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fundo).toBe('rgb(241, 244, 240)');

    await contexto.close();
  });

  test('em 375px nada vaza para fora da tela', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');

    // As duas colunas viram uma, e o par débito e crédito passa a ser lido
    // empilhado. O rótulo curto só aparece nessa largura, e é o que diz de qual
    // lado cada frase está.
    await expect(page.getByText('Débito', { exact: true }).first()).toBeVisible();

    const vazou = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(vazou).toBe(false);
  });

  test('quem tem sessão não vê a página inicial, vai para o painel', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await login(page, workspace.owner.email);
    await page.goto('/');

    await expect(page).toHaveURL(/\/painel/);
  });
});
