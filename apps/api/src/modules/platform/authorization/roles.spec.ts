import { OrganizationRole, outranks, roleSatisfies } from './roles';

const { OWNER, ADMIN, MEMBER, READONLY } = OrganizationRole;

describe('roleSatisfies', () => {
  it('aceita o proprio papel como suficiente', () => {
    for (const role of [OWNER, ADMIN, MEMBER, READONLY]) {
      expect(roleSatisfies(role, role)).toBe(true);
    }
  });

  it('aceita papel mais poderoso do que o exigido', () => {
    expect(roleSatisfies(OWNER, READONLY)).toBe(true);
    expect(roleSatisfies(ADMIN, MEMBER)).toBe(true);
    expect(roleSatisfies(MEMBER, READONLY)).toBe(true);
  });

  it('recusa papel mais fraco do que o exigido', () => {
    expect(roleSatisfies(READONLY, MEMBER)).toBe(false);
    expect(roleSatisfies(MEMBER, ADMIN)).toBe(false);
    expect(roleSatisfies(ADMIN, OWNER)).toBe(false);
  });
});

describe('outranks', () => {
  it('exige poder estritamente maior', () => {
    expect(outranks(OWNER, ADMIN)).toBe(true);
    expect(outranks(ADMIN, MEMBER)).toBe(true);
    expect(outranks(ADMIN, ADMIN)).toBe(false);
    expect(outranks(MEMBER, ADMIN)).toBe(false);
  });

  it('e a base da regra de que ninguem mexe em um igual', () => {
    for (const role of [OWNER, ADMIN, MEMBER, READONLY]) {
      expect(outranks(role, role)).toBe(false);
    }
  });
});
