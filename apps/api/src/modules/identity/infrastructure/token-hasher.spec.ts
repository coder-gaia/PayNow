import { TokenHasher } from './token-hasher';

describe('TokenHasher', () => {
  const hasher = new TokenHasher();

  describe('generateSecret', () => {
    it('produz segredo seguro para URL', () => {
      expect(hasher.generateSecret()).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('nunca repete', () => {
      const amostra = new Set(Array.from({ length: 500 }, () => hasher.generateSecret()));
      expect(amostra.size).toBe(500);
    });

    it('carrega 32 bytes de entropia', () => {
      // 32 bytes em base64url, sem preenchimento, dao 43 caracteres.
      expect(hasher.generateSecret()).toHaveLength(43);
    });
  });

  describe('hash', () => {
    it('e determinístico', () => {
      const secret = hasher.generateSecret();
      expect(hasher.hash(secret)).toBe(hasher.hash(secret));
    });

    it('produz digest hexadecimal de 256 bits', () => {
      expect(hasher.hash('qualquer coisa')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('muda completamente com uma alteração mínima na entrada', () => {
      expect(hasher.hash('segredo')).not.toBe(hasher.hash('segredp'));
    });
  });

  describe('matches', () => {
    it('reconhece o segredo correto', () => {
      const secret = hasher.generateSecret();
      expect(hasher.matches(secret, hasher.hash(secret))).toBe(true);
    });

    it('recusa segredo errado', () => {
      expect(hasher.matches('errado', hasher.hash('certo'))).toBe(false);
    });

    it('recusa hash de tamanho inválido sem estourar', () => {
      expect(hasher.matches('qualquer', 'curto-demais')).toBe(false);
      expect(hasher.matches('qualquer', '')).toBe(false);
    });
  });
});
