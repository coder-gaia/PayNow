import { z } from 'zod';

/**
 * Contrato de ambiente da aplicacao.
 *
 * A validacao acontece no boot e derruba o processo se algo estiver errado.
 * Um sistema de cobranca que sobe com DATABASE_URL apontando para o lugar
 * errado e pior do que um sistema que nao sobe.
 */

const PORT_RANGE = { min: 1, max: 65_535 } as const;

/** Aceita apenas URLs sintaticamente validas e com um dos protocolos esperados. */
const urlWithProtocol = (protocols: readonly string[], example: string) =>
  z.string().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol.replace(':', ''));
      } catch {
        return false;
      }
    },
    { message: `URL invalida. Esperado algo como "${example}".` },
  );

const port = (fallback: number) =>
  z.coerce.number().int().min(PORT_RANGE.min).max(PORT_RANGE.max).default(fallback);

/** Flag booleana vinda de variavel de ambiente, que e sempre string. */
const booleanFlag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  DATABASE_URL: urlWithProtocol(
    ['postgresql', 'postgres'],
    'postgresql://usuario:senha@localhost:5432/paynow',
  ),
  REDIS_URL: urlWithProtocol(['redis', 'rediss'], 'redis://localhost:6379'),

  /**
   * Segredo de assinatura dos tokens de acesso. O minimo de 32 caracteres nao
   * e cerimonia: uma chave HMAC menor que o tamanho do digest enfraquece a
   * assinatura sem que nada no sistema reclame.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres.'),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Ver ADR-0012: o worker roda no mesmo processo da API, ligado por flag. */
  WORKER_ENABLED: booleanFlag('false'),

  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: port(1025),
  SMTP_FROM: z.string().min(3).default('nao-responda@paynow.local'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida o ambiente e devolve o objeto tipado.
 *
 * Em caso de falha, lista todos os problemas de uma vez em vez de parar no
 * primeiro, e aponta para o .env.example.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Configuracao de ambiente invalida:\n${issues}\n\n` +
        'Compare o seu .env com o .env.example na raiz do repositorio.',
    );
  }

  return result.data;
}
