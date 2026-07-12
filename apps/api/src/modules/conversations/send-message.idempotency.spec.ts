import { ConversationsService } from './conversations.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Gate 7 — backend idempotency verification (zombie-socket recovery
 * production evidence: an automatic recovery retry, or a manual Retry,
 * re-sends the exact same clientMessageId a second time; the server must
 * never create a second row for it).
 *
 * `ConversationsService.sendMessage()` is keyed by (senderId,
 * clientMessageId): a fast-path lookup before insert covers the common
 * sequential-duplicate case (this file's first test), and a partial unique
 * index + P2002 catch-and-recover covers the rarer true-concurrent race
 * (this file's second test) — see the method's own docstring in
 * conversations.service.ts.
 */

interface FakeMessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  type: string;
  body: string | null;
  status: string;
  isEdited: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  pinnedAt: Date | null;
  replyToMessageId: string | null;
  createdAt: Date;
  sender: { id: string; firstName: string; lastName: string };
  attachment: unknown | null;
  seenBy: unknown[];
  replyToMessage: null;
}

function buildPrisma(opts: {
  conversation: { id: string; userId: string };
  /** Simulates the true-concurrent race: the FIRST create() call throws a
   *  unique-violation (P2002) instead of succeeding, as if another request
   *  for the same clientMessageId committed a microsecond earlier. */
  raceOnCreate?: boolean;
}) {
  const rows = new Map<string, FakeMessageRow>(); // keyed by clientMessageId
  let idSeq = 0;
  let createCalls = 0;
  let attachmentCreateCalls = 0;

  const findFirst = jest.fn(async (args: { where: { senderId: string; clientMessageId: string } }) => {
    const row = rows.get(args.where.clientMessageId);
    if (!row || row.senderId !== args.where.senderId) return null;
    return row;
  });

  const create = jest.fn(async (args: { data: Record<string, unknown> }) => {
    createCalls += 1;
    if (opts.raceOnCreate && createCalls === 1) {
      // First writer loses the race: another concurrent request's row won
      // and committed between this call's own fast-path check and its
      // insert. Simulate that winning row already existing, then throw the
      // unique-constraint error this insert would really hit.
      idSeq += 1;
      const winner: FakeMessageRow = {
        id: `msg-${idSeq}`,
        conversationId: args.data['conversationId'] as string,
        senderId: args.data['senderId'] as string,
        clientMessageId: args.data['clientMessageId'] as string,
        type: args.data['type'] as string,
        body: (args.data['body'] as string | null) ?? null,
        status: 'SENT',
        isEdited: false,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        replyToMessageId: null,
        createdAt: new Date(),
        sender: { id: args.data['senderId'] as string, firstName: 'Ali', lastName: 'Rezaei' },
        attachment: null,
        seenBy: [],
        replyToMessage: null,
      };
      rows.set(winner.clientMessageId, winner);
      const err = new Error('Unique constraint failed on the fields: (`senderId`,`clientMessageId`)') as Error & {
        code: string;
      };
      err.code = 'P2002';
      throw err;
    }

    idSeq += 1;
    if (args.data['attachment']) attachmentCreateCalls += 1;
    const row: FakeMessageRow = {
      id: `msg-${idSeq}`,
      conversationId: args.data['conversationId'] as string,
      senderId: args.data['senderId'] as string,
      clientMessageId: args.data['clientMessageId'] as string,
      type: args.data['type'] as string,
      body: (args.data['body'] as string | null) ?? null,
      status: 'SENT',
      isEdited: false,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      replyToMessageId: null,
      createdAt: new Date(),
      sender: { id: args.data['senderId'] as string, firstName: 'Ali', lastName: 'Rezaei' },
      attachment: args.data['attachment']
        ? {
            id: `att-${idSeq}`,
            ...((args.data['attachment'] as { create: Record<string, unknown> }).create),
          }
        : null,
      seenBy: [],
      replyToMessage: null,
    };
    rows.set(row.clientMessageId, row);
    return row;
  });

  const conversationUpdate = jest.fn().mockResolvedValue({});

  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(opts.conversation),
      update: conversationUpdate,
    },
    message: {
      findFirst,
      findUnique: jest.fn().mockResolvedValue(null),
      create,
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ message: { create }, conversation: { update: conversationUpdate } }),
    ),
  } as unknown as PrismaService;

  return {
    prisma,
    rowCount: () => rows.size,
    createCallCount: () => createCalls,
    attachmentCreateCallCount: () => attachmentCreateCalls,
  };
}

const BASE_INPUT = {
  conversationId: 'conv-1',
  senderId: 'user-1',
  senderRole: 'USER',
  clientMessageId: 'cm_idem_test_1',
  body: 'hello',
  type: 'TEXT',
};

describe('ConversationsService.sendMessage — idempotency (Gate 7)', () => {
  it('a sequential duplicate (same clientMessageId sent twice) creates exactly one row and the second call returns deduped:true with the same message', async () => {
    const { prisma, rowCount, createCallCount } = buildPrisma({
      conversation: { id: 'conv-1', userId: 'user-1' },
    });
    const service = new ConversationsService(prisma);

    const first = await service.sendMessage(BASE_INPUT);
    expect(first.deduped).toBe(false);
    expect(rowCount()).toBe(1);
    expect(createCallCount()).toBe(1);

    const second = await service.sendMessage(BASE_INPUT);
    expect(second.deduped).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.clientMessageId).toBe(BASE_INPUT.clientMessageId);

    // No second database row and no second insert attempt — the fast-path
    // idempotency lookup short-circuited before ever calling create().
    expect(rowCount()).toBe(1);
    expect(createCallCount()).toBe(1);
  });

  it('a true-concurrent duplicate (unique-constraint race on insert) still converges to exactly one row — the loser returns the winner as deduped, no exception propagates', async () => {
    const { prisma, rowCount, createCallCount } = buildPrisma({
      conversation: { id: 'conv-1', userId: 'user-1' },
      raceOnCreate: true,
    });
    const service = new ConversationsService(prisma);

    // Simulates two requests that both passed the fast-path check (neither
    // saw the other's row yet) and both attempted create(); the mock's
    // FIRST create() call throws P2002 exactly as Postgres would.
    const result = await service.sendMessage(BASE_INPUT);

    expect(result.deduped).toBe(true); // the race loser recovers via the catch path, does not throw
    expect(rowCount()).toBe(1); // exactly one row exists — the winner's
    expect(createCallCount()).toBe(1); // only the winning insert actually happened
  });

  it('an attachment (media message) is never created twice across a sequential duplicate retry', async () => {
    const { prisma, attachmentCreateCallCount } = buildPrisma({
      conversation: { id: 'conv-1', userId: 'user-1' },
    });
    const service = new ConversationsService(prisma);
    const mediaInput = {
      ...BASE_INPUT,
      clientMessageId: 'cm_idem_media_1',
      type: 'IMAGE',
      body: undefined,
      attachment: {
        fileKey: 'k1',
        fileUrl: 'https://example.test/k1',
        fileName: 'photo.png',
        mimeType: 'image/png',
        fileSize: 1234,
        duration: null,
      },
    };

    const first = await service.sendMessage(mediaInput);
    expect(first.deduped).toBe(false);
    expect(attachmentCreateCallCount()).toBe(1);

    const second = await service.sendMessage(mediaInput); // retry with the SAME clientMessageId + cached upload
    expect(second.deduped).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(attachmentCreateCallCount()).toBe(1); // no duplicate attachment relation created
  });
});
