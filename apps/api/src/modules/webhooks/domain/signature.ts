import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura de webhook, no formato do Stripe.
 *
 * O cabeçalho carrega um instante e uma assinatura:
 *
 *     Paynow-Signature: t=1772822400,v1=<hex>
 *
 * A assinatura é HMAC-SHA256 sobre `${t}.${corpo}`, com o segredo do endereço.
 *
 * Três decisões estão nesse formato, e nenhuma é enfeite.
 *
 * **O instante entra na assinatura, e não ao lado dela.** Se ficasse de fora,
 * qualquer um poderia capturar uma entrega válida e reenviá-la para sempre: a
 * assinatura continuaria conferindo. Assinando junto, mudar o instante invalida
 * a assinatura, e quem recebe pode recusar o que for velho demais.
 *
 * **A versão é explícita.** `v1=` existe para o dia em que o algoritmo mudar.
 * Sem ela, trocar de algoritmo quebra todo integrador ao mesmo tempo; com ela,
 * dá para assinar com dois e deixar o outro lado migrar.
 *
 * **O corpo assinado é o texto exato enviado.** Não o objeto, não o objeto
 * reserializado: a sequência de bytes. Serializar duas vezes pode produzir
 * ordem de chave diferente, e a assinatura deixaria de conferir por um motivo
 * que ninguém consegue diagnosticar.
 */

const VERSION = 'v1';
const HEADER = 'paynow-signature';

/** Quanto tempo uma assinatura vale, para quem verifica. Cinco minutos. */
export const TOLERANCE_SECONDS = 300;

export interface SignedPayload {
  readonly header: string;
  readonly body: string;
}

/** Gera um segredo de assinatura novo. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/**
 * Assina o corpo e devolve o cabeçalho junto.
 *
 * Devolve os dois porque eles têm de viajar juntos e serem produzidos do mesmo
 * texto. Separar em duas funções convidaria alguém a assinar um texto e enviar
 * outro, que é o defeito mais chato de diagnosticar nesta área.
 */
export function signWebhook(payload: unknown, secret: string, now: Date): SignedPayload {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(now.getTime() / 1000);
  const assinatura = hmac(`${timestamp}.${body}`, secret);

  return { header: `t=${timestamp},${VERSION}=${assinatura}`, body };
}

export interface VerificationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Confere uma assinatura recebida.
 *
 * Existe para o lado de entrada e para quem integra poder copiar: a
 * documentação de webhook que não mostra como verificar deixa todo integrador
 * escrever a própria versão, e metade delas compara com `===`.
 *
 * A comparação é em tempo constante. Comparar hash com `===` vaza, pelo tempo
 * de resposta, quantos bytes iniciais estavam certos, e isso é suficiente para
 * forjar uma assinatura byte a byte.
 */
export function verifyWebhook(
  body: string,
  header: string | undefined,
  secret: string,
  now: Date,
  toleranceSeconds = TOLERANCE_SECONDS,
): VerificationResult {
  if (header === undefined || header.length === 0) {
    return { valid: false, reason: 'Cabeçalho de assinatura ausente.' };
  }

  const partes = new Map(
    header.split(',').map((parte) => {
      const [chave = '', valor = ''] = parte.trim().split('=', 2);
      return [chave, valor] as const;
    }),
  );

  const timestamp = Number.parseInt(partes.get('t') ?? '', 10);
  const recebida = partes.get(VERSION);

  if (!Number.isFinite(timestamp) || recebida === undefined) {
    return { valid: false, reason: 'Cabeçalho de assinatura malformado.' };
  }

  const idade = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);

  if (idade > toleranceSeconds) {
    return {
      valid: false,
      reason: `Assinatura fora da janela de ${toleranceSeconds}s. Idade: ${idade}s.`,
    };
  }

  const esperada = hmac(`${timestamp}.${body}`, secret);

  return equalsInConstantTime(esperada, recebida)
    ? { valid: true }
    : { valid: false, reason: 'Assinatura não confere.' };
}

export const SIGNATURE_HEADER = HEADER;

function hmac(conteudo: string, secret: string): string {
  return createHmac('sha256', secret).update(conteudo).digest('hex');
}

function equalsInConstantTime(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // `timingSafeEqual` exige o mesmo tamanho, e o próprio tamanho não é segredo
  // aqui: assinatura hexadecimal de SHA-256 tem sempre 64 caracteres.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
