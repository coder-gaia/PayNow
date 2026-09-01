import 'server-only';

import { cookies } from 'next/headers';

import { ACCESS_COOKIE } from './session';

/**
 * Cliente da API do Paynow, usado apenas no servidor.
 *
 * A fase 08 troca este arquivo por um cliente gerado a partir do contrato
 * OpenAPI, que a API já publica em /docs/openapi.json. Até lá os tipos são
 * escritos a mão, e a duplicação é consciente: gerar cliente antes de o
 * contrato estabilizar produz ruído a cada mudança de rota.
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

/** Sessão inválida ou expirada. Quem chama redireciona para o login. */
export class UnauthenticatedError extends ApiError {
  constructor() {
    super(401, 'Sessão expirada.');
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
 * A renovação do token acontece no middleware, antes do request chegar aqui.
 * Um 401 neste ponto significa que a sessão acabou de verdade.
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

  // Um 401 em chamada autenticada significa que a sessão acabou, e quem chamou
  // redireciona para o login. Em chamada anônima significa outra coisa
  // completamente: a credencial que a pessoa acabou de digitar está errada, e
  // a mensagem da API é que precisa chegar ao formulário. Tratar os dois casos
  // igual fazia o login com senha errada dizer "Sessão expirada".
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
 * O Nest devolve `message` como string ou como lista, quando a validação
 * reprova vários campos. As duas formas viram texto legível para a interface.
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
  /** O que a conta significa, em português. Ver docs/plano-de-contas.md. */
  description: string;
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
  /** Nome legível da conta, vindo do plano de contas. */
  label: string;
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

export type SubscriptionStatus =
  'INCOMPLETE' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID';

export interface Plan {
  priceId: string;
  product: string;
  amount: string;
  currency: string;
  interval: string;
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  hasAccess: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  version: number;
  customer: { id: string; name: string; email: string };
  plan: Plan;
}

export interface SubscriptionDetail extends Subscription {
  allowedTransitions: SubscriptionStatus[];
  canceledAt: string | null;
  history: {
    id: string;
    from: SubscriptionStatus | null;
    to: SubscriptionStatus;
    reason: string | null;
    occurredAt: string;
  }[];
}

export interface Price {
  id: string;
  amountMinor: string;
  amount: string;
  currency: string;
  interval: string;
  intervalCount: number;
  trialDays: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  prices: Price[];
}

/** O que a troca de plano devolve: o rateio calculado, em reais. */
export interface Proration {
  credit: string;
  charge: string;
  net: string;
  currency: string;
  remainingDays: number;
  cycleDays: number;
}

/**
 * Estado do relógio da organização. Ver ADR-0015.
 *
 * `virtual` falso significa relógio de parede, que é o caso comum. Congelado,
 * `now` é o instante parado e `advancedDays` diz quanto de tempo virtual já
 * foi percorrido desde o congelamento.
 */
export interface ClockState {
  virtual: boolean;
  now: string;
  frozenSince: string | null;
  advancedDays: number;
  advancedMs: number;
}

export type CycleAction = 'renovada' | 'ativada' | 'encerrada' | 'expirada';

export interface CycleEffect {
  subscriptionId: string;
  customerName: string;
  action: CycleAction;
  at: string;
}

export interface CycleReport {
  ranAt: string;
  effects: CycleEffect[];
}

export type InvoiceStatus = 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface PaymentAttempt {
  id: string;
  attempt: number;
  status: PaymentStatus;
  gateway: string;
  gatewayRef: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  retriable: boolean | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number: number;
  status: InvoiceStatus;
  amount: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  paidAt: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  customer: { id: string; name: string; email: string };
  payments: PaymentAttempt[];
}

export interface InvoiceDetail extends Invoice {
  plan: string | null;
}

export interface Refund {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amount: string;
  currency: string;
  reason: string;
  invoiceNumber: number;
  customerName: string;
  createdAt: string;
}

/** O calendário de recuperação, para a interface poder explicá-lo. */
export interface DunningSchedule {
  maxAttempts: number;
  scheduleHours: number[];
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
  subscriptions: (id: string) => apiFetch<Subscription[]>(`/organizations/${id}/subscriptions`),
  subscription: (id: string, subscriptionId: string) =>
    apiFetch<SubscriptionDetail>(`/organizations/${id}/subscriptions/${subscriptionId}`),
  products: (id: string) => apiFetch<Product[]>(`/organizations/${id}/products`),
  clock: (id: string) => apiFetch<ClockState>(`/organizations/${id}/clock`),
  invoices: (id: string) => apiFetch<Invoice[]>(`/organizations/${id}/invoices`),
  invoice: (id: string, invoiceId: string) =>
    apiFetch<InvoiceDetail>(`/organizations/${id}/invoices/${invoiceId}`),
  refunds: (id: string) => apiFetch<Refund[]>(`/organizations/${id}/refunds`),
  dunning: (id: string) => apiFetch<DunningSchedule>(`/organizations/${id}/dunning`),
};
