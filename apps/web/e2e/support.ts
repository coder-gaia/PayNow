import { type APIRequestContext, expect, type Page } from '@playwright/test';

/**
 * Preparo dos testes de interface.
 *
 * Cada teste monta a própria organização chamando a API direto, e só depois
 * exercita a interface. Duas razões:
 *
 * 1. Os dados de demonstracao pertencem a quem está usando o projeto. Uma
 *    suíte que muda o papel da Carla e enche a lista de chaves deixa o painel
 *    pior a cada execução.
 * 2. Estado compartilhado entre testes produz falha intermitente, que é o pior
 *    tipo: some quando se olha e volta quando não se olha.
 *
 * Montar por API e não pela interface é proposital: preparo não é o que está
 * sendo verificado, e passar por telas só tornaria o teste mais lento e mais
 * frágil.
 */

const API_URL = process.env['PAYNOW_API_URL'] ?? 'http://localhost:3333/v1';

export const PASSWORD = 'senha longa de teste automatizado';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'READONLY';

export interface Person {
  readonly email: string;
  readonly name: string;
  readonly userId: string;
}

export interface Workspace {
  readonly organizationId: string;
  readonly owner: Person;
  readonly accessToken: string;
}

const unique = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function json<T>(
  request: APIRequestContext,
  method: 'post' | 'get',
  path: string,
  options: { data?: unknown; token?: string } = {},
): Promise<T> {
  const response = await request[method](`${API_URL}${path}`, {
    ...(options.data === undefined ? {} : { data: options.data }),
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
  });

  expect(
    response.ok(),
    `${method.toUpperCase()} ${path} respondeu ${response.status()}: ${await response.text()}`,
  ).toBe(true);

  return (await response.json()) as T;
}

/**
 * Cria uma conta com organização própria e devolve o contexto para agir nela.
 *
 * O rótulo entra no endereço de email, então precisa ser ASCII: email com
 * acento na parte local é recusado pela validação da API.
 */
export async function createWorkspace(
  request: APIRequestContext,
  label = 'org',
): Promise<Workspace> {
  const email = `${unique(label)}@paynow.test`;
  const name = `Dona ${label}`;

  const session = await json<{ accessToken: string }>(request, 'post', '/auth/register', {
    data: { email, password: PASSWORD, name, organizationName: `Loja ${unique('t')}` },
  });

  const profile = await json<{ id: string; organizations: { id: string }[] }>(
    request,
    'get',
    '/auth/me',
    { token: session.accessToken },
  );

  return {
    organizationId: profile.organizations[0]!.id,
    owner: { email, name, userId: profile.id },
    accessToken: session.accessToken,
  };
}

/** Cria uma conta nova e a coloca na organização com o papel pedido. */
export async function addPerson(
  request: APIRequestContext,
  workspace: Workspace,
  role: Role,
): Promise<Person> {
  const email = `${unique(role.toLowerCase())}@paynow.test`;
  const name = `Pessoa ${role}`;

  await json(request, 'post', '/auth/register', {
    data: { email, password: PASSWORD, name, organizationName: `Pessoal ${unique('p')}` },
  });

  const membership = await json<{ userId: string }>(
    request,
    'post',
    `/organizations/${workspace.organizationId}/members`,
    { data: { email, role }, token: workspace.accessToken },
  );

  return { email, name, userId: membership.userId };
}

/** Cria uma chave de API pela API, quando o teste precisa de uma já existente. */
export async function createApiKey(
  request: APIRequestContext,
  workspace: Workspace,
  name: string,
): Promise<{ id: string; prefix: string }> {
  return json(request, 'post', `/organizations/${workspace.organizationId}/api-keys`, {
    data: { name, environment: 'TEST' },
    token: workspace.accessToken,
  });
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
}

/**
 * Toast pelo texto.
 *
 * O Next mantém um anunciador de rota com `role="alert"` fixo na página, então
 * procurar só pelo papel encontra dois elementos.
 */
export const toast = (page: Page, text: string) =>
  page.getByRole('alert').filter({ hasText: text });

export const notice = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text });

export const memberRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

export const navLink = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('link', { name });
