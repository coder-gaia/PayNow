import { FixedClock, SystemClock } from './clock';

describe('SystemClock', () => {
  it('devolve o instante atual', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe('FixedClock', () => {
  const instant = new Date('2026-03-15T12:00:00.000Z');

  it('devolve sempre o mesmo instante', () => {
    const clock = new FixedClock(instant);

    expect(clock.now().toISOString()).toBe('2026-03-15T12:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });

  it('nao devolve a mesma referencia, para que quem chama nao consiga mutar', () => {
    const clock = new FixedClock(instant);
    const first = clock.now();
    first.setFullYear(1999);

    expect(clock.now().getFullYear()).toBe(2026);
  });

  it('avanca em milissegundos', () => {
    const clock = new FixedClock(instant);
    clock.advanceBy(90_000);

    expect(clock.now().toISOString()).toBe('2026-03-15T12:01:30.000Z');
  });

  it('move para um instante especifico', () => {
    const clock = new FixedClock(instant);
    clock.set(new Date('2027-01-01T00:00:00.000Z'));

    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
