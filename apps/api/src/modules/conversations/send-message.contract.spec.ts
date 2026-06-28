import { SendMessageSchema } from '@karamooziyar/shared';

/**
 * Guards the idempotency contract: every send MUST carry a clientMessageId,
 * and a client-reported media duration is clamped to a sane range so a bogus
 * value can't poison the persisted attachment.
 */
describe('SendMessageSchema (idempotency + media contract)', () => {
  it('requires a clientMessageId of at least 8 chars', () => {
    expect(SendMessageSchema.safeParse({ body: 'hi' }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: 'hi', clientMessageId: 'short' }).success).toBe(false);
    expect(SendMessageSchema.safeParse({ body: 'hi', clientMessageId: 'cm_abcdefgh' }).success).toBe(true);
  });

  it('accepts a valid voice payload with duration', () => {
    const r = SendMessageSchema.safeParse({
      type: 'VOICE',
      fileKey: 'messages/c1/voice.webm',
      mimeType: 'audio/webm',
      fileSize: 1234,
      duration: 60,
      clientMessageId: 'cm_12345678',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an absurd duration (clamp upper bound)', () => {
    const r = SendMessageSchema.safeParse({
      type: 'VOICE',
      clientMessageId: 'cm_12345678',
      duration: 999999,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a negative file size', () => {
    const r = SendMessageSchema.safeParse({
      type: 'FILE',
      clientMessageId: 'cm_12345678',
      fileSize: -1,
    });
    expect(r.success).toBe(false);
  });
});
