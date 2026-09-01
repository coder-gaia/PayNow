/**
 * Calendário de recuperação de cobrança.
 *
 * Quando um pagamento é recusado, a pergunta não é "tentar de novo?", é
 * "quando". Tentar imediatamente falha pelo mesmo motivo que falhou agora, e o
 * adquirente conta cada tentativa contra o merchant. Esperar demais perde o
 * cliente para o esquecimento.
 *
 * O intervalo cresce porque as causas mudam de natureza com o tempo. Nas
 * primeiras horas, a causa mais provável é saldo momentâneo. Depois de um dia,
 * é o cliente ainda não ter reparado. Depois de três, é decisão.
 *
 * Quatro tentativas ao longo de sete dias, e então a fatura é dada como
 * incobrável. O número não é arbitrário: é o intervalo em que a maioria dos
 * ciclos mensais ainda cabe antes do próximo vencimento, o que evita duas
 * faturas em recuperação ao mesmo tempo para o mesmo cliente.
 */
export const RETRY_SCHEDULE_HOURS: readonly number[] = [1, 24, 72, 168];

/**
 * Quantas horas esperar depois da tentativa indicada.
 *
 * Devolve `null` quando o calendário acabou, que é o sinal de parar de
 * insistir. Quem chama traduz isso em fatura incobrável.
 *
 * `attempt` começa em 1, e o primeiro atraso é o da posição 0: depois da
 * primeira recusa espera-se uma hora.
 */
export function nextAttemptDelayHours(attempt: number): number | null {
  return RETRY_SCHEDULE_HOURS[attempt - 1] ?? null;
}

/** Quantas tentativas o calendário prevê ao todo. */
export const MAX_ATTEMPTS = RETRY_SCHEDULE_HOURS.length + 1;
