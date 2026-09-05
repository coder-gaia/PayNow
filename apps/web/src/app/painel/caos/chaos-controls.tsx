'use client';

import { useState, useTransition } from 'react';

import { Button, Panel } from '@/components/ui';
import { useToast } from '@/components/toast';
import { resetChaos, setChaosScenario } from '@/lib/actions';
import type { ChaosState, OrganizationRole } from '@/lib/api';

/**
 * Os botões que quebram o provedor.
 *
 * O cenário programado fica visível o tempo todo, e não escondido atrás de um
 * toast que some: quem programou uma falha e esqueceu vai ver toda cobrança
 * seguinte falhar sem entender por quê.
 */
export function ChaosControls({
  organizationId,
  estado,
  role,
}: {
  organizationId: string;
  estado: ChaosState;
  role: OrganizationRole;
}) {
  const [pendente, startTransition] = useTransition();
  const [emAndamento, setEmAndamento] = useState<string | null>(null);
  const { success, error: falhou } = useToast();

  const podeProgramar = role === 'OWNER' || role === 'ADMIN';

  const aplicar = (cenario: ChaosState['cenarios'][number]) => {
    setEmAndamento(chaveDo(cenario));

    startTransition(async () => {
      const resultado = await setChaosScenario(organizationId, {
        kind: cenario.kind,
        ...(cenario.desfechoReal === undefined ? {} : { desfechoReal: cenario.desfechoReal }),
        ...(cenario.failures === undefined ? {} : { failures: cenario.failures }),
      });

      setEmAndamento(null);

      if (resultado.error !== undefined) {
        falhou(resultado.error);
        return;
      }

      success(`Provedor programado: ${cenario.titulo.toLowerCase()}.`);
    });
  };

  const zerar = () => {
    setEmAndamento('reset');

    startTransition(async () => {
      const resultado = await resetChaos(organizationId);
      setEmAndamento(null);

      if (resultado.error !== undefined) {
        falhou(resultado.error);
        return;
      }

      success('Provedor de volta ao caminho feliz.');
    });
  };

  return (
    <Panel
      title="Programado agora"
      description="Vale para toda cobrança até ser trocado. O estado é do processo, e não da organização."
      action={
        podeProgramar ? (
          <Button variant="secondary" onClick={zerar} disabled={pendente}>
            {emAndamento === 'reset' ? 'Zerando...' : 'Voltar ao normal'}
          </Button>
        ) : undefined
      }
    >
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-5 py-4">
        <span className="font-display text-xl font-semibold">{descrever(estado.scenario)}</span>
        {estado.naoContadas > 0 && (
          <span className="font-mono text-[11px] tracking-[0.14em] text-caution uppercase">
            {estado.naoContadas} desfecho(s) que o provedor ainda não contou
          </span>
        )}
      </p>

      {!podeProgramar ? (
        <p className="px-5 py-6 text-sm text-ink-muted">
          Só quem é ADMIN ou OWNER pode programar o provedor.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {estado.cenarios.map((cenario) => (
            <li
              key={chaveDo(cenario)}
              className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{cenario.titulo}</span>
                <span className="mt-0.5 block text-[13px] text-ink-muted">{cenario.descricao}</span>
              </span>

              <Button
                onClick={() => {
                  aplicar(cenario);
                }}
                disabled={pendente}
              >
                {emAndamento === chaveDo(cenario) ? 'Programando...' : 'Programar'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function chaveDo(cenario: { kind: string; desfechoReal?: string; failures?: number }): string {
  return [cenario.kind, cenario.desfechoReal, cenario.failures].filter(Boolean).join(':');
}

function descrever(cenario: { kind: string; desfechoReal?: string; failures?: number }): string {
  switch (cenario.kind) {
    case 'succeed':
      return 'Aprovar toda cobrança';
    case 'decline':
      return 'Recusar toda cobrança';
    case 'timeout':
      return cenario.desfechoReal === 'succeeded'
        ? 'Não responder, tendo cobrado'
        : cenario.desfechoReal === 'failed'
          ? 'Não responder, tendo recusado'
          : 'Não responder, sem cobrar';
    case 'failThenSucceed':
      return `Falhar ${cenario.failures ?? 2} vez(es) e passar`;
    default:
      return cenario.kind;
  }
}
