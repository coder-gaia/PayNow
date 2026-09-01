'use client';

import { useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { chargeInvoice, refundPayment } from '@/lib/actions';
import type { Invoice } from '@/lib/api';

/**
 * Ações por fatura.
 *
 * O que estas duas ações têm em comum é que ambas mexem em dinheiro de
 * verdade, então nenhuma delas acontece sem confirmação, e as duas dizem o que
 * vai acontecer em vez de perguntar "tem certeza?".
 */
export function InvoiceActions({
  organizationId,
  invoice,
}: {
  organizationId: string;
  invoice: Invoice;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const confirm = useConfirm();

  /**
   * A confirmação fica fora da transição, como nas outras telas: esperar o
   * clique de uma pessoa dentro de `startTransition` prende a transição por
   * tempo indefinido.
   */
  const handleCharge = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Cobrar a fatura nº ${invoice.number}`,
      description:
        `${invoice.customer.name} será cobrada em ${invoice.amount.replace('.', ',')} ` +
        `${invoice.currency} no meio de pagamento cadastrado. ` +
        (invoice.attemptCount > 0
          ? `Esta será a tentativa ${invoice.attemptCount + 1}.`
          : 'Esta é a primeira tentativa.'),
      confirmLabel: 'Cobrar agora',
      tone: 'neutral',
    });

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await chargeInvoice(organizationId, invoice.id);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      const cobranca = result.charge;

      if (cobranca === undefined || cobranca.status === 'SUCCEEDED') {
        toast.success(`Fatura nº ${invoice.number} quitada.`);
        return;
      }

      // Recusa e incerteza recebem mensagens diferentes de propósito. Dizer
      // "não foi autorizada" quando o provedor não respondeu seria afirmar
      // algo que ninguém sabe.
      if (cobranca.status === 'PENDING') {
        toast.error(
          'O provedor não respondeu a tempo. A cobrança pode ou não ter acontecido, e a ' +
            'tentativa ficou registrada como indefinida.',
        );
        return;
      }

      toast.error(
        `Cobrança recusada (${cobranca.failureCode ?? 'sem código'}). A recuperação continua ` +
          'automaticamente no horário agendado.',
      );
    });
  };

  const handleRefund = async (): Promise<void> => {
    const pago = invoice.payments.find((payment) => payment.status === 'SUCCEEDED');

    if (pago === undefined) {
      return;
    }

    const confirmed = await confirm({
      title: `Estornar a fatura nº ${invoice.number}`,
      description:
        `Devolve ${invoice.amount.replace('.', ',')} ${invoice.currency} a ` +
        `${invoice.customer.name}. O pagamento original continua no razão: o estorno é um ` +
        'lançamento novo, e o histórico guarda os dois. A taxa da plataforma não volta.',
      confirmLabel: 'Estornar',
    });

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await refundPayment(organizationId, pago.id, 'Estorno pelo painel');

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(`Estorno da fatura nº ${invoice.number} concluído.`);
    });
  };

  if (invoice.status === 'PAID') {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void handleRefund();
          }}
          className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
        >
          Estornar
        </button>
      </div>
    );
  }

  if (invoice.status !== 'OPEN') {
    return <span className="block text-right text-[13px] text-ink-faint">sem ações</span>;
  }

  return (
    <div className="flex justify-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void handleCharge();
        }}
        className="border border-rule-strong px-2 py-1 text-[13px] transition hover:bg-surface-sunken disabled:opacity-50"
      >
        {pending ? 'Cobrando...' : 'Cobrar'}
      </button>
    </div>
  );
}
