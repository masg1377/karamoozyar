import type { MessageDto } from '@karamooziyar/shared';

/**
 * Client-side delivery state machine for outgoing messages.
 *
 *   queued    → created locally, not yet uploaded/emitted (e.g. offline)
 *   uploading → media bytes are being uploaded
 *   sending   → emitted to the server, waiting for a durable ack
 *   sent      → server confirmed durable persistence (ack ok)
 *   seen      → recipient has read it
 *   failed    → upload/send failed; remains visible, manual retry available
 *
 * `sent`/`seen`/undefined are "confirmed" (server-backed). The rest are
 * "pending local" and must never be discarded by a refetch/reconnect.
 */
export type DeliveryState =
  | 'queued'
  | 'uploading'
  | 'sending'
  // Send could not complete because the socket transport is down (not
  // connected / reconnect timed out / ack timed out due to connection
  // loss). Distinct from `failed`: the server never rejected anything, so
  // this is retried automatically (once) on the next `connect` instead of
  // requiring a manual retry.
  | 'awaiting-reconnect'
  | 'sent'
  | 'seen'
  | 'failed';

export interface ClientMessage extends MessageDto {
  deliveryState?: DeliveryState;
}

const PENDING_STATES: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  'queued',
  'uploading',
  'sending',
  'awaiting-reconnect',
  'failed',
]);

/** True for outgoing items not yet durably confirmed by the server. */
export function isPendingLocal(m: ClientMessage): boolean {
  return !!m.deliveryState && PENDING_STATES.has(m.deliveryState);
}

/**
 * Stable dedup identity. Prefer the client-generated id (present on every
 * message created by this app since idempotency landed); fall back to the
 * server id for legacy rows that have no clientMessageId.
 */
export function identityKey(m: Pick<MessageDto, 'id' | 'clientMessageId'>): string {
  return m.clientMessageId ?? m.id;
}

/**
 * Reconcile a single confirmed/incoming server message into a list without
 * ever creating a duplicate.
 *
 * - Matches an existing entry by clientMessageId OR by server id (covers an
 *   optimistic item being confirmed, and a live/replayed broadcast of an item
 *   already rendered).
 * - Replaces in place to preserve ordering (no "jumping").
 * - Appends only when genuinely new.
 *
 * `keepState` lets the caller preserve an explicit local state (e.g. an
 * optimistic insert that should stay `sending`); otherwise a server message
 * defaults to `sent` and a `seen` status is honored.
 */
export function reconcileMessage(
  list: ClientMessage[],
  incoming: ClientMessage,
  keepState?: DeliveryState,
): ClientMessage[] {
  const key = identityKey(incoming);
  const idx = list.findIndex(
    (m) => identityKey(m) === key || m.id === incoming.id,
  );

  const resolvedState: DeliveryState =
    keepState ??
    incoming.deliveryState ??
    (incoming.status === 'SEEN' ? 'seen' : 'sent');

  const normalized: ClientMessage = { ...incoming, deliveryState: resolvedState };

  if (idx >= 0) {
    const next = list.slice();
    // Preserve the original createdAt position; merge fields from server.
    next[idx] = { ...list[idx], ...normalized } as ClientMessage;
    return next;
  }
  return [...list, normalized];
}

/**
 * Merge a freshly fetched server page into the local list (used on initial
 * load and after reconnect). Server data is authoritative for confirmed
 * messages, but locally PENDING messages (queued/uploading/sending/failed)
 * the server does not yet know about are preserved and kept after the
 * server items (they are the newest, by construction).
 *
 * This is the fix for "messages disappear after reconnect": a refetch can no
 * longer blow away an in-flight or failed optimistic message.
 */
export function mergeServerMessages(
  local: ClientMessage[],
  server: ClientMessage[],
): ClientMessage[] {
  const serverKeys = new Set(server.map(identityKey));
  const serverIds = new Set(server.map((m) => m.id));

  const preservedPending = local.filter(
    (m) =>
      isPendingLocal(m) &&
      !serverKeys.has(identityKey(m)) &&
      !serverIds.has(m.id),
  );

  const confirmedServer = server.map((m) => ({
    ...m,
    deliveryState: (m.deliveryState ??
      (m.status === 'SEEN' ? 'seen' : 'sent')) as DeliveryState,
  }));

  return [...confirmedServer, ...preservedPending];
}
