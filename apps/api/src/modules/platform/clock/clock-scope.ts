import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Escopo de tempo do request.
 *
 * O relógio precisa responder diferente para cada organização, porque uma pode
 * estar com o tempo congelado enquanto as outras seguem no relógio de parede.
 * A alternativa óbvia seria passar `organizationId` para `now()`, e a ADR-0009
 * recusou isso de propósito: espalharia o identificador por toda assinatura de
 * método que precisa saber que horas são.
 *
 * A saída é `AsyncLocalStorage`. O escopo é aberto uma vez, na borda, e todo
 * código chamado dentro dele enxerga o mesmo instante sem receber parâmetro
 * nenhum. Ver ADR-0015 para as alternativas rejeitadas, entre elas o provedor
 * com escopo de request do Nest.
 *
 * O instante é resolvido uma vez e congelado para o request inteiro, mesmo em
 * relógio de parede. Isso não é um efeito colateral: é uma propriedade que se
 * quer. Um lançamento contábil cujas linhas nascem com milissegundos
 * diferentes é um lançamento que conta duas histórias sobre quando aconteceu.
 */
export interface ClockScope {
  readonly organizationId: string;
  /** Instante que vale para tudo que rodar dentro deste escopo. */
  readonly now: Date;
  /** Verdadeiro quando o instante veio de um relógio congelado. */
  readonly virtual: boolean;
}

@Injectable()
export class ClockScopeStorage {
  private readonly storage = new AsyncLocalStorage<ClockScope>();

  current(): ClockScope | undefined {
    return this.storage.getStore();
  }

  /**
   * Roda uma função dentro de um escopo de tempo.
   *
   * Tudo que a função chamar, em qualquer profundidade, passa a enxergar o
   * mesmo instante. Vale para o request HTTP e também para o worker e para os
   * testes, que precisam agir em nome de uma organização sem ter request.
   */
  run<T>(scope: ClockScope, fn: () => T): T {
    return this.storage.run(scope, fn);
  }
}
