'use client';

import { useState, useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { Button, Panel } from '@/components/ui';
import { advanceClock, freezeClock, resetClock, runBillingCycle } from '@/lib/actions';
import type { ClockState, CycleEffect, CycleReport } from '@/lib/api';

/**
 * Controles do relógio.
 *
 * O resultado do avanço fica na tela, e não só no toast. Um toast some em
 * quatro segundos e o que aconteceu aqui é o ponto da demonstração: quem
 * adiantou dois meses quer conferir com calma que saíram duas renovações, duas
 * faturas e dois lançamentos no razão.
 */
const ACOES: Record<CycleEffect['action'], string> = {
  renovada: 'ciclo renovado',
  ativada: 'teste encerrado, assinatura ativada',
  encerrada: 'cancelamento agendado cumprido',
  expirada: 'expirada sem o primeiro pagamento',
};

export function ClockControls({
  organizationId,
  clock,
  daysToNextRenewal,
}: {
  organizationId: string;
  clock: ClockState;
  daysToNextRenewal: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [ultimo, setUltimo] = useState<CycleReport | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const relatar = (cycle: CycleReport | undefined): void => {
    if (cycle === undefined) {
      return;
    }

    setUltimo(cycle);

    if (cycle.effects.length === 0) {
      toast.success('Tempo adiantado. Nada tinha vencido ainda.');
      return;
    }

    toast.success(
      `Tempo adiantado. ${cycle.effects.length} assinatura(s) liquidada(s): ` +
        `${resumir(cycle.effects)}.`,
    );
  };

  const handleFreeze = () => {
    startTransition(async () => {
      const result = await freezeClock(organizationId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success('Tempo congelado. A partir de agora ele só anda por comando.');
    });
  };

  const handleAdvance = (days: number) => {
    startTransition(async () => {
      const result = await advanceClock(organizationId, days);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      relatar(result.cycle);
    });
  };

  /**
   * A confirmação acontece fora da transição, pelo mesmo motivo das outras
   * telas: esperar o clique de uma pessoa dentro de `startTransition` prende a
   * transição por tempo indefinido.
   */
  const handleReset = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Voltar ao relógio de parede',
      description:
        'As assinaturas e os lançamentos criados enquanto o tempo estava adiantado continuam ' +
        'onde estão. O razão é append-only: desfazer o relógio não desfaz a história.',
      confirmLabel: 'Voltar ao tempo real',
      tone: 'neutral',
    });

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await resetClock(organizationId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      setUltimo(null);
      toast.success('De volta ao relógio de parede.');
    });
  };

  const handleRunCycle = () => {
    startTransition(async () => {
      const result = await runBillingCycle(organizationId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      relatar(result.cycle);
    });
  };

  if (!clock.virtual) {
    return (
      <Panel
        title="Congelar o tempo"
        description="Enquanto o relógio for o de parede, não há o que adiantar."
      >
        <div className="space-y-4 px-5 py-5 text-sm text-ink-muted">
          <p>
            Congelar para o instante atual e passar a controlar a passagem do tempo. Vale só para
            esta organização.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={handleFreeze}>
              {pending ? 'Congelando...' : 'Congelar o tempo'}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={handleRunCycle}>
              Rodar o ciclo agora
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  const saltos: { label: string; days: number }[] = [
    { label: '+ 1 dia', days: 1 },
    { label: '+ 7 dias', days: 7 },
    { label: '+ 1 mês', days: 30 },
    { label: '+ 3 meses', days: 90 },
    { label: '+ 1 ano', days: 365 },
  ];

  return (
    <Panel
      title="Adiantar o tempo"
      description="Cada avanço roda o ciclo de cobrança até não sobrar nada vencido."
    >
      <div className="space-y-5 px-3 py-5 sm:px-5">
        <div className="flex flex-wrap gap-2">
          {saltos.map((salto) => (
            <Button
              key={salto.days}
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                handleAdvance(salto.days);
              }}
            >
              {salto.label}
            </Button>
          ))}

          {/*
            O salto até a véspera da próxima virada é o mais útil da tela: leva
            direto ao instante em que alguma coisa está prestes a acontecer, sem
            ninguém ter que calcular quantos dias faltam.
          */}
          {daysToNextRenewal !== null && daysToNextRenewal > 0 && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                handleAdvance(daysToNextRenewal);
              }}
            >
              Até a próxima virada ({daysToNextRenewal} dia
              {daysToNextRenewal === 1 ? '' : 's'})
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
          <Button type="button" variant="secondary" disabled={pending} onClick={handleRunCycle}>
            Rodar o ciclo sem avançar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => {
              void handleReset();
            }}
          >
            Voltar ao relógio de parede
          </Button>
        </div>

        {ultimo !== null && (
          <div className="border-l-2 border-credit bg-credit-soft px-4 py-3 text-sm">
            {ultimo.effects.length === 0 ? (
              <p>O tempo andou, mas nada tinha vencido ainda.</p>
            ) : (
              <>
                <p className="font-medium">
                  {ultimo.effects.length} assinatura(s) liquidada(s) neste avanço:
                </p>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {ultimo.effects.map((effect, indice) => (
                    <li key={`${effect.subscriptionId}-${indice}`}>
                      <span className="font-medium">{effect.customerName}</span>{' '}
                      <span className="text-ink-muted">{ACOES[effect.action]}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-ink-muted">
                  Cada renovação emitiu uma fatura e escreveu no razão. Confira no balancete.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** "2 renovadas, 1 expirada", para caber em um toast. */
function resumir(effects: CycleEffect[]): string {
  const contagem = new Map<string, number>();

  for (const effect of effects) {
    contagem.set(effect.action, (contagem.get(effect.action) ?? 0) + 1);
  }

  return [...contagem.entries()].map(([acao, quantas]) => `${quantas} ${acao}(s)`).join(', ');
}
