import { Cell, formatDate, PageHeader, Panel, RolePill, Table } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

import { AddMemberForm } from './add-member-form';
import { MemberActions } from './member-actions';

export const metadata = { title: 'Membros · Paynow' };

/** Papéis que administram membros. Quem esta abaixo disso só enxerga a lista. */
const CAN_MANAGE = new Set(['OWNER', 'ADMIN']);

export default async function MembersPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);
  const members = await api.members(active.id);

  const canManage = CAN_MANAGE.has(active.role);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Membros"
        title="Quem tem acesso"
        description="Os papéis são estritamente ordenados. Ninguém concede um papel igual ou superior ao próprio, e a organização nunca fica sem OWNER."
      />

      <Panel
        title={`${members.length} ${members.length === 1 ? 'pessoa' : 'pessoas'}`}
        description={
          canManage
            ? 'Você pode administrar quem está abaixo do seu papel.'
            : `Seu papel é ${active.role}, então a lista é somente leitura.`
        }
      >
        <Table headers={['Pessoa', 'Papel', 'Entrou em', '']}>
          {members.map((member) => (
            <tr key={member.userId}>
              <Cell>
                <span className="block font-medium">{member.name}</span>
                <span className="block text-[13px] text-ink-muted">{member.email}</span>
              </Cell>
              <Cell>
                <RolePill role={member.role} />
              </Cell>
              <Cell className="tabular text-[13px] text-ink-muted">
                {formatDate(member.joinedAt)}
              </Cell>
              <Cell className="text-right">
                {canManage && (
                  <MemberActions
                    organizationId={active.id}
                    member={member}
                    isSelf={member.userId === profile.id}
                  />
                )}
              </Cell>
            </tr>
          ))}
        </Table>
      </Panel>

      {canManage && (
        <Panel
          title="Adicionar membro"
          description="A pessoa precisa já ter conta no Paynow. Convite por email entra em uma fase futura."
        >
          <AddMemberForm organizationId={active.id} actorRole={active.role} />
        </Panel>
      )}
    </div>
  );
}
