import { toSlugBase } from './slug';

describe('toSlugBase', () => {
  it('reduz a minusculas com hifens', () => {
    expect(toSlugBase('Livraria Aurora')).toBe('livraria-aurora');
  });

  it('remove acentos', () => {
    expect(toSlugBase('Café da Esquina')).toBe('cafe-da-esquina');
    expect(toSlugBase('Ação & Reação')).toBe('acao-reacao');
  });

  it('colapsa separadores repetidos e apara as pontas', () => {
    expect(toSlugBase('  ---Loja   do   Zé---  ')).toBe('loja-do-ze');
  });

  it('limita o comprimento', () => {
    expect(toSlugBase('a'.repeat(100))).toHaveLength(40);
  });

  it('devolve um padrão quando não sobra nada aproveitável', () => {
    expect(toSlugBase('!!!')).toBe('organizacao');
    expect(toSlugBase('   ')).toBe('organizacao');
  });
});
