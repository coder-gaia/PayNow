import 'server-only';

import { cookies } from 'next/headers';

import type { OrganizationRole, Profile } from './api';

/**
 * Organização ativa no painel.
 *
 * Até agora o painel abria sempre a primeira organização do perfil. Como
 * `POST /auth/register` sempre cria uma organização para quem se cadastra,
 * quem era convidado para outra participava de duas é nunca conseguia chegar
 * na segunda pela interface.
 *
 * A escolha vive em cookie, e não na URL, porque nenhuma rota do painel e
 * escopada por organização hoje. Quando as telas de cobrança chegarem e fizer
 * sentido compartilhar link de uma fatura específica, a organização passa para
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
 * Resolve qual organização está ativa.
 *
 * O valor do cookie é conferido contra a lista de organizações do perfil, que
 * vem da API. Um cookie adulterado não seleciona nada: cai na primeira da
 * lista. A API também barra o acesso por conta própria, então esta e a segunda
 * barreira, e não a única.
 */
export async function resolveActiveOrganization(profile: Profile): Promise<ActiveOrganization> {
  const first = profile.organizations[0];

  if (first === undefined) {
    throw new Error('Perfil sem organização. O cadastro sempre cria a primeira.');
  }

  const chosen = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;

  return profile.organizations.find((organization) => organization.id === chosen) ?? first;
}
