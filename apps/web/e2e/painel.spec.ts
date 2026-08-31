import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  addPerson,
  createApiKey,
  createWorkspace,
  login,
  memberRow,
  navLink,
  notice,
  PASSWORD,
  toast,
} from './support';

/**
 * Fluxo do painel com navegador de verdade.
 *
 * Cada teste monta a propria organizacao pela API antes de abrir a interface,
 * entao nao ha estado compartilhado entre eles e os dados de demonstracao
 * ficam intactos. Ver o comentario em support.ts.
 */

test.describe('autenticacao', () => {
  test('entra e sai', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await login(page, workspace.owner.email);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('recusa senha errada sem dizer se o email existe', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await page.goto('/entrar');
    await page.getByLabel('Email').fill(workspace.owner.email);
    await page.getByLabel('Senha', { exact: true }).fill('senha errada mas longa');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // A mensagem vem da API e e a mesma de email inexistente. Antes o painel
    // mostrava um generico de sessao expirada, porque tratava todo 401 igual.
    await expect(page.getByText('Email ou senha invalidos.')).toBeVisible();
  });

  test('o olho revela e esconde a senha', async ({ page }) => {
    await page.goto('/entrar');

    const senha = page.getByLabel('Senha', { exact: true });
    await senha.fill(PASSWORD);
    await expect(senha).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(senha).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(senha).toHaveAttribute('type', 'password');
  });

  test('o campo de senha nao herda o nome do botao do olho', async ({ page }) => {
    await page.goto('/entrar');

    // Regressao de acessibilidade: com o botao dentro do rotulo, o nome
    // acessivel do campo virava "Senha Mostrar senha".
    await expect(page.getByRole('textbox', { name: 'Senha', exact: true })).toBeVisible();
  });

  test('sem sessao, o painel manda para o login', async ({ page }) => {
    await page.goto('/painel/chaves');
    await expect(page).toHaveURL(/\/entrar/);
  });
});

test.describe('membros', () => {
  test('papel recusado pelo servidor volta ao valor real', async ({ page, request }) => {
    const workspace = await createWorkspace(request);

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    const papel = memberRow(page, workspace.owner.name).getByLabel(
      `Papel de ${workspace.owner.name}`,
    );
    await expect(papel).toHaveValue('OWNER');

    // Rebaixar o unico OWNER travaria a organizacao, e o servidor recusa. A
    // tela nao pode continuar mostrando ADMIN depois disso.
    await papel.selectOption('ADMIN');

    await expect(toast(page, 'ao menos um OWNER')).toBeVisible();
    await expect(papel).toHaveValue('OWNER');

    await page.reload();
    await expect(memberRow(page, workspace.owner.name).getByLabel(/Papel de/)).toHaveValue('OWNER');
  });

  test('mudanca aceita persiste e avisa', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'MEMBER');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    const papel = memberRow(page, pessoa.name).getByLabel(`Papel de ${pessoa.name}`);
    await expect(papel).toHaveValue('MEMBER');

    await papel.selectOption('READONLY');
    await expect(notice(page, 'READONLY')).toBeVisible();

    await page.reload();
    await expect(memberRow(page, pessoa.name).getByLabel(/Papel de/)).toHaveValue('READONLY');
  });

  test('remocao pede confirmacao e cancelar nao remove', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'ADMIN');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    await memberRow(page, pessoa.name).getByRole('button', { name: 'Remover' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(`Remover ${pessoa.name}`);

    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
    await expect(memberRow(page, pessoa.name)).toBeVisible();
  });

  test('remocao confirmada tira a pessoa da lista', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const pessoa = await addPerson(request, workspace, 'MEMBER');

    await login(page, workspace.owner.email);
    await navLink(page, 'Membros').click();

    await memberRow(page, pessoa.name).getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();

    await expect(notice(page, 'removida')).toBeVisible();
    await expect(memberRow(page, pessoa.name)).toHaveCount(0);
  });
});

test.describe('chaves de api', () => {
  test('cria a chave e revela o segredo uma unica vez', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Servidor de teste';

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    await page.getByLabel('Nome').fill(nome);
    await page.getByRole('button', { name: 'Criar chave' }).click();

    const aviso = notice(page, 'Chave criada');
    await expect(aviso).toBeVisible();
    // O segredo e base64url, que inclui hifen: `\w` sozinho nao cobre.
    await expect(aviso.getByText(/^sk_test_[\w-]{30,}$/)).toBeVisible();

    // Depois de recarregar sobra o prefixo, porque o servidor guarda o hash.
    await page.reload();
    await expect(notice(page, 'Chave criada')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: nome })).toBeVisible();
  });

  /**
   * Regressao. A confirmacao era aguardada dentro de `startTransition`, o que
   * prendia a transicao esperando um clique humano e deixava o botao travado
   * em "Revogando..." para sempre, sem revogar nada.
   */
  test('revoga a chave depois de confirmar no dialogo', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Chave descartavel';
    await createApiKey(request, workspace, nome);

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    const linha = page.getByRole('row').filter({ hasText: nome });
    await linha.getByRole('button', { name: 'Revogar' }).click();

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(`Revogar "${nome}"`);
    await dialogo.getByRole('button', { name: 'Revogar' }).click();

    await expect(dialogo).toBeHidden();
    await expect(notice(page, 'foi revogada')).toBeVisible();
    await expect(linha.getByText('REVOGADA')).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('row').filter({ hasText: nome }).getByText('REVOGADA'),
    ).toBeVisible();
  });

  test('cancelar o dialogo nao revoga', async ({ page, request }) => {
    const workspace = await createWorkspace(request);
    const nome = 'Chave preservada';
    await createApiKey(request, workspace, nome);

    await login(page, workspace.owner.email);
    await navLink(page, 'Chaves de API').click();

    const linha = page.getByRole('row').filter({ hasText: nome });
    await linha.getByRole('button', { name: 'Revogar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await expect(linha.getByRole('button', { name: 'Revogar' })).toBeEnabled();
    await expect(linha.getByText('REVOGADA')).toHaveCount(0);
  });
});

/**
 * Estes dois usam as contas de demonstracao, e nao uma organizacao criada na
 * hora, por uma limitacao que o painel ainda tem: `/auth/register` sempre cria
 * uma organizacao para quem se cadastra, entao alguem convidado participa de
 * duas, e o painel abre sempre a primeira, que e a propria. Sem seletor de
 * organizacao nao ha como chegar na outra pela interface.
 *
 * As contas do seed nascem sem organizacao propria, entao servem. Como os dois
 * testes apenas leem, nao sujam os dados de demonstracao.
 */
test.describe('restricoes por papel', () => {
  const MEMBER_DEMO = 'carla@livraria-aurora.test';
  const SENHA_DEMO = 'paynow-demo-2026';

  const entrarComoMembroDemo = async (page: Page): Promise<void> => {
    await page.goto('/entrar');
    await page.getByLabel('Email').fill(MEMBER_DEMO);
    await page.getByLabel('Senha', { exact: true }).fill(SENHA_DEMO);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/);
  };

  test('MEMBER nao administra chaves', async ({ page }) => {
    await entrarComoMembroDemo(page);

    await page.goto('/painel/chaves');
    await expect(page.getByText(/administradas por OWNER e ADMIN/)).toBeVisible();
  });

  test('MEMBER ve a lista de membros em modo leitura', async ({ page }) => {
    await entrarComoMembroDemo(page);

    await page.goto('/painel/membros');
    await expect(page.getByText(/somente leitura/)).toBeVisible();
    await expect(page.getByLabel(/Papel de/)).toHaveCount(0);
  });
});
