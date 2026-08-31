'use client';

import { useOptimistic, useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { Select } from '@/components/form';
import { useToast } from '@/components/toast';
import { cancelSubscription, changePlan, resumeSubscription } from '@/lib/actions';
import type { Subscription } from '@/lib/api';

import type { PlanOption } from './page';

/**
 * Ações por assinatura.
 *
 * A troca de plano usa `useOptimistic` pelo mesmo motivo da tabela de membros:
 * um `<select>` não controlado guardaria o plano escolhido mesmo depois de o
 * servidor recusar a troca, e a tela passaria a mostrar um plano que não existe
 * no banco. Com estado otimista, o valor volta sozinho para o dado real quando
 * a transição termina, tenha ela dado certo ou não.
 *
 * `version` viaja junto em toda mutação. Ela é a versão que esta tela leu, e a
 * API compara com a atual: se alguém trocou o plano enquanto esta página estava
 * aberta, a resposta é um erro visível em vez de uma sobrescrita silenciosa
 * calculada sobre dado velho. Ver a ADR-0008.
 */
export function SubscriptionActions({
  organizationId,
  subscription,
  plans,
}: {
  organizationId: string;
  subscription: Subscription;
  plans: PlanOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [priceId, setOptimisticPriceId] = useOptimistic(subscription.plan.priceId);
  const toast = useToast();
  const confirm = useConfirm();

  const encerrada = subscription.status === 'CANCELED' || subscription.status === 'EXPIRED';

  const handlePlanChange = (nextPriceId: string) => {
    if (nextPriceId === subscription.plan.priceId) {
      return;
    }

    startTransition(async () => {
      setOptimisticPriceId(nextPriceId);
      const result = await changePlan(
        organizationId,
        subscription.id,
        nextPriceId,
        subscription.version,
      );

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      const rateio = result.proration;

      if (rateio === undefined) {
        toast.success('Plano trocado.');
        return;
      }

      // O rateio aparece por extenso de propósito. Quem troca de plano no meio
      // do ciclo quer saber o que aconteceu com o dinheiro do mês corrente, e
      // esconder a conta é o que faz uma cobrança virar reclamação.
      toast.success(
        `Plano trocado com ${rateio.remainingDays} de ${rateio.cycleDays} dias restantes. ` +
          `Crédito de ${moeda(rateio.credit)}, cobrança de ${moeda(rateio.charge)}, ` +
          `saldo de ${moeda(rateio.net)} ${rateio.currency}.`,
      );
    });
  };

  /**
   * A confirmação acontece fora da transição. Esperar a resposta de uma pessoa
   * dentro de `startTransition` prende a transição por tempo indefinido, e a
   * abertura do diálogo vira uma atualização presa dentro da própria transição
   * que depende dela para terminar.
   */
  const handleCancel = async (immediate: boolean): Promise<void> => {
    const confirmed = await confirm(
      immediate
        ? {
            title: 'Encerrar agora',
            description: `${subscription.customer.name} perde o acesso imediatamente, mesmo tendo pago até ${formatarData(subscription.currentPeriodEnd)}.`,
            confirmLabel: 'Encerrar agora',
          }
        : {
            title: 'Cancelar no fim do ciclo',
            description: `${subscription.customer.name} continua com acesso até ${formatarData(subscription.currentPeriodEnd)} e não é cobrada de novo. Dá para voltar atrás até lá.`,
            confirmLabel: 'Agendar cancelamento',
            tone: 'neutral',
          },
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await cancelSubscription(
        organizationId,
        subscription.id,
        immediate,
        subscription.version,
      );

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(
        immediate
          ? `Assinatura de ${subscription.customer.name} encerrada.`
          : `Assinatura de ${subscription.customer.name} encerra em ${formatarData(subscription.currentPeriodEnd)}.`,
      );
    });
  };

  const handleResume = () => {
    startTransition(async () => {
      const result = await resumeSubscription(organizationId, subscription.id);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(`Assinatura de ${subscription.customer.name} retomada.`);
    });
  };

  if (encerrada) {
    return <span className="text-[13px] text-ink-faint">sem ações</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select
        aria-label={`Plano de ${subscription.customer.name}`}
        value={priceId}
        disabled={pending}
        className="w-auto py-1 text-[13px]"
        onChange={(event) => {
          handlePlanChange(event.target.value);
        }}
      >
        {plans.map((plano) => (
          <option key={plano.id} value={plano.id}>
            {plano.product} · {plano.amount.replace('.', ',')}
          </option>
        ))}
      </Select>

      {subscription.cancelAtPeriodEnd ? (
        <button
          type="button"
          disabled={pending}
          onClick={handleResume}
          className="border border-rule px-2 py-1 text-[13px] transition hover:border-rule-strong disabled:opacity-50"
        >
          Retomar
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void handleCancel(false);
          }}
          className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

/** A API devolve "10.00"; o painel fala português. */
function moeda(value: string): string {
  return value.replace('.', ',');
}

function formatarData(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}
