import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp, DEFAULT_PASSWORD, httpServer, uniqueEmail } from './support/app';

describe('Autenticação (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (email: string) =>
    request(httpServer(app)).post('/v1/auth/register').send({
      email,
      password: DEFAULT_PASSWORD,
      name: 'Pessoa de Teste',
      organizationName: 'Organização de Teste',
    });

  describe('POST /v1/auth/register', () => {
    it('cria conta, organização e sessão de uma vez', async () => {
      const email = uniqueEmail();
      const response = await register(email).expect(201);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.expiresInSeconds).toBe(900);
      expect(response.body.user.email).toBe(email);

      const profile = await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Bearer ${response.body.accessToken}`)
        .expect(200);

      expect(profile.body.organizations).toHaveLength(1);
      expect(profile.body.organizations[0].role).toBe('OWNER');
    });

    it('recusa email já cadastrado', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);
      await register(email).expect(409);
    });

    it('recusa senha curta demais', async () => {
      await request(httpServer(app))
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'curta',
          name: 'Pessoa',
          organizationName: 'Org',
        })
        .expect(400);
    });

    it('normaliza o email para minusculas', async () => {
      const email = uniqueEmail();
      await register(email.toUpperCase()).expect(201);

      await request(httpServer(app))
        .post('/v1/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('não distingue email inexistente de senha errada', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const wrongPassword = await request(httpServer(app))
        .post('/v1/auth/login')
        .send({ email, password: 'senha errada mas longa' })
        .expect(401);

      const noSuchUser = await request(httpServer(app))
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'senha errada mas longa' })
        .expect(401);

      expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('rotaciona e inválida o token apresentado', async () => {
      const { body } = await register(uniqueEmail()).expect(201);

      const rotated = await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(200);

      expect(rotated.body.refreshToken).not.toBe(body.refreshToken);
      expect(rotated.body.accessToken).toEqual(expect.any(String));
    });

    /**
     * Este e o critério de pronto da fase 01.
     *
     * Um refresh token consumido que reaparece significa que alguém guardou uma
     * cópia. Não há como saber se quem apresenta é o dono ou o ladrão, então a
     * sessão inteira cai, inclusive o token válido emitido na rotação.
     */
    it('reusar um token consumido derruba a familia inteira', async () => {
      const { body } = await register(uniqueEmail()).expect(201);
      const primeiro = body.refreshToken;

      const rotacao = await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: primeiro })
        .expect(200);

      const segundo = rotacao.body.refreshToken;

      // O token já consumido reaparece: reuso.
      const reuso = await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: primeiro })
        .expect(401);

      expect(reuso.body.message).toMatch(/já tinha sido usado/);

      // E o token válido, que ninguém chegou a usar, também morre junto.
      const vitimaColateral = await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: segundo })
        .expect(401);

      expect(vitimaColateral.body.message).toMatch(/já tinha sido usado/);
    });

    it('recusa token desconhecido', async () => {
      await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'não-existe-este-token-aqui-nenhum' })
        .expect(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('encerra a sessão sem afetar outras', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const primeiraSessao = await request(httpServer(app))
        .post('/v1/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);

      const segundaSessao = await request(httpServer(app))
        .post('/v1/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);

      await request(httpServer(app))
        .post('/v1/auth/logout')
        .send({ refreshToken: primeiraSessao.body.refreshToken })
        .expect(204);

      await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: primeiraSessao.body.refreshToken })
        .expect(401);

      // A outra sessão continua viva: logout não e logout de tudo.
      await request(httpServer(app))
        .post('/v1/auth/refresh')
        .send({ refreshToken: segundaSessao.body.refreshToken })
        .expect(200);
    });
  });

  describe('GET /v1/auth/me', () => {
    it('exige credencial', async () => {
      await request(httpServer(app)).get('/v1/auth/me').expect(401);
    });

    it('recusa token adulterado', async () => {
      const { body } = await register(uniqueEmail()).expect(201);
      const adulterado = `${body.accessToken.slice(0, -4)}xxxx`;

      await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Bearer ${adulterado}`)
        .expect(401);
    });

    it('recusa esquema diferente de Bearer', async () => {
      const { body } = await register(uniqueEmail()).expect(201);

      await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Basic ${body.accessToken}`)
        .expect(401);
    });

    /**
     * Token válido de uma conta que não existe mais.
     *
     * Um JWT continua criptograficamente válido depois de a conta sumir: a
     * assinatura confere e o prazo não venceu. Sem conferir o sujeito no banco,
     * a credencial de uma conta apagada seguiria autenticando até vencer, e
     * cada rota quebraria de um jeito diferente ao não encontrar o usuário.
     *
     * A resposta é 401 e não 404 porque o problema não é o recurso pedido: é a
     * credencial, que deixou de valer. É a diferença entre "isso não existe" e
     * "entre de novo", e o painel depende dela para saber o que fazer.
     */
    it('recusa token de conta que não existe mais', async () => {
      const email = uniqueEmail();
      const { body } = await register(email).expect(201);

      await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      const usuario = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.membership.deleteMany({ where: { userId: usuario.id } });
      await prisma.user.delete({ where: { id: usuario.id } });

      const resposta = await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Bearer ${body.accessToken}`)
        .expect(401);

      expect(resposta.body.message).toMatch(/não existe mais/);
    });
  });
});
