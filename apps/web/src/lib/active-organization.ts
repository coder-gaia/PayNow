import 'server-only';

import { cookies } from 'next/headers';

import type { OrganizationRole, Profile } from './api';

/**
 * Organizacao ativa no painel.
 *
 * Ate agora o painel abria sempre a primeira organizacao do perfil. Como
 * `POST /auth/register` sempre cria uma organizacao para quem se cadastra,
 * quem era convidado para outra participava de duas e nunca conseguia chegar
 * na segunda pela interface.
 *
 * A escolha vive em cookie, e nao na URL, porque nenhuma rota do painel e
 * escopada por organizacao hoje. Quando as telas de cobranca chegarem e fizer
 * sentido compartilhar link de uma fatura especifica, a organizacao passa para
 * o caminho e este arquivo vira um redirecionador.
 */

export const ACTIVE_ORGANIZATION_COOKIE = 'paynow_org';

export interface ActiveOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: OrganizationRole;
}

/**
 * Resolve qual organizacao esta ativa.
 *
 * O valor do cookie e conferido contra a lista de organizacoes do perfil, que
 * vem da API. Um cookie adulterado nao seleciona nada: cai na primeira da
 * lista. A API tambem barra o acesso por conta propria, entao esta e a segunda
 * barreira, e nao a unica.
 */
export async function resolveActiveOrganization(profile: Profile): Promise<ActiveOrganization> {
  const first = profile.organizations[0];

  if (first === undefined) {
    throw new Error('Perfil sem organizacao. O cadastro sempre cria a primeira.');
  }

  const chosen = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;

  return profile.organizations.find((organization) => organization.id === chosen) ?? first;
}
