import { OrganizationRole } from '@prisma/client';

export { OrganizationRole };

/**
 * Hierarquia de papeis dentro de uma organizacao.
 *
 * Vive em `platform` porque autorizacao atravessa modulos: identidade, ledger
 * e, a partir da fase 03, assinaturas e cobranca precisam da mesma comparacao.
 * A ADR-0001 impede que qualquer um deles importe do outro, entao o vocabulario
 * compartilhado fica aqui.
 */

/**
 * Poder relativo de cada papel. Numero maior manda mais.
 *
 * Com quatro papeis estritamente ordenados, comparar niveis resolve toda
 * autorizacao do sistema. Uma matriz de permissao por recurso so entraria se
 * algum dia existisse um papel que pode uma coisa e nao pode outra fora dessa
 * ordem, e nao existe.
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
