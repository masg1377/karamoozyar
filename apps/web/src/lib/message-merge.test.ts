import { describe, it, expect } from 'vitest';
import type { MessageDto } from '@karamooziyar/shared';
import {
  identityKey,
  isPendingLocal,
  reconcileMessage,
  mergeServerMessages,
  type ClientMessage,
  type DeliveryState,
} from './message-merge';

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
    createdAt: '2026-06-29T10:00:00.000Z',
    ...extra,
  }) as ClientMessage;

const optimistic = (cid: string, state: DeliveryState = 'sending'): ClientMessage => ({
  ...srv(cid, cid),
  deliveryState: state,
});

describe('identityKey', () => {
  it('prefers clientMessageId, falls back to server id', () => {
    expect(identityKey({ id: 'srv1', clientMessageId: 'cm1' })).toBe('cm1');
    expect(identityKey({ id: 'srv1', clientMessageId: null })).toBe('srv1');
  });
});

describe('isPendingLocal', () => {
  it('is true only for queued/uploading/sending/failed', () => {
    for (const s of ['queued', 'uploading', 'sending', 'failed'] as DeliveryState[])
      expect(isPendingLocal({ deliveryState: s } as ClientMessage)).toBe(true);
    for (const s of ['sent', 'seen', undefined] as (DeliveryState | undefined)[])
      expect(isPendingLocal({ deliveryState: s } as ClientMessage)).toBe(false);
  });
});

describe('reconcileMessage (dedup + reconciliation)', () => {
  it('reconciles an optimistic item in place when the ack arrives (no duplicate)', () => {
    const list = reconcileMessage([optimistic('cm1')], srv('srv1', 'cm1'));
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('srv1');
    expect(list[0].deliveryState).toBe('sent');
  });

  it('does not duplicate on a replayed/echoed server message', () => {
    let list = [srv('srv1', 'cm1')];
    list = reconcileMessage(list, srv('srv1', 'cm1'));
    list = reconcileMessage(list, srv('srv1', 'cm1'));
    expect(list).toHaveLength(1);
  });

  it('collapses ack-then-broadcast and broadcast-then-ack to one', () => {
    let a = reconcileMessage([optimistic('cm1')], srv('s1', 'cm1'));
    a = reconcileMessage(a, srv('s1', 'cm1'));
    expect(a).toHaveLength(1);
    let b = reconcileMessage([], srv('s2', 'cm2'));
    b = reconcileMessage(b, srv('s2', 'cm2'));
    expect(b).toHaveLength(1);
  });

  it('appends a genuinely new message and preserves position of existing ones', () => {
    let list = [srv('s1', 'cm1'), optimistic('cm2'), srv('s3', 'cm3')];
    list = reconcileMessage(list, srv('s2', 'cm2'));
    expect(list.map((m) => m.id)).toEqual(['s1', 's2', 's3']);
  });

  it('maps SEEN status to the seen delivery state', () => {
    const list = reconcileMessage([], srv('s1', 'cm1', { status: 'SEEN' }));
    expect(list[0].deliveryState).toBe('seen');
  });
});

describe('mergeServerMessages (reconnect refetch)', () => {
  it('preserves a still-pending optimistic message', () => {
    const merged = mergeServerMessages([srv('s1', 'cm1'), optimistic('cm2', 'sending')], [srv('s1', 'cm1')]);
    expect(merged).toHaveLength(2);
    expect(merged[1].deliveryState).toBe('sending');
  });

  it('preserves a FAILED message so it stays visible and retryable', () => {
    const merged = mergeServerMessages([optimistic('cmF', 'failed')], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].deliveryState).toBe('failed');
  });

  it('self-heals a failed-but-actually-persisted item (replaced by server copy, no dup)', () => {
    const merged = mergeServerMessages([optimistic('cmX', 'failed')], [srv('sX', 'cmX')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('sX');
    expect(merged[0].deliveryState).toBe('sent');
  });

  it('does not duplicate confirmed messages', () => {
    const merged = mergeServerMessages(
      [srv('s1', 'cm1'), srv('s2', 'cm2')],
      [srv('s1', 'cm1'), srv('s2', 'cm2')],
    );
    expect(merged).toHaveLength(2);
  });

  it('orders confirmed first, pending appended after (chronological)', () => {
    const merged = mergeServerMessages([optimistic('cmP', 'sending')], [srv('s1', 'cm1'), srv('s2', 'cm2')]);
    expect(merged.map(identityKey)).toEqual(['cm1', 'cm2', 'cmP']);
  });

  it('dedups legacy rows without clientMessageId by server id', () => {
    const merged = mergeServerMessages([srv('s1', null)], [srv('s1', null)]);
    expect(merged).toHaveLength(1);
  });
});
