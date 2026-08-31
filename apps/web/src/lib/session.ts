import 'server-only';

/**
 * Ciclo de vida da sessao no painel.
 *
 * Os tokens vivem em cookie `httpOnly`, e nao em `localStorage`. A diferenca
 * importa: qualquer script injetado na pagina le `localStorage`, e um token de
 * acesso roubado por XSS vale por quinze minutos, enquanto um refresh token
 * roubado vale por trinta dias. Cookie `httpOnly` nao e legivel por JavaScript,
 * entao o navegador guarda o segredo e o servidor do Next e o unico que o usa.
 *
 * Isso torna o painel um BFF: o navegador nunca fala direto com a API do
 * Paynow, e nenhum token aparece em resposta que chegue ao cliente.
 */

export const ACCESS_COOKIE = 'paynow_access';
export const REFRESH_COOKIE = 'paynow_refresh';

/** Trinta dias, o mesmo horizonte do refresh token emitido pela API. */
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

const baseOptions = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  // `lax` deixa o cookie viajar em navegacao vinda de fora, que e o que um
  // link para o painel precisa, e barra envio em request de outro site.
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export const accessCookieOptions = (expiresInSeconds: number): CookieOptions =>
  baseOptions(expiresInSeconds);

export const refreshCookieOptions = (): CookieOptions => baseOptions(REFRESH_MAX_AGE_SECONDS);

/** Opcoes para apagar um cookie. */
export const clearedCookieOptions = (): CookieOptions => baseOptions(0);

/**
 * Momento de expiracao do token de acesso, em milissegundos.
 *
 * Le a claim `exp` sem verificar a assinatura, o que basta e e seguro para o
 * uso que se faz dela: decidir quando renovar. Quem valida o token de verdade
 * e a API, que tem o segredo. O painel so precisa saber se vale a pena tentar.
 */
export function accessTokenExpiresAt(token: string): number | null {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return null;
  }

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'exp' in decoded &&
      typeof decoded.exp === 'number'
    ) {
      return decoded.exp * 1000;
    }
  } catch {
    // Token ilegivel e tratado como expirado: o proximo passo e renovar.
  }

  return null;
}

/** Margem para renovar antes de expirar, evitando corrida com o relogio. */
export const RENEWAL_MARGIN_MS = 60_000;

export function needsRenewal(token: string | undefined, now: number): boolean {
  if (token === undefined) {
    return true;
  }

  const expiresAt = accessTokenExpiresAt(token);
  return expiresAt === null || expiresAt - now <= RENEWAL_MARGIN_MS;
}
