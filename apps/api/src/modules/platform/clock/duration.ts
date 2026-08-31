/**
 * Aritmetica de instantes.
 *
 * Vive em `platform` porque a ADR-0009 proíbe `new Date()` nos módulos de
 * domínio, e calcular "daqui a quinze minutos" a partir de um instante do
 * relógio injetado e uma necessidade legitima que não pode virar motivo para
 * afrouxar a regra.
 *
 * Todas as funções são puras e devolvem uma instância nova: nenhuma muta o
 * argumento recebido.
 */

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

export function addMilliseconds(instant: Date, amount: number): Date {
  return new Date(instant.getTime() + amount);
}

export function addSeconds(instant: Date, amount: number): Date {
  return addMilliseconds(instant, amount * MILLISECONDS_PER_SECOND);
}

export function addMinutes(instant: Date, amount: number): Date {
  return addMilliseconds(instant, amount * MILLISECONDS_PER_MINUTE);
}

export function addHours(instant: Date, amount: number): Date {
  return addMilliseconds(instant, amount * MILLISECONDS_PER_HOUR);
}

/**
 * Soma dias corridos de 24 horas, e não dias de calendario.
 *
 * A distincao importa: em fuso com horario de verao, "amanha no mesmo horario"
 * e "daqui a 24 horas" podem ser instantes diferentes. Expiração de token quer
 * duracao, então dia corrido e o correto aqui. Ciclo de cobrança vai querer dia
 * de calendario, e ganha função própria na fase 04.
 */
export function addDays(instant: Date, amount: number): Date {
  return addMilliseconds(instant, amount * MILLISECONDS_PER_DAY);
}

export function isBefore(instant: Date, other: Date): boolean {
  return instant.getTime() < other.getTime();
}

export function isAfterOrEqual(instant: Date, other: Date): boolean {
  return instant.getTime() >= other.getTime();
}

/** Diferença em milissegundos, positiva quando `later` vem depois de `earlier`. */
export function differenceInMilliseconds(later: Date, earlier: Date): number {
  return later.getTime() - earlier.getTime();
}
