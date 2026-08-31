import { type NextRequest, NextResponse } from 'next/server';

import {
  ACCESS_COOKIE,
  accessCookieOptions,
  clearedCookieOptions,
  needsRenewal,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './lib/session';

const API_URL = process.env['PAYNOW_API_URL'] ?? 'http://localhost:3333/v1';

const LOGIN_PATH = '/entrar';
const DASHBOARD_PATH = '/painel';

/**
 * Ciclo de vida do token, resolvido antes de qualquer página renderizar.
 *
 * O middleware é o único lugar do Next que consegue ler e escrever cookie no
 * mesmo request. Renovar aqui, e não dentro das páginas, evita o padrão de
 * cada Server Component tentar renovar por conta própria e descobrir que não
 * pode gravar o cookie novo.
 *
 * A renovação e proativa: acontece quando falta menos de um minuto para o
 * token expirar, e não depois de tomar 401. Assim uma página nunca renderiza
 * pela metade por causa de um token que venceu no meio do carregamento.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  const isProtected = pathname.startsWith(DASHBOARD_PATH);
  const isAuthPage = pathname === LOGIN_PATH || pathname === '/criar-conta';

  if (refreshToken === undefined) {
    if (isProtected) {
      return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
    }
    return NextResponse.next();
  }

  // Já autenticado e indo para o login: manda para o painel.
  if (isAuthPage) {
    return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
  }

  if (!needsRenewal(accessToken, Date.now())) {
    return NextResponse.next();
  }

  const renewed = await renew(refreshToken);

  if (renewed === null) {
    // Refresh recusado: sessão encerrada, possivelmente por detecção de reuso.
    const response = isProtected
      ? NextResponse.redirect(new URL(`${LOGIN_PATH}?sessao=expirada`, request.url))
      : NextResponse.next();

    response.cookies.set(ACCESS_COOKIE, '', clearedCookieOptions());
    response.cookies.set(REFRESH_COOKIE, '', clearedCookieOptions());
    return response;
  }

  const response = NextResponse.next();
  response.cookies.set(
    ACCESS_COOKIE,
    renewed.accessToken,
    accessCookieOptions(renewed.expiresInSeconds),
  );
  response.cookies.set(REFRESH_COOKIE, renewed.refreshToken, refreshCookieOptions());
  return response;
}

interface RenewedSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

async function renew(refreshToken: string): Promise<RenewedSession | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as RenewedSession;
  } catch {
    // API fora do ar não deve derrubar a sessão de quem está navegando.
    return null;
  }
}

export const config = {
  // Fora da lista: arquivos estáticos e as rotas internas do Next, que nunca
  // precisam de sessão e só somariam latência se passassem por aqui.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
