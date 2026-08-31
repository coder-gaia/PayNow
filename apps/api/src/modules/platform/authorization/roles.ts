import { OrganizationRole } from '@prisma/client';

export { OrganizationRole };

/**
 * Hierarquia de papéis dentro de uma organização.
 *
 * Vive em `platform` porque autorização atravessa módulos: identidade, ledger
 * e, a partir da fase 03, assinaturas e cobrança precisam da mesma comparação.
 * A ADR-0001 impede que qualquer um deles importe do outro, então o vocabulario
 * compartilhado fica aqui.
 */

/**
 * Poder relativo de cada papel. Número maior manda mais.
 *
 * Com quatro papéis estritamente ordenados, comparar níveis resolve toda
 * autorização do sistema. Uma matriz de permissão por recurso só entraria se
 * algum dia existisse um papel que pode uma coisa e não pode outra fora dessa
 * ordem, e não existe.
 */
const RANK: Readonly<Record<OrganizationRole, number>> = {
  [OrganizationRole.OWNER]: 40,
  [OrganizationRole.ADMIN]: 30,
  [OrganizationRole.MEMBER]: 20,
  [OrganizationRole.READONLY]: 10,
};

/** Verdadeiro se `role` tem pelo menos o poder de `required`. */
export function roleSatisfies(role: OrganizationRole, required: OrganizationRole): boolean {
  return RANK[role] >= RANK[required];
}

/** Verdadeiro se `actor` tem estritamente mais poder que `target`. */
export function outranks(actor: OrganizationRole, target: OrganizationRole): boolean {
  return RANK[actor] > RANK[target];
}
