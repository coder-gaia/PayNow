import { type NextRequest, NextResponse } from 'next/server';

import { ACCESS_COOKIE, clearedCookieOptions, REFRESH_COOKIE } from '@/lib/session';
import { ACTIVE_ORGANIZATION_COOKIE } from '@/lib/active-organization';

/**
 * Encerra a sessão pelo lado do navegador.
 *
 * Existe porque um Server Component não pode gravar cookie. Quando o layout do
 * painel descobre, no meio da renderização, que a sessão morreu, ele não tem
 * como limpar os cookies antes de mandar para o login: redirecionar sozinho
 * deixaria o refresh token velho no navegador, e o middleware, que vê um
 * refresh token presente, mandaria de volta para o painel. O resultado seria
 * um laço de redirecionamento em vez de uma tela de login.
 *
 * Um Route Handler pode gravar cookie, então ele é o caminho de saída: limpa e
 * manda para o login com o motivo.
 *
 * É GET de propósito, porque quem chama é um redirect. Ser passível de CSRF
 * não importa aqui: o pior que um site hostil consegue é deslogar alguém, o
 * que a pessoa desfaz entrando de novo.
 */
export function GET(request: NextRequest): NextResponse {
  const motivo = request.nextUrl.searchParams.get('motivo');

  // O parâmetro fica sem acento de propósito: ele viaja na URL e é lido pela
  // página de login, e acento em query string vira escape percentual, o que
  // deixaria o endereço ilegível para quem olha a barra do navegador.
  const destino = new URL(
    motivo === null ? '/entrar' : `/entrar?sessao=${encodeURIComponent(motivo)}`,
    request.url,
  );

  const response = NextResponse.redirect(destino);

  response.cookies.set(ACCESS_COOKIE, '', clearedCookieOptions());
  response.cookies.set(REFRESH_COOKIE, '', clearedCookieOptions());
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, '', clearedCookieOptions());

  return response;
}
