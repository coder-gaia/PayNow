import { Injectable } from '@nestjs/common';

/**
 * Token de injecao do relogio. Nenhum modulo de dominio le o relogio do
 * sistema: uma regra de lint quebra o build se tentar (ver ADR-0009 e o bloco
 * de `no-restricted-syntax` no eslint.config.mjs).
 */
export const CLOCK = Symbol('Clock');

/**
 * Fonte unica de tempo do sistema.
 *
 * A assinatura nao recebe organizacao de proposito. Na fase 04 o relogio
 * virtual e resolvido por organizacao no escopo do request, e passa a ser a
 * instancia que muda, nao a assinatura. Isso evita ter que tocar em todo
 * ponto de chamada quando o test clock entrar.
 */
export interface Clock {
  /** Instante atual, na visao de quem esta sendo servido. */
  now(): Date;
}

/**
 * Relogio de parede. Implementacao usada em producao e o padrao ate a fase 04,
 * quando entra o relogio virtual por organizacao.
 */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * Relogio fixo, para testes que precisam de um instante conhecido.
 *
 * Vive no codigo de producao, e nao em util de teste, porque a fase 04 vai
 * construir o test clock em cima dele e expo-lo pela API da demonstracao.
 */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  /** Avanca o relogio em milissegundos e devolve o novo instante. */
  advanceBy(milliseconds: number): Date {
    this.current = new Date(this.current.getTime() + milliseconds);
    return this.now();
  }

  /** Move o relogio para um instante especifico. */
  set(instant: Date): void {
    this.current = new Date(instant);
  }
}
