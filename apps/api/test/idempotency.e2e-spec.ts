import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createTestApp, DEFAULT_PASSWORD, httpServer, uniqueEmail } from './support/app';

/**
 * Idempotência de requisição.
 *
 * O problema não tem solução do lado do cliente. Um POST sai, a resposta se
 * perde na rede, e quem chamou fica sem saber se o efeito aconteceu. Repetir
 * pode duplicar; não repetir pode deixar de fazer. A única saída é o servidor
 * reconhecer a repetição.
 *
 * Os testes usam criação de cliente em vez de cobrança porque o efeito é mais
 * fácil de contar, e porque o que está sendo verificado é o interceptor, que
 * não sabe qual rota está protegendo.
 */
describe('Idempotência (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let organizationId: string;

  beforeAll(async () => {
    app = await createTestApp();

    const { body } = await request(httpServer(app))
      .post('/v1/auth/register')
      .send({
        email: uniqueEmail('idem'),
        password: DEFAULT_PASSWORD,
        name: 'Pessoa da Idempotência',
        organizationName: 'Organização Idempotente',
      })
      .expect(201);

    token = body.accessToken;

    const perfil = await request(httpServer(app))
      .get('/v1/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    organizationId = perfil.body.organizations[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const criarCliente = (chave: string | null, email: string) => {
    const chamada = request(httpServer(app))
      .post(`/v1/organizations/${organizationId}/customers`)
      .set('authorization', `Bearer ${token}`);

    if (chave !== null) {
      chamada.set('idempotency-key', chave);
    }

    return chamada.send({ email, name: 'Cliente Idempotente' });
  };

  const quantosClientes = async (): Promise<number> => {
    const { body } = await request(httpServer(app))
      .get(`/v1/organizations/${organizationId}/customers`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    return body.length;
  };

  it('a mesma chave com o mesmo corpo não executa duas vezes', async () => {
    const chave = randomUUID();
    const email = uniqueEmail('repetido');

    const antes = await quantosClientes();

    const primeira = await criarCliente(chave, email).expect(201);
    const segunda = await criarCliente(chave, email).expect(201);

    // A repetição devolve a resposta guardada, byte por byte.
    expect(segunda.body).toEqual(primeira.body);
    expect(segunda.headers['idempotent-replay']).toBe('true');
    expect(primeira.headers['idempotent-replay']).toBeUndefined();

    // E o efeito aconteceu uma vez só. Sem o interceptor, a segunda chamada
    // teria batido no índice único de email e respondido 409, que é uma
    // resposta correta para um problema errado: quem repetiu por causa de
    // rede não fez nada de errado.
    expect(await quantosClientes()).toBe(antes + 1);
  });

  it('a mesma chave com corpo diferente é recusada', async () => {
    const chave = randomUUID();

    await criarCliente(chave, uniqueEmail('primeiro')).expect(201);

    const { body } = await criarCliente(chave, uniqueEmail('segundo')).expect(422);

    // O defeito que isto pega é silencioso e caro: sem a digital da
    // requisição, a segunda chamada receberia a resposta da primeira e quem
    // chamou concluiria que criou o segundo cliente.
    expect(body.message).toMatch(/outro corpo de requisição/);
  });

  it('sem o cabeçalho, nada muda', async () => {
    const email = uniqueEmail('semchave');

    await criarCliente(null, email).expect(201);

    // A segunda esbarra na regra de negócio, e não na idempotência: o email
    // já existe naquela organização. É o comportamento de sempre, porque quem
    // não pediu idempotência não a recebe. É o mesmo desenho do Stripe.
    await criarCliente(null, email).expect(400);
  });

  it('chaves diferentes são pedidos diferentes', async () => {
    const antes = await quantosClientes();

    await criarCliente(randomUUID(), uniqueEmail('a')).expect(201);
    await criarCliente(randomUUID(), uniqueEmail('b')).expect(201);

    expect(await quantosClientes()).toBe(antes + 2);
  });

  /**
   * A corrida, resolvida pelo banco.
   *
   * Duas chamadas com a mesma chave saindo ao mesmo tempo. Uma ganha o índice
   * único e executa; a outra descobre que há uma em andamento. Responder a
   * resposta da primeira seria inventar, porque ela ainda não existe, e
   * executar de novo seria o dobro do efeito.
   */
  it('duas chamadas simultâneas com a mesma chave: uma executa, a outra espera', async () => {
    const chave = randomUUID();
    const email = uniqueEmail('corrida');
    const antes = await quantosClientes();

    const [primeira, segunda] = await Promise.allSettled([
      criarCliente(chave, email),
      criarCliente(chave, email),
    ]);

    const status = [primeira, segunda]
      .map((resultado) => (resultado.status === 'fulfilled' ? resultado.value.status : Number.NaN))
      .sort((a, b) => a - b);

    // Uma criou; a outra recebeu 201 de repetição ou 409 de "em andamento",
    // conforme quem chegou primeiro terminou ou não. Os dois desfechos são
    // corretos, e o que não pode acontecer é o efeito duplicar.
    expect(status[0]).toBe(201);
    expect([201, 409]).toContain(status[1]);

    expect(await quantosClientes()).toBe(antes + 1);
  });

  it('a chave de uma pessoa não alcança a resposta de outra', async () => {
    const chave = 'chave-compartilhada-de-proposito';
    const email = uniqueEmail('primeira-pessoa');

    await criarCliente(chave, email).expect(201);

    // Outra conta, outra organização, mesma chave.
    const outra = await request(httpServer(app))
      .post('/v1/auth/register')
      .send({
        email: uniqueEmail('outra'),
        password: DEFAULT_PASSWORD,
        name: 'Outra Pessoa',
        organizationName: 'Outra Organização',
      })
      .expect(201);

    const perfil = await request(httpServer(app))
      .get('/v1/auth/me')
      .set('authorization', `Bearer ${outra.body.accessToken}`)
      .expect(200);

    const resposta = await request(httpServer(app))
      .post(`/v1/organizations/${perfil.body.organizations[0].id}/customers`)
      .set('authorization', `Bearer ${outra.body.accessToken}`)
      .set('idempotency-key', chave)
      .send({ email: uniqueEmail('cliente-alheio'), name: 'Cliente de Outra Pessoa' })
      .expect(201);

    // Executou de verdade, e não devolveu a resposta guardada da outra conta.
    // O escopo da chave é o que impede um cliente de ler resposta alheia
    // adivinhando chave.
    expect(resposta.headers['idempotent-replay']).toBeUndefined();
    expect(resposta.body.name).toBe('Cliente de Outra Pessoa');
  });

  it('GET não é interceptado, porque já é idempotente por definição', async () => {
    const chave = randomUUID();

    await request(httpServer(app))
      .get(`/v1/organizations/${organizationId}/customers`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', chave)
      .expect(200);

    await request(httpServer(app))
      .get(`/v1/organizations/${organizationId}/customers`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', chave)
      .expect(200)
      .expect((resposta) => {
        expect(resposta.headers['idempotent-replay']).toBeUndefined();
      });
  });
});
