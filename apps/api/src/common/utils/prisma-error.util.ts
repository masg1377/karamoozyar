/**
 * Detect a Prisma "unique constraint failed" error (code P2002).
 * Used by the message idempotency path: a concurrent duplicate insert that
 * loses the race against the (senderId, clientMessageId) partial unique index
 * surfaces as P2002, and we then return the winning row instead of erroring.
 *
 * Kept dependency-free (string code check) so it works regardless of the
 * installed @prisma/client version and is trivially unit-testable.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { code?: string }).code === 'P2002'
  );
}
