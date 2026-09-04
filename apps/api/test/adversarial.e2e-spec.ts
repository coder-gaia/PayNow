import type { INestApplication } from '@nestjs/common';

import { FakeGateway } from '../src/modules/platform/payments/fake-gateway';
import {
  Cenario,
  descreverRoteiro,
  sortearRoteiro,
  type Passo,
  type Projecao,
} from './support/adversarial';
import { createTestApp } from './support/app';
import { criarRng, sementeDaExecucao, type Rng } from './support/rng';

/**
 * Suíte adversarial.
 *
 * O terceiro pilar do projeto, e o que separa "os testes passam" de "o sistema
 * aguenta". As outras suítes verificam casos que alguém pensou. Esta gera casos
 * que ninguém pensou, e afirma duas coisas sobre todos eles.
 *
 * **Convergência.** O mesmo roteiro, com o provedor contando os mesmos desfechos
 * nos mesmos pontos mas em ordens diferentes e com repetições diferentes,
 * termina no mesmo lugar. É a propriedade que a deduplicação e a idempotência
 * existem para dar, e a única forma honesta de verificá-la é comparar duas
 * execuções entre si. Comparar contra um resultado escrito à mão verifica o que
 * o autor do teste imaginou.
 *
 * **O razão nunca desbalanceia.** Não no fim: em todo passo intermediário. Um
 * razão que fecha só quando ninguém está olhando não fecha.
 *
 * Toda execução tem semente, e a semente aparece no log. Uma falha do CI se
 * reproduz com `SEED=<numero>`, e a mensagem traz o roteiro inteiro. Sem isso,
 * uma suíte que sorteia produz anedota em vez de defeito.
 */
