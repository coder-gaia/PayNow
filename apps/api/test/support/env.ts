/**
 * Ambiente das suítes ponta a ponta.
 *
 * Roda antes de qualquer módulo ser carregado, e existe para desligar o
 * trabalhador de fundo.
 *
 * O motivo é uma corrida real. Cada suíte sobe a própria instância da
 * aplicação, e com `WORKER_ENABLED=true` cada uma sobe também um cron que, a
 * cada minuto, varre o ciclo de cobrança e **entrega a fila do outbox
 * inteira**, que é global. Uma suíte acabava entregando as mensagens de outra,
 * pelo mailer errado, marcando-as como entregues antes de a dona das mensagens
 * olhar. O sintoma era uma falha intermitente em um teste que passava sozinho,
 * que é a pior forma de falha que existe.
 *
 * Nenhuma cobertura se perde: o que o cron faria é chamar `runDue` e `relay`, e
 * os testes chamam os dois diretamente, com o relógio sob controle. O que sai
 * daqui é só o agendamento, que é justamente a parte não determinística.
 */
process.env['WORKER_ENABLED'] = 'false';

/**
 * O limite de taxa sai do caminho nos testes.
 *
 * As suítes disparam centenas de requisições em segundos pelo mesmo IP, que é
 * exatamente o padrão que o limite existe para barrar. Sem isto, o teste que
 * falha é sempre o próximo da fila, e a mensagem não diz por quê.
 */
process.env['RATE_LIMIT_PER_MINUTE'] = '0';
