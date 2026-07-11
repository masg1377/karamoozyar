import { Logger } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { validateDiagnosticsBatch, DIAG_MAX_EVENTS_PER_BATCH } from './client-diagnostics.util';

/**
 * Guards the diagnostics channel contract: strictly allowlisted payloads,
 * authenticated only, rate-limited, logged (never persisted), and structurally
 * incapable of carrying message content / file names / tokens / phone numbers.
 */

function lifecycleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 1,
    ts: Date.now(),
    kind: 'lifecycle',
    event: 'socket_disconnect',
    reason: 'transport close',
    pageInstanceId: 'pi_abc123',
    browserSessionId: 'bs_abc123',
    socketId: 'sock_1',
    connected: false,
    active: true,
    reconnecting: true,
    readyState: 'closed',
    transport: 'websocket',
    visibility: 'visible',
    online: true,
    path: '/admin/conversations/c1',
    ...overrides,
  };
}

function chatSendEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 2,
    ts: Date.now(),
    kind: 'chat_send',
    phase: 'send-emitted',
    sendOrigin: 'new-message',
    clientMessageId: 'cm_abcdefgh',
    conversationId: 'conv-1',
    deliveryState: 'sending',
    attempt: 1,
    pageInstanceId: 'pi_abc123',
    browserSessionId: 'bs_abc123',
    ...overrides,
  };
}

function batch(events: Record<string, unknown>[]): Record<string, unknown> {
  return { pageInstanceId: 'pi_abc123', browserSessionId: 'bs_abc123', events };
}

describe('validateDiagnosticsBatch', () => {
  it('accepts a valid mixed batch', () => {
    const res = validateDiagnosticsBatch(batch([lifecycleEvent(), chatSendEvent()]));
    expect(res.ok).toBe(true);
  });

  it('rejects malformed payloads (non-object, missing ids, empty/overfull events)', () => {
    expect(validateDiagnosticsBatch(null).ok).toBe(false);
    expect(validateDiagnosticsBatch('x').ok).toBe(false);
    expect(validateDiagnosticsBatch({ events: [lifecycleEvent()] }).ok).toBe(false); // no ids
    expect(validateDiagnosticsBatch(batch([])).ok).toBe(false);
    const tooMany = Array.from({ length: DIAG_MAX_EVENTS_PER_BATCH + 1 }, () => lifecycleEvent());
    expect(validateDiagnosticsBatch(batch(tooMany)).ok).toBe(false);
  });

  it('rejects unknown enum values (lifecycle name, phase, sendOrigin, kind)', () => {
    expect(validateDiagnosticsBatch(batch([lifecycleEvent({ event: 'evil_event' })])).ok).toBe(false);
    expect(validateDiagnosticsBatch(batch([chatSendEvent({ phase: 'exfiltrate' })])).ok).toBe(false);
    expect(validateDiagnosticsBatch(batch([chatSendEvent({ sendOrigin: 'hacker' })])).ok).toBe(false);
    expect(validateDiagnosticsBatch(batch([lifecycleEvent({ kind: 'other' })])).ok).toBe(false);
  });

  it('rejects any event carrying content-like or sensitive keys', () => {
    for (const key of ['body', 'text', 'fileName', 'fileUrl', 'url', 'token', 'phone', 'firstName']) {
      const res = validateDiagnosticsBatch(batch([lifecycleEvent({ [key]: 'leak' })]));
      expect(res.ok).toBe(false);
    }
    // Unknown top-level batch keys are rejected too.
    expect(
      validateDiagnosticsBatch({ ...batch([lifecycleEvent()]), body: 'leak' }).ok,
    ).toBe(false);
  });

  it('rejects wrong field types and over-long strings', () => {
    expect(validateDiagnosticsBatch(batch([lifecycleEvent({ connected: 'yes' })])).ok).toBe(false);
    expect(validateDiagnosticsBatch(batch([lifecycleEvent({ ts: 'now' })])).ok).toBe(false);
    expect(
      validateDiagnosticsBatch(batch([lifecycleEvent({ reason: 'x'.repeat(200) })])).ok,
    ).toBe(false);
  });
});

describe('ChatGateway.handleClientDiagnostics', () => {
  const makeGateway = () =>
    new ChatGateway(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { registerSocketEmitter: jest.fn() } as never,
    );

  const makeClient = (user?: { sub: string; nationalId: string; role: 'ADMIN' | 'USER' }) =>
    ({ id: 'sock_1', user, data: {} }) as never;

  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects unauthenticated diagnostics', () => {
    const gw = makeGateway();
    const res = gw.handleClientDiagnostics(makeClient(undefined), batch([lifecycleEvent()]));
    expect(res).toEqual({ ok: false, error: 'unauthenticated' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload and logs nothing sensitive', () => {
    const gw = makeGateway();
    const client = makeClient({ sub: 'u1', nationalId: 'x', role: 'ADMIN' });
    const res = gw.handleClientDiagnostics(client, batch([lifecycleEvent({ body: 'secret' })]));
    expect(res.ok).toBe(false);
    expect(logSpy).not.toHaveBeenCalled(); // rejected batches never reach the batch log
  });

  it('accepts a valid batch and logs one structured JSON line with identity + events', () => {
    const gw = makeGateway();
    const client = makeClient({ sub: 'u1', nationalId: 'x', role: 'ADMIN' });
    const res = gw.handleClientDiagnostics(client, batch([lifecycleEvent(), chatSendEvent()]));
    expect(res).toEqual({ ok: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      evt: 'client_diag_batch',
      userId: 'u1',
      role: 'ADMIN',
      socketId: 'sock_1',
      pageInstanceId: 'pi_abc123',
      browserSessionId: 'bs_abc123',
      count: 2,
    });
    expect(logged.events).toHaveLength(2);
    expect(logged.events[1]).toMatchObject({ phase: 'send-emitted', sendOrigin: 'new-message' });
  });

  it('rate-limits to one batch per socket per 10 seconds (client retains + retries)', () => {
    const gw = makeGateway();
    const client = makeClient({ sub: 'u1', nationalId: 'x', role: 'ADMIN' });
    expect(gw.handleClientDiagnostics(client, batch([lifecycleEvent()])).ok).toBe(true);
    expect(gw.handleClientDiagnostics(client, batch([lifecycleEvent()]))).toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });

  it('stores pageInstanceId/browserSessionId on the socket for the disconnect log', () => {
    const gw = makeGateway();
    const client = makeClient({ sub: 'u1', nationalId: 'x', role: 'ADMIN' });
    gw.handleClientDiagnostics(client, batch([lifecycleEvent()]));
    const data = (client as unknown as { data: Record<string, unknown> }).data;
    expect(data['pageInstanceId']).toBe('pi_abc123');
    expect(data['browserSessionId']).toBe('bs_abc123');
  });
});
