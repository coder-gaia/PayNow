import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createTestApp, DEFAULT_PASSWORD, httpServer, uniqueEmail } from './support/app';

interface Account {
  readonly email: string;
  readonly userId: string;
  readonly token: string;
  readonly organizationId: string;
}

describe('Organizações, papéis e chaves (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Cria uma conta com organização própria e devolve o necessário para agir por ela. */
  async function createAccount(prefix: string): Promise<Account> {
    const email = uniqueEmail(prefix);

    const { body } = await request(httpServer(app))
      .post('/v1/auth/register')
      .send({
        email,
        password: DEFAULT_PASSWORD,
        name: `Pessoa ${prefix}`,
        organizationName: `Organização ${prefix}`,
      })
      .expect(201);

    const profile = await request(httpServer(app))
      .get('/v1/auth/me')
      .set('authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    return {
      email,
      userId: profile.body.id,
      token: body.accessToken,
      organizationId: profile.body.organizations[0].id,
    };
  }

  const as = (account: Account) => ({ authorization: `Bearer ${account.token}` });

  const addMember = (owner: Account, member: Account, role: string) =>
    request(httpServer(app))
      .post(`/v1/organizations/${owner.organizationId}/members`)
      .set(as(owner))
      .send({ email: member.email, role });

  describe('associação', () => {
    it('lista apenas as organizações de que a pessoa participa', async () => {
      const ana = await createAccount('ana');
      await createAccount('bruno');

      const { body } = await request(httpServer(app))
        .get('/v1/organizations')
        .set(as(ana))
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(ana.organizationId);
    });

    it('nega acesso a organização de outra pessoa', async () => {
      const ana = await createAccount('ana');
      const bruno = await createAccount('bruno');

      await request(httpServer(app))
        .get(`/v1/organizations/${ana.organizationId}`)
        .set(as(bruno))
        .expect(403);
    });

    it('recusa adicionar quem ainda não tem conta', async () => {
      const ana = await createAccount('ana');

      await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/members`)
        .set(as(ana))
        .send({ email: uniqueEmail('fantasma'), role: 'MEMBER' })
        .expect(404);
    });

    it('recusa adicionar duas vezes a mesma pessoa', async () => {
      const ana = await createAccount('ana');
      const bruno = await createAccount('bruno');

      await addMember(ana, bruno, 'MEMBER').expect(201);
      await addMember(ana, bruno, 'MEMBER').expect(409);
    });
  });

  describe('hierarquia de papéis', () => {
    it('MEMBER não administra membros', async () => {
      const ana = await createAccount('ana');
      const carla = await createAccount('carla');
      const davi = await createAccount('davi');

      await addMember(ana, carla, 'MEMBER').expect(201);

      await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/members`)
        .set(as(carla))
        .send({ email: davi.email, role: 'MEMBER' })
        .expect(403);
    });

    it('READONLY enxerga a organização mas não mexe nela', async () => {
      const ana = await createAccount('ana');
      const davi = await createAccount('davi');

      await addMember(ana, davi, 'READONLY').expect(201);

      await request(httpServer(app))
        .get(`/v1/organizations/${ana.organizationId}/members`)
        .set(as(davi))
        .expect(200);

      await request(httpServer(app))
        .delete(`/v1/organizations/${ana.organizationId}/members/${ana.userId}`)
        .set(as(davi))
        .expect(403);
    });

    it('ADMIN não promove alguém a um papel igual ao próprio', async () => {
      const ana = await createAccount('ana');
      const bruno = await createAccount('bruno');
      const carla = await createAccount('carla');

      await addMember(ana, bruno, 'ADMIN').expect(201);
      await addMember(ana, carla, 'MEMBER').expect(201);

      await request(httpServer(app))
        .patch(`/v1/organizations/${ana.organizationId}/members/${carla.userId}`)
        .set(as(bruno))
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('ADMIN não mexe em quem é OWNER', async () => {
      const ana = await createAccount('ana');
      const bruno = await createAccount('bruno');

      await addMember(ana, bruno, 'ADMIN').expect(201);

      await request(httpServer(app))
        .patch(`/v1/organizations/${ana.organizationId}/members/${ana.userId}`)
        .set(as(bruno))
        .send({ role: 'MEMBER' })
        .expect(403);
    });

    it('OWNER promove e rebaixa livremente', async () => {
      const ana = await createAccount('ana');
      const carla = await createAccount('carla');

      await addMember(ana, carla, 'READONLY').expect(201);

      const promovida = await request(httpServer(app))
        .patch(`/v1/organizations/${ana.organizationId}/members/${carla.userId}`)
        .set(as(ana))
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(promovida.body.role).toBe('ADMIN');
    });
  });

  describe('proteção do último OWNER', () => {
    it('recusa rebaixar o único OWNER', async () => {
      const ana = await createAccount('ana');

      const response = await request(httpServer(app))
        .patch(`/v1/organizations/${ana.organizationId}/members/${ana.userId}`)
        .set(as(ana))
        .send({ role: 'ADMIN' })
        .expect(400);

      expect(response.body.message).toMatch(/ao menos um OWNER/);
    });

    it('recusa que o único OWNER saia da organização', async () => {
      const ana = await createAccount('ana');

      await request(httpServer(app))
        .delete(`/v1/organizations/${ana.organizationId}/members/${ana.userId}`)
        .set(as(ana))
        .expect(400);
    });

    it('permite rebaixar quando existe outro OWNER', async () => {
      const ana = await createAccount('ana');
      const bruno = await createAccount('bruno');

      await addMember(ana, bruno, 'OWNER').expect(201);

      await request(httpServer(app))
        .patch(`/v1/organizations/${ana.organizationId}/members/${ana.userId}`)
        .set(as(ana))
        .send({ role: 'ADMIN' })
        .expect(200);
    });
  });

  describe('chaves de API', () => {
    it('devolve o segredo uma única vez e só o prefixo depois', async () => {
      const ana = await createAccount('ana');

      const criada = await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(ana))
        .send({ name: 'Servidor de teste', environment: 'TEST' })
        .expect(201);

      expect(criada.body.secret).toMatch(/^sk_test_/);
      expect(criada.body.prefix).toBe(criada.body.secret.slice(0, 'sk_test_'.length + 8));

      const listadas = await request(httpServer(app))
        .get(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(ana))
        .expect(200);

      expect(listadas.body[0].secret).toBeUndefined();
      expect(listadas.body[0].prefix).toBe(criada.body.prefix);
    });

    /** Critério de pronto da fase 01: chave de API chega a uma rota protegida. */
    it('autentica uma rota de merchant', async () => {
      const ana = await createAccount('ana');

      const { body } = await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(ana))
        .send({ name: 'Servidor', environment: 'TEST' })
        .expect(201);

      const contexto = await request(httpServer(app))
        .get('/v1/merchant/me')
        .set('authorization', `Bearer ${body.secret}`)
        .expect(200);

      expect(contexto.body.organization.id).toBe(ana.organizationId);
      expect(contexto.body.environment).toBe('TEST');
    });

    it('chave revogada perde o acesso', async () => {
      const ana = await createAccount('ana');

      const { body } = await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(ana))
        .send({ name: 'Descartável', environment: 'TEST' })
        .expect(201);

      await request(httpServer(app))
        .get('/v1/merchant/me')
        .set('authorization', `Bearer ${body.secret}`)
        .expect(200);

      await request(httpServer(app))
        .delete(`/v1/organizations/${ana.organizationId}/api-keys/${body.id}`)
        .set(as(ana))
        .expect(204);

      await request(httpServer(app))
        .get('/v1/merchant/me')
        .set('authorization', `Bearer ${body.secret}`)
        .expect(401);
    });

    it('chave de API não abre rota de painel', async () => {
      const ana = await createAccount('ana');

      const { body } = await request(httpServer(app))
        .post(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(ana))
        .send({ name: 'Servidor', environment: 'TEST' })
        .expect(201);

      await request(httpServer(app))
        .get('/v1/auth/me')
        .set('authorization', `Bearer ${body.secret}`)
        .expect(401);
    });

    it('MEMBER não administra chaves', async () => {
      const ana = await createAccount('ana');
      const carla = await createAccount('carla');

      await addMember(ana, carla, 'MEMBER').expect(201);

      await request(httpServer(app))
        .get(`/v1/organizations/${ana.organizationId}/api-keys`)
        .set(as(carla))
        .expect(403);
    });
  });
});
