import { Injectable } from '@nestjs/common';

import { ClockScopeStorage } from './clock-scope';

/**
 * Token de injeção do relógio. Nenhum módulo de domínio le o relógio do
 * sistema: uma regra de lint quebra o build se tentar (ver ADR-0009 e o bloco
 * de `no-restricted-syntax` no eslint.config.mjs).
 */
export const CLOCK = Symbol('Clock');

/**
 * Fonte única de tempo do sistema.
 *
 * A assinatura não recebe organização de propósito. O relógio virtual é
 * resolvido por organização no escopo do request, e o que muda é o instante
 * que o escopo carrega, não a assinatura do método. Ver ADR-0015.
 */
export interface Clock {
  /** Instante atual, na visão de quem está sendo servido. */
  now(): Date;
}

/**
 * Relógio de parede puro, sem noção de organização.
 *
 * Continua existindo porque é o que os testes de unidade e a inicialização
 * usam, e porque é o comportamento correto fora de qualquer request.
 */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Relógio da aplicação.
 *
 * Dentro de um escopo, devolve o instante que o escopo carrega, congelado ou
 * não. Fora de qualquer escopo cai no relógio de parede, que é o certo para o
 * probe de prontidão, para a inicialização e para o seed: nenhum deles age em
 * nome de uma organização.
 *
 * A queda para o relógio de parede é deliberada e não silenciosa por acidente.
 * A alternativa seria lançar, e isso transformaria qualquer caminho novo sem
 * escopo em erro em produção. O risco oposto, o de uma leitura de tempo
 * escapar do escopo sem ninguém notar, é coberto pelo teste que congela o
 * relógio e confere que o ciclo de cobrança inteiro respondeu à data falsa.
 */
@Injectable()
export class ScopedClock implements Clock {
  constructor(private readonly scopes: ClockScopeStorage) {}

  now(): Date {
    const scope = this.scopes.current();
    return scope === undefined ? new Date() : new Date(scope.now);
  }
}

/**
 * Relógio fixo, para testes que precisam de um instante conhecido.
 *
 * Vive no código de produção, e não em utilitário de teste, porque a fase 04 vai
 * construir o test clock em cima dele e expô-lo pela API da demonstração.
 */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  /** Avança o relógio em milissegundos e devolve o novo instante. */
  advanceBy(milliseconds: number): Date {
    this.current = new Date(this.current.getTime() + milliseconds);
    return this.now();
  }

  /** Move o relógio para um instante específico. */
  set(instant: Date): void {
    this.current = new Date(instant);
  }
}
