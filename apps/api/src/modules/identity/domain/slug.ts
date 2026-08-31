import { randomBytes } from 'node:crypto';

import type { Prisma } from '@prisma/client';

/** Faixa Unicode das marcas de acentuacao separadas pela normalizacao NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

const MAX_BASE_LENGTH = 40;
const MAX_ATTEMPTS = 100;

/** Reduz um nome livre a um identificador legivel e seguro para URL. */
export function toSlugBase(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH);

  return base.length > 0 ? base : 'organizacao';
}

/**
 * Slug unico para uma organizacao.
 *
 * Roda dentro da transacao de criacao, o que reduz a janela de corrida mas nao
 * a fecha: duas transacoes concorrentes podem escolher o mesmo candidato. O
 * indice unico do banco e quem garante a unicidade de verdade, e esta funcao
 * apenas evita que o caso comum chegue la e falhe.
 */
export async function resolveUniqueSlug(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<string> {
  const base = toSlugBase(name);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await tx.organization.findUnique({ where: { slug: candidate } });

    if (taken === null) {
      return candidate;
    }
  }

  // Cem colisoes seguidas nao acontecem por acaso. Um sufixo aleatorio e
  // melhor do que recusar a criacao.
  return `${base}-${randomBytes(3).toString('hex')}`;
}