describe('Suíte adversarial (e2e)', () => {
  let app: INestApplication;
  let gateway: FakeGateway;

  /**
   * Quanto explorar.
   *
   * Ajustável por ambiente porque o custo é real: a convergência roda cada
   * cenário duas vezes contra um Postgres de verdade. O padrão é o que cabe num
   * CI sem virar a suíte que as pessoas desligam. Uma varredura maior é uma
   * variável de ambiente, e está documentada no README.
   */
  const CENARIOS = inteiro('ADVERSARIAL_SCENARIOS', 40);
  const PASSOS = inteiro('ADVERSARIAL_STEPS', 8);

  const sementeBase = sementeDaExecucao();

  /**
   * O tempo é generoso de propósito.
   *
   * Um limite apertado transformaria "a suíte está lenta" em "a suíte falhou",
   * que são coisas diferentes e merecem sinais diferentes.
   */
  const LIMITE_MS = 20 * 60 * 1000;

  beforeAll(async () => {
    app = await createTestApp();
    gateway = app.get(FakeGateway);

    // eslint-disable-next-line no-console
    console.log(
      `Suíte adversarial: semente ${sementeBase}, ${CENARIOS} cenários de ${PASSOS} passos. ` +
        `Para repetir esta execução exatamente: SEED=${sementeBase}`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.reset();
  });

  it(
    'o estado final não depende da ordem nem da repetição com que o provedor conta os desfechos',
    async () => {
      let comPressao = 0;
      let entregas = 0;
      let repeticoes = 0;

      for (let i = 0; i < CENARIOS; i += 1) {
        const semente = (sementeBase + i) >>> 0;
        const roteiro = sortearRoteiro(criarRng(semente), PASSOS);

        // As duas execuções correm o mesmo roteiro de negócio e recebem os
        // mesmos desfechos nos mesmos pontos. O que muda é a ordem dentro de
        // cada lote e quantas vezes cada um chega, que é a variável sob teste.
        const primeira = await rodar(roteiro, criarRng((semente ^ 0x9e3779b9) >>> 0));
        const segunda = await rodar(roteiro, criarRng((semente ^ 0x85ebca6b) >>> 0));

        if (!iguais(primeira.projecao, segunda.projecao)) {
          throw new Error(
            `Convergência quebrada na semente ${semente}.\n` +
              `Roteiro: ${descreverRoteiro(roteiro)}\n` +
              `Ordem A: ${JSON.stringify(primeira.projecao)}\n` +
              `Ordem B: ${JSON.stringify(segunda.projecao)}\n` +
              `Repita a execução inteira com: SEED=${sementeBase}`,
          );
        }

        entregas += primeira.entregues + segunda.entregues;
        repeticoes += primeira.repetidas + segunda.repetidas;

        if (primeira.entregues > 0) {
          comPressao += 1;
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `Convergência: ${CENARIOS} cenários, ${comPressao} com desfecho tardio, ` +
          `${entregas} entregas, ${repeticoes} delas repetidas.`,
      );

      // As duas asserções abaixo são sobre a **suíte**, e não sobre o sistema.
      //
      // Uma suíte adversarial que não produz adversidade passa sem provar nada,
      // e foi assim que a primeira versão desta aqui nasceu: 32 de 40 execuções
      // não geravam notificação nenhuma, e ela passava com três defesas
      // desligadas. Sem estas linhas, a degradação da suíte é silenciosa, que é
      // a pior forma de um teste morrer.
      expect(comPressao).toBeGreaterThan(CENARIOS * 0.2);
      expect(repeticoes).toBeGreaterThan(0);
    },
    LIMITE_MS,
  );

  it(
    'o razão fecha em todo passo intermediário, e não só no fim',
    async () => {
      // Metade do custo da convergência, porque roda cada cenário uma vez só.
      // Com o mesmo orçamento dá para andar mais fundo em cada roteiro, e é o
      // que interessa aqui: o invariante precisa valer em cada ponto, então
      // roteiro mais longo verifica mais pontos.
      const passos = PASSOS * 2;
      let pontos = 0;

      for (let i = 0; i < CENARIOS; i += 1) {
        const semente = (sementeBase ^ 0xc2b2ae35 ^ i) >>> 0;
        const roteiro = sortearRoteiro(criarRng(semente), passos);

        // `executar` verifica o razão depois de cada passo e lança nomeando o
        // passo que quebrou. Aqui só sobra contar quantos pontos foram olhados.
        const resultado = await rodar(roteiro, criarRng((semente ^ 0x27d4eb2f) >>> 0));

        pontos += resultado.verificacoesIntermediarias;
        expect(resultado.projecao.razaoFecha).toBe(true);
      }

      // eslint-disable-next-line no-console
      console.log(`Invariante do razão: ${pontos} pontos verificados em ${CENARIOS} cenários.`);

      expect(pontos).toBeGreaterThan(CENARIOS * passos);
    },
    LIMITE_MS,
  );

  const rodar = async (roteiro: readonly Passo[], rngEntrega: Rng) => {
    // O gateway falso é do processo, e não do cenário. Zerar entre execuções
    // impede que um desfecho não colhido de um cenário apareça no seguinte.
    gateway.reset();

    const cenario = new Cenario(app);
    const resultado = await cenario.executar(roteiro, rngEntrega);

    return {
      projecao: resultado.projecao,
      verificacoesIntermediarias: resultado.verificacoesIntermediarias,
      entregues: cenario.entregues,
      repetidas: cenario.repetidas,
    };
  };

  const iguais = (a: Projecao, b: Projecao): boolean =>
    JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));

  /** Chaves em ordem, para a comparação ser sobre o conteúdo e não sobre a montagem. */
  const ordenar = (projecao: Projecao) => ({
    assinatura: projecao.assinatura,
    faturasPorStatus: Object.fromEntries(
      Object.entries(projecao.faturasPorStatus).sort(([x], [y]) => x.localeCompare(y)),
    ),
    totalPagoMinor: projecao.totalPagoMinor,
    totalEstornadoMinor: projecao.totalEstornadoMinor,
    saldos: Object.fromEntries(
      Object.entries(projecao.saldos).sort(([x], [y]) => x.localeCompare(y)),
    ),
    razaoFecha: projecao.razaoFecha,
  });
});

function inteiro(variavel: string, padrao: number): number {
  const bruto = process.env[variavel];

  if (bruto === undefined || bruto === '') {
    return padrao;
  }

  const lido = Number.parseInt(bruto, 10);

  if (!Number.isFinite(lido) || lido < 1) {
    throw new Error(`${variavel} precisa ser um inteiro positivo, e veio "${bruto}".`);
  }

  return lido;
}
