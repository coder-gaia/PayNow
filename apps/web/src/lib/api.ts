import 'server-only';

import { cookies } from 'next/headers';

import { ACCESS_COOKIE } from './session';

/**
 * Cliente da API do Paynow, usado apenas no servidor.
 *
 * A fase 08 troca este arquivo por um cliente gerado a partir do contrato
 * OpenAPI, que a API ja publica em /docs/openapi.json. Ate la os tipos sao
 * escritos a mao, e a duplicacao e consciente: gerar cliente antes de o
 * contrato estabilizar produz ruido a cada mudanca de rota.
 */

const API_URL = process.env['PAYNOW_API_URL'] ?? 'http://localhost:3333/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Sessao invalida ou expirada. Quem chama redireciona para o login. */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, 'Sessao expirada.');
    this.name = 'UnauthenticatedError';
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Sem token: usado por login e cadastro. */
  readonly anonymous?: boolean;
}

/**
 * Chama a API repassando o token de acesso guardado no cookie.
 *
 * A renovacao do token acontece no middleware, antes do request chegar aqui.
 * Um 401 neste ponto significa que a sessao acabou de verdade.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (options.anonymous !== true) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;

    if (token === undefined) {
      throw new UnauthenticatedError();
    }

    headers['authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
  });

  // Um 401 em chamada autenticada significa que a sessao acabou, e quem chamou
  // redireciona para o login. Em chamada anonima significa outra coisa
  // completamente: a credencial que a pessoa acabou de digitar esta errada, e
  // a mensagem da API e que precisa chegar ao formulario. Tratar os dois casos
  // igual fazia o login com senha errada dizer "Sessao expirada".
  if (response.status === 401 && options.anonymous !== true) {
    throw new UnauthenticatedError();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(payload, response.status));
  }

  return payload as T;
}

/**
 * Extrai a mensagem de erro da API.
 *
 * O Nest devolve `message` como string ou como lista, quando a validacao
 * reprova varios campos. As duas formas viram texto legivel para a interface.
 */
function extractMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload;

    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === 'string').join('. ');
    }
  }

  return `A API respondeu ${status}.`;
}

// ---------------------------------------------------------------------------
// Contratos, espelhando o que a API devolve hoje
// ---------------------------------------------------------------------------

export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'READONLY';
export type ApiKeyEnvironment = 'TEST' | 'LIVE';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; name: string };
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  organizations: { id: string; name: string; slug: string; role: OrganizationRole }[];
}

export interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  apiKeyCount: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  environment: ApiKeyEnvironment;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKey {
  secret: string;
}

export interface AccountBalance {
  code: string;
  label: string;
  kind: string;
  normalBalance: 'debit' | 'credit';
  balanceMinor: string;
  balance: string;
  currency: string;
  lineCount: number;
}

export interface JournalLine {
  id: string;
  account: string;
  amountMinor: string;
  amount: string;
  currency: string;
}

export interface JournalEntry {
  id: string;
  eventType: string;
  eventId: string;
  description: string;
  occurredAt: string;
  createdAt: string;
  total: string;
  lines: JournalLine[];
}

export interface LedgerVerification {
  checkedAt: string;
  entryCount: number;
  lineCount: number;
  balanced: boolean;
  violations: string[];
}

export const api = {
  profile: () => apiFetch<Profile>('/auth/me'),
  organization: (id: string) => apiFetch<OrganizationDetail>(`/organizations/${id}`),
  members: (id: string) => apiFetch<Member[]>(`/organizations/${id}/members`),
  apiKeys: (id: string) => apiFetch<ApiKey[]>(`/organizations/${id}/api-keys`),
  ledgerBalances: (id: string) =>
    apiFetch<AccountBalance[]>(`/organizations/${id}/ledger/balances`),
  ledgerEntries: (id: string) => apiFetch<JournalEntry[]>(`/organizations/${id}/ledger/entries`),
  ledgerVerification: (id: string) =>
    apiFetch<LedgerVerification>(`/organizations/${id}/ledger/verification`),
};
