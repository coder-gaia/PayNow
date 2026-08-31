/**
 * Aritmetica de instantes.
 *
 * Vive em `platform` porque a ADR-0009 proibe `new Date()` nos modulos de
 * dominio, e calcular "daqui a quinze minutos" a partir de um instante do
 * relogio injetado e uma necessidade legitima que nao pode virar motivo para
 * afrouxar a regra.
 *
 * Todas as funcoes sao puras e devolvem uma instancia nova: nenhuma muta o
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
 * Soma dias corridos de 24 horas, e nao dias de calendario.
 *
 * A distincao importa: em fuso com horario de verao, "amanha no mesmo horario"
 * e "daqui a 24 horas" podem ser instantes diferentes. Expiracao de token quer
 * duracao, entao dia corrido e o correto aqui. Ciclo de cobranca vai querer dia
 * de calendario, e ganha funcao propria na fase 04.
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

/** Diferenca em milissegundos, positiva quando `later` vem depois de `earlier`. */
export function differenceInMilliseconds(later: Date, earlier: Date): number {
  return later.getTime() - earlier.getTime();
}
