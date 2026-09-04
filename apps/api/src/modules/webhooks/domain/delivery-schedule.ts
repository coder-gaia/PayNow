/**
 * Calendário de reentrega de webhook.
 *
 * Diferente do calendário de recuperação de cobrança, e por um motivo: ali as
 * causas são humanas, e o intervalo cresce em horas porque o cliente precisa de
 * tempo para reparar no problema. Aqui a causa é um servidor, e servidor volta
 * em segundos ou fica fora por horas, sem meio termo útil.
 *
 * Por isso o começo é agressivo, para cobrir um deploy passando, e o fim é
 * longo, para cobrir alguém precisando acordar. Oito tentativas ao longo de
 * pouco mais de um dia.
 *
 * O que **não** está aqui é jitter. Com muitos endereços caindo ao mesmo tempo,
 * um calendário fixo faz todos voltarem no mesmo instante e derruba de novo o
 * serviço que estava se recuperando. Isso entra quando houver volume que
 * justifique, e está anotado no gatilho de revisão da ADR-0016.
 */
export const DELIVERY_BACKOFF_SECONDS: readonly number[] = [
  10, // deploy passando
  30,
  120,
  600, // dez minutos: alguém já foi avisado
  1_800,
  7_200, // duas horas
  21_600,
  86_400, // um dia: última chance
];

/** Quantas tentativas o calendário prevê ao todo, contando a primeira. */
export const MAX_DELIVERY_ATTEMPTS = DELIVERY_BACKOFF_SECONDS.length + 1;

/**
 * Quantos segundos esperar depois da tentativa indicada.
 *
 * Devolve `null` quando o calendário acabou, que é o sinal de desistir. A
 * entrega não some: fica como FAILED, para inspeção e reenvio manual.
 *
 * `attempt` começa em 1.
 */
export function nextDelaySeconds(attempt: number): number | null {
  return DELIVERY_BACKOFF_SECONDS[attempt - 1] ?? null;
}

/**
 * Um código de resposta merece nova tentativa?
 *
 * `2xx` é sucesso. `410 Gone` é o endereço dizendo que não existe mais, e
 * insistir contra isso é desperdício dos dois lados. Todo o resto merece:
 * inclusive `4xx`, que costuma indicar bug de quem recebe e costuma ser
 * corrigido com um deploy.
 *
 * A escolha é deliberadamente generosa. Desistir cedo perde evento de verdade;
 * insistir demais só custa requisição.
 */
export function shouldRetry(statusCode: number): boolean {
  if (statusCode >= 200 && statusCode < 300) {
    return false;
  }

  return statusCode !== 410;
}
