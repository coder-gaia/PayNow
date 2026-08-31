import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://paynow:paynow@localhost:5432/paynow',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(48),
};

describe('validateEnv', () => {
  it('aceita o mínimo necessário e aplica os padrões', () => {
    const env = validateEnv({ ...valid });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3333);
    expect(env.WORKER_ENABLED).toBe(false);
    expect(env.SMTP_PORT).toBe(1025);
  });

  it('converte a porta de string para número', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('converte a flag do worker para booleano', () => {
    expect(validateEnv({ ...valid, WORKER_ENABLED: 'true' }).WORKER_ENABLED).toBe(true);
    expect(validateEnv({ ...valid, WORKER_ENABLED: 'false' }).WORKER_ENABLED).toBe(false);
  });

  it('recusa flag que não seja true ou false', () => {
    expect(() => validateEnv({ ...valid, WORKER_ENABLED: 'sim' })).toThrow(/WORKER_ENABLED/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => validateEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('recusa segredo de JWT curto demais para a assinatura', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/);
  });

  it('aplica os padrões de expiração de token', () => {
    const env = validateEnv({ ...valid });

    expect(env.JWT_ACCESS_TTL_MINUTES).toBe(15);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
  });

  it('recusa DATABASE_URL com protocolo errado', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost:3306/paynow' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('recusa REDIS_URL que não e URL', () => {
    expect(() => validateEnv({ ...valid, REDIS_URL: 'localhost:6379' })).toThrow(/REDIS_URL/);
  });

  it('recusa porta fora da faixa', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...valid, PORT: '0' })).toThrow(/PORT/);
  });

  it('lista todos os problemas de uma vez, e não apenas o primeiro', () => {
    let message = '';
    try {
      validateEnv({
        DATABASE_URL: 'não-e-url',
        REDIS_URL: 'também-não',
        PORT: '-1',
        JWT_SECRET: valid.JWT_SECRET,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/\.env\.example/);
  });
});
