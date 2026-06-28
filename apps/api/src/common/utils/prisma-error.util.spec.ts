import { isUniqueViolation } from './prisma-error.util';

describe('isUniqueViolation', () => {
  it('detects Prisma P2002 (unique constraint failed)', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('dup'), { code: 'P2002' }))).toBe(true);
  });

  it('returns false for other errors and non-objects', () => {
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('P2002')).toBe(false);
  });
});
