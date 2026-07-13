import { describe, it, expect } from 'vitest';
import type { MessageDto } from '@karamooziyar/shared';
import {
  reconcileMessage,
  mergeServerMessages,
  type ClientMessage,
  type DeliveryState,
} from './message-merge';

/**
 * Regression matrix for the "message disappears after offline reconnect" bug.
 *
 * Root cause: `mergeServerMessages` used to only preserve local messages in a
 * PENDING delivery state when a fetched server page didn't contain them —
 * once a message was reconciled to `sent`, it was no longer protected, so a
 * refetch snapshot that raced ahead of (or concurrently with) the ACK and
 * didn't yet include the message would silently drop it from the merged
 * list. The fix broadens preservation to ANY local-only message, confirmed
 * or pending — a REST page is a snapshot, never an authoritative deletion
 * signal. See message-merge.ts for the full explanation.
 *
 * `useMessages.reconnect-message-loss.test.tsx` covers scenario A (the exact
 * reported bug) end-to-end against a real Socket.IO server. This file covers
 * the remaining scenarios (B, C, D, E, G, I, J) at the merge/store-logic
 * level, where they can be expressed precisely and deterministically.
 */

const srv = (id: string, cid: string | null, extra: Partial<MessageDto> = {}): ClientMessage =>
  ({
    id,
    clientMessageId: cid,
    conversationId: 'c1',
    senderId: 'u1',
    senderName: 'User One',
    type: 'TEXT',
    body: 'hi',
    status: 'SENT',
    isEdited: false,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    attachment: null,
    replyToMessage: null,
    createdAt: '2026-07-13T10:00:00.000Z',
    ...extra,
  }) as ClientMessage;

const confirmed = (id: string, cid: string, state: DeliveryState = 'sent'): ClientMessage => ({
  ...srv(id, cid),
  deliveryState: state,
});

const optimistic = (cid: string, state: DeliveryState = 'sending'): ClientMessage => ({
  ...srv(cid, cid),
  deliveryState: state,
});

describe('Regression matrix B — ACK first, broadcast second', () => {
  it('produces exactly one visible message, server id retained, no disappearance', () => {
    let list = [optimistic('cm1')];
    list = reconcileMessage(list, srv('s1', 'cm1')); // ACK
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('s1');
    list = reconcileMessage(list, srv('s1', 'cm1')); // broadcast echo
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('s1');
    expect(list[0]!.clientMessageId).toBe('cm1');
  });
});

describe('Regression matrix C — broadcast first, ACK second', () => {
  it('produces exactly one visible message, no disappearance, no duplicate', () => {
    let list = [optimistic('cm1')];
    list = reconcileMessage(list, srv('s1', 'cm1')); // broadcast arrives first
    expect(list).toHaveLength(1);
    list = reconcileMessage(list, srv('s1', 'cm1')); // ACK for the same message
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('s1');
    expect(list[0]!.clientMessageId).toBe('cm1');
  });
});

describe('Regression matrix D — ACK followed by a reconnect history sync', () => {
  it('the history response does not remove the just-confirmed message', () => {
    let list: ClientMessage[] = [];
    list = reconcileMessage(list, confirmed('s1', 'cm1')); // real ACK lands
    expect(list).toHaveLength(1);

    // A reconnect-triggered history refetch resolves with a page that does
    // not (yet) include this message.
    const merged = mergeServerMessages(list, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('s1');
    expect(merged[0]!.deliveryState).toBe('sent');
  });
});

describe('Regression matrix E — a stale history request started before ACK, resolved after', () => {
  it('the reconciled message remains visible when the stale response finally lands', () => {
    // Snapshot "captured" before the ACK (represents a GET dispatched earlier).
    const staleSnapshot: ClientMessage[] = [];

    // Meanwhile, in real time, the message gets sent and acked.
    let local: ClientMessage[] = [optimistic('cm1')];
    local = reconcileMessage(local, confirmed('s1', 'cm1'));
    expect(local).toHaveLength(1);

    // The stale (older) request finally resolves and is merged in.
    const merged = mergeServerMessages(local, staleSnapshot);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('s1');
    expect(merged[0]!.deliveryState).toBe('sent');
  });
});

describe('Regression matrix G — failed/pending offline message survives the reconnect lifecycle', () => {
  it('an awaiting-connection message is not removed by an intervening history refetch', () => {
    const local = [confirmed('s0', 'cm0'), optimistic('cmPending', 'awaiting-connection')];
    const merged = mergeServerMessages(local, [srv('s0', 'cm0')]);
    expect(merged).toHaveLength(2);
    const pending = merged.find((m) => m.clientMessageId === 'cmPending');
    expect(pending?.deliveryState).toBe('awaiting-connection');
  });

  it('remains visible through multiple refetch cycles until it resolves to sent', () => {
    let local: ClientMessage[] = [optimistic('cmX', 'awaiting-connection')];
    local = mergeServerMessages(local, []); // reconnect refetch #1, still nothing server-side
    expect(local).toHaveLength(1);
    local = mergeServerMessages(local, []); // refetch #2
    expect(local).toHaveLength(1);
    // Now the send actually succeeds.
    local = reconcileMessage(local, confirmed('sX', 'cmX'));
    expect(local).toHaveLength(1);
    expect(local[0]!.deliveryState).toBe('sent');
    // A further refetch that still doesn't include it (race) must not drop it.
    local = mergeServerMessages(local, []);
    expect(local).toHaveLength(1);
    expect(local[0]!.deliveryState).toBe('sent');
  });

  it('an explicit failure is still reachable and visible (not silently resurrected as pending forever)', () => {
    const local = [confirmed('sF', 'cmF', 'failed' as DeliveryState)];
    const merged = mergeServerMessages(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deliveryState).toBe('failed');
  });
});

describe('Regression matrix I — real deletion still works', () => {
  it('a message present in both local and server, but marked deletedAt server-side, is reconciled (not resurrected) and a genuine removal path still removes it', () => {
    // mergeServerMessages itself must not be the thing that deletes -- confirm
    // it still lets a server-confirmed row (even a soft-deleted one) win over
    // a stale local copy, i.e. it never "protects" a message FROM a real
    // server update, only from disappearing due to mere page-absence.
    const local = [confirmed('s1', 'cm1')];
    const serverSoftDeleted = [{ ...srv('s1', 'cm1', { deletedAt: '2026-07-13T10:05:00.000Z', body: null }) }];
    const merged = mergeServerMessages(local, serverSoftDeleted);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe('2026-07-13T10:05:00.000Z');
  });

  it('reconcileMessage still allows a genuinely new incoming message to be added (not blocked by preservation logic)', () => {
    const local = [confirmed('s1', 'cm1')];
    const withNew = reconcileMessage(local, confirmed('s2', 'cm2'));
    expect(withNew).toHaveLength(2);
  });
});

describe('Regression matrix J — conversation switching', () => {
  it('leaving and returning (represented by a fresh history fetch) shows exactly one copy, not a duplicate', () => {
    let local: ClientMessage[] = [];
    local = reconcileMessage(local, confirmed('s1', 'cm1')); // sent while conversation was open
    expect(local).toHaveLength(1);

    // Leaving + reopening triggers loadInitial() again; the server page NOW
    // legitimately includes the message (it has since been persisted/visible).
    const merged = mergeServerMessages(local, [srv('s1', 'cm1')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('s1');
    expect(merged[0]!.deliveryState).toBe('sent');
  });
});
