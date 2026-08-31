'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ACTIVE_ORGANIZATION_COOKIE } from './active-organization';
import { ApiError, apiFetch, type CreatedApiKey, type OrganizationRole, type Session } from './api';
import {
  ACCESS_COOKIE,
  accessCookieOptions,
  clearedCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './session';

/**
 * Ações do painel.
 *
 * Toda mutação passa por aqui, no servidor, e nenhuma resposta com token chega
 * ao navegador: os tokens são gravados em cookie httpOnly e ficam do lado de
 * ca. Ver o comentario em session.ts para o motivo.
 */

export interface FormState {
  readonly error?: string;
  readonly ok?: boolean;
  /** Segredo recem criado, exibido uma única vez. */
  readonly secret?: string;
}

/**
 * Le um campo de texto do formulario.
 *
 * `FormData.get` devolve string ou File. Passar um File por `String()` produz
 * "[object Object]" em silêncio, então o tipo é verificado e um envio
 * inesperado cai no padrão em vez de virar dado corrompido.
 */
function text(formData: FormData, field: string, fallback = ''): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : fallback;
}

async function persistSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, session.accessToken, accessCookieOptions(session.expiresInSeconds));
  jar.set(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
}

/** Converte a falha da API em mensagem de formulario, sem vazar detalhe interno. */
function toFormState(error: unknown): FormState {
  if (error instanceof ApiError) {
    return { error: error.message };
  }

  return { error: 'Não foi possível falar com a API. Ela está no ar?' };
}

export async function login(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, 'email');
  const password = text(formData, 'password');

  try {
    const session = await apiFetch<Session>('/auth/login', {
      method: 'POST',
      anonymous: true,
      body: { email, password },
    });

    await persistSession(session);
  } catch (error) {
    return toFormState(error);
  }

  redirect('/painel');
}

export async function register(_previous: FormState, formData: FormData): Promise<FormState> {
  const body = {
    name: text(formData, 'name'),
    email: text(formData, 'email'),
    password: text(formData, 'password'),
    organizationName: text(formData, 'organizationName'),
  };

  try {
    const session = await apiFetch<Session>('/auth/register', {
      method: 'POST',
      anonymous: true,
      body,
    });

    await persistSession(session);
  } catch (error) {
    return toFormState(error);
  }

  redirect('/painel');
}

/**
 * Troca a organização ativa.
 *
 * Não verifica se a pessoa participa da organização: quem faz isso é
 * `resolveActiveOrganization`, que confere o cookie contra a lista real vinda
 * da API a cada renderizacao. Validar aqui também seria uma segunda copia da
 * mesma regra, que pode divergir.
 */
export async function selectOrganization(organizationId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/painel', 'layout');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken !== undefined) {
    try {
      await apiFetch<void>('/auth/logout', {
        method: 'POST',
        anonymous: true,
        body: { refreshToken },
      });
    } catch {
      // Se a API recusar, o cookie sai do navegador do mesmo jeito: do ponto de
      // vista de quem clicou em sair, a sessão acabou.
    }
  }

  jar.set(ACCESS_COOKIE, '', clearedCookieOptions());
  jar.set(REFRESH_COOKIE, '', clearedCookieOptions());
  jar.set(ACTIVE_ORGANIZATION_COOKIE, '', clearedCookieOptions());

  redirect('/entrar');
}

export async function addMember(
  organizationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiFetch(`/organizations/${organizationId}/members`, {
      method: 'POST',
      body: {
        email: text(formData, 'email'),
        role: text(formData, 'role', 'MEMBER') as OrganizationRole,
      },
    });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath('/painel/membros');
  return { ok: true };
}

export async function changeMemberRole(
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<FormState> {
  try {
    await apiFetch(`/organizations/${organizationId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath('/painel/membros');
  return { ok: true };
}

export async function removeMember(organizationId: string, userId: string): Promise<FormState> {
  try {
    await apiFetch(`/organizations/${organizationId}/members/${userId}`, { method: 'DELETE' });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath('/painel/membros');
  return { ok: true };
}

export async function createApiKey(
  organizationId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const created = await apiFetch<CreatedApiKey>(`/organizations/${organizationId}/api-keys`, {
      method: 'POST',
      body: {
        name: text(formData, 'name'),
        environment: text(formData, 'environment', 'TEST'),
      },
    });

    revalidatePath('/painel/chaves');
    return { ok: true, secret: created.secret };
  } catch (error) {
    return toFormState(error);
  }
}

export async function revokeApiKey(organizationId: string, apiKeyId: string): Promise<FormState> {
  try {
    await apiFetch(`/organizations/${organizationId}/api-keys/${apiKeyId}`, { method: 'DELETE' });
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath('/painel/chaves');
  return { ok: true };
}
