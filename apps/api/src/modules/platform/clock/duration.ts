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

/**
 * Soma meses de calendário, grudando no último dia quando o mês de destino é
 * mais curto.
 *
 * 31 de janeiro mais um mês é 28 ou 29 de fevereiro, e não 3 de março, que é o
 * que a aritmética ingênua de datas produz. Quem assina no dia 31 espera ser
 * cobrado no último dia do mês seguinte, mesmo sem saber explicar por quê.
 *
 * Todo o cálculo é em UTC, porque ciclo de cobrança não pode mudar de dia
 * conforme o fuso do servidor que rodou a conta.
 */
export function addCalendarMonths(instant: Date, months: number): Date {
  const ano = instant.getUTCFullYear();
  const mes = instant.getUTCMonth();
  const dia = instant.getUTCDate();

  // Dia 0 do mês seguinte é o último dia do mês de destino.
  const ultimoDiaDoDestino = new Date(Date.UTC(ano, mes + months + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      ano,
      mes + months,
      Math.min(dia, ultimoDiaDoDestino),
      instant.getUTCHours(),
      instant.getUTCMinutes(),
      instant.getUTCSeconds(),
      instant.getUTCMilliseconds(),
    ),
  );
}

/** Dias inteiros entre dois instantes, arredondando para baixo. */
export function differenceInDays(later: Date, earlier: Date): number {
  return Math.floor(differenceInMilliseconds(later, earlier) / MILLISECONDS_PER_DAY);
}
