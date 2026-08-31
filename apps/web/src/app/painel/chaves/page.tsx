import { Cell, formatDate, PageHeader, Panel, Table } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

import { CreateApiKeyForm } from './create-api-key-form';
import { RevokeApiKeyButton } from './revoke-api-key-button';

export const metadata = { title: 'Chaves de API · Paynow' };

const CAN_MANAGE = new Set(['OWNER', 'ADMIN']);

export default async function ApiKeysPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  if (!CAN_MANAGE.has(active.role)) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Chaves de API" title="Sem acesso" />
        <Panel>
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            Chaves de API sao administradas por OWNER e ADMIN. Seu papel e {active.role}.
          </p>
        </Panel>
      </div>
    );
  }

  const keys = await api.apiKeys(active.id);
  const live = keys.filter((key) => key.revokedAt === null);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Chaves de API"
        title="Credenciais de servidor"
        description="Uma chave autentica o servidor do merchant, nunca uma pessoa. Ela nao abre nenhuma rota do painel, mesmo sendo valida."
      />

      <Panel
        title="Criar chave"
        description="O segredo completo aparece uma unica vez. Depois disso so o prefixo fica."
      >
        <CreateApiKeyForm organizationId={active.id} />
      </Panel>

      <Panel
        title={`${live.length} ${live.length === 1 ? 'chave ativa' : 'chaves ativas'}`}
        description={
          keys.length > live.length
            ? `Mais ${keys.length - live.length} revogada(s), mantidas para preservar a trilha de uso.`
            : undefined
        }
      >
        {keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            Nenhuma chave ainda. Crie a primeira acima.
          </p>
        ) : (
          <Table headers={['Nome', 'Chave', 'Ambiente', 'Ultimo uso', '']}>
            {keys.map((key) => (
              <tr key={key.id} className={key.revokedAt === null ? '' : 'opacity-55'}>
                <Cell>
                  <span className="font-medium">{key.name}</span>
                  <span className="block text-[13px] text-ink-muted">
                    Criada em {formatDate(key.createdAt)}
                  </span>
                </Cell>
                <Cell className="font-mono text-[13px]">
                  {key.prefix}
                  <span className="text-ink-faint">...</span>
                </Cell>
                <Cell>
                  <span className="font-mono text-[11px] tracking-[0.08em] text-ink-muted">
                    {key.environment}
                  </span>
                </Cell>
                <Cell className="tabular text-[13px] text-ink-muted">
                  {key.lastUsedAt === null ? 'nunca' : formatDate(key.lastUsedAt)}
                </Cell>
                <Cell className="text-right">
                  {key.revokedAt === null ? (
                    <RevokeApiKeyButton
                      organizationId={active.id}
                      apiKeyId={key.id}
                      name={key.name}
                    />
                  ) : (
                    <span className="font-mono text-[11px] text-debit">REVOGADA</span>
                  )}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
