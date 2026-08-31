import { Injectable } from '@nestjs/common';

/**
 * Token de injeção do relógio. Nenhum módulo de domínio le o relógio do
 * sistema: uma regra de lint quebra o build se tentar (ver ADR-0009 e o bloco
 * de `no-restricted-syntax` no eslint.config.mjs).
 */
export const CLOCK = Symbol('Clock');

/**
 * Fonte única de tempo do sistema.
 *
 * A assinatura não recebe organização de proposito. Na fase 04 o relógio
 * virtual é resolvido por organização no escopo do request, e passa a ser a
 * instância que muda, não a assinatura. Isso evita ter que tocar em todo
 * ponto de chamada quando o test clock entrar.
 */
export interface Clock {
  /** Instante atual, na visao de quem está sendo servido. */
  now(): Date;
}

/**
 * Relógio de parede. Implementação usada em producao e o padrão até a fase 04,
 * quando entra o relógio virtual por organização.
 */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Relógio fixo, para testes que precisam de um instante conhecido.
 *
 * Vive no código de producao, e não em útil de teste, porque a fase 04 vai
 * construir o test clock em cima dele e expo-lo pela API da demonstracao.
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
