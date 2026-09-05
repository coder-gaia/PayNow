import { PageHeader, Panel } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

import { ChaosControls } from './chaos-controls';

export const metadata = { title: 'Console de caos · Paynow' };

/**
 * Console de caos.
 *
 * A tese do projeto é que corretude se verifica, e verificar exige poder
 * provocar. Um provedor de pagamento real falha raramente e nunca sob demanda,
 * então demonstrar recuperação com um provedor real é esperar dar sorte.
 *
 * Aqui a falha é um botão.
 */
export default async function CaosPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);
  const estado = await api.chaos(active.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Console de caos"
        title="Programe o provedor para falhar"
        description="Um provedor de verdade falha raramente e nunca na hora que você precisa mostrar. Aqui a falha é um botão, e o sistema reage de verdade: razão, recuperação e webhooks."
      />

      <ChaosControls organizationId={active.id} estado={estado} role={active.role} />

      <Panel title="O que observar depois de cobrar">
        <div className="space-y-3 px-5 py-4 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">Recusar:</strong> a assinatura cai para PAST_DUE e o acesso
            continua. Cortar no primeiro dia de atraso transforma uma falha de cartão em
            cancelamento, e a recuperação existe justamente para evitar isso.
          </p>
          <p>
            <strong className="text-ink">Não responder:</strong> a tentativa fica pendente e o
            sistema não afirma nada sobre o dinheiro. Repetir usa a mesma chave de idempotência, e é
            isso que impede a cobrança em dobro.
          </p>
          <p>
            <strong className="text-ink">Não responder tendo cobrado:</strong> o caso difícil. O
            dinheiro saiu e ninguém aqui sabe. Só o webhook de entrada resolve, e é por isso que ele
            existe.
          </p>
        </div>
      </Panel>
    </div>
  );
}
