import { describe, it, expect, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { MessageType } from '@karamooziyar/shared';
import { TestChatServer, waitUntil } from './real-chat-server';

/**
 * Harness self-tests (stabilization pass, Task 1).
 *
 * These test the TEST HARNESS itself (real-chat-server.ts), not production
 * code — they exist because `resetBookkeeping()` previously cleared
 * `connections` unconditionally, which could (a) hide a server-side
 * connection the server still considered live, and (b) let a fresh
 * connection reuse a connIndex that a still-live connection also held. The
 * harness now exposes `resetScenarioState()` (never touches connection
 * history) and `disconnectAllAndResetConnections()` (the only safe, explicit
 * way to clear connection history — force-closes every tracked connection
 * and WAITS for the real close before clearing). These tests pin down that
 * contract so a future edit to the harness cannot silently regress it.
 */

function connectClient(port: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s: ClientSocket = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      reconnection: false,
      forceNew: true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function send(client: ClientSocket, clientMessageId: string, body: string) {
  return new Promise<{ ok: boolean; clientMessageId: string }>((resolve) => {
    client.emit(
      'chat:send',
      { clientMessageId, conversationId: 'harness-conv', type: MessageType.TEXT, body },
      resolve,
    );
  });
}

describe('TestChatServer harness — connection bookkeeping correctness', () => {
  let server: TestChatServer | undefined;
  const openClients: ClientSocket[] = [];

  afterEach(async () => {
    for (const c of openClients.splice(0)) {
      if (c.connected) c.disconnect();
    }
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  it('after a real client connects, liveConnectionCount() is 1', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    openClients.push(c1);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'server records the connection');
    expect(server.liveConnectionCount()).toBe(1);
  });

  it('resetScenarioState() does not make a live connection disappear', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    openClients.push(c1);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'connection recorded');

    server.resetScenarioState();

    expect(server.liveConnectionCount()).toBe(1);
    expect(server.connections).toHaveLength(1);
  });

  it('a connection keeps a stable, unique connIndex across a scenario reset', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    openClients.push(c1);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'connection recorded');

    const ack1 = await send(c1, 'm1', 'hi');
    expect(server.received[0]!.connIndex).toBe(0);
    expect(ack1.ok).toBe(true);

    server.resetScenarioState(); // clears `received`, must NOT touch `connections`

    const ack2 = await send(c1, 'm2', 'hi again');
    expect(server.connections).toHaveLength(1); // same physical connection still tracked
    expect(server.received[0]!.connIndex).toBe(0); // same index — no reuse/collision
    expect(ack2.ok).toBe(true);
  });

  it('after a real disconnect, liveConnectionCount() becomes 0 while connection history is preserved', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'connection recorded');

    c1.disconnect();
    await waitUntil(() => server.liveConnectionCount() === 0, 2_000, 'server sees the disconnect');

    expect(server.connections).toHaveLength(1); // history preserved, never silently hidden
  });

  it('a second connection receives a newer, non-reused connIndex', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'first connection recorded');
    c1.disconnect();
    await waitUntil(() => server.liveConnectionCount() === 0, 2_000, 'first connection closed');

    const c2 = await connectClient(server.port);
    openClients.push(c2);
    await waitUntil(() => server!.connections.length === 2, 2_000, 'second connection recorded');
    expect(server.connections[1]).not.toBe(server.connections[0]);

    const ack = await send(c2, 'm3', 'hi');
    expect(server.received[server.received.length - 1]!.connIndex).toBe(1);
    expect(ack.ok).toBe(true);
  });

  it('alwaysSwallowClientMessageId swallows every attempt for that clientMessageId, regardless of physical connection index', async () => {
    server = await TestChatServer.start();
    server.alwaysSwallowClientMessageId.add('never-ack-me');
    const c1 = await connectClient(server.port);
    openClients.push(c1);

    let ack1Received = false;
    let ack2Received = false;
    void send(c1, 'never-ack-me', 'x').then(() => {
      ack1Received = true;
    });
    void send(c1, 'never-ack-me', 'x again').then(() => {
      ack2Received = true;
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(ack1Received).toBe(false);
    expect(ack2Received).toBe(false);
    expect(server.received.filter((r) => r.payload.clientMessageId === 'never-ack-me')).toHaveLength(2);
  });

  it('zombieOnceByClientMessageId swallows exactly once then allows the retry to ack', async () => {
    server = await TestChatServer.start();
    server.zombieOnceByClientMessageId.add('zombie-once');
    const c1 = await connectClient(server.port);
    openClients.push(c1);

    let ack1Received = false;
    void send(c1, 'zombie-once', 'x').then(() => {
      ack1Received = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(ack1Received).toBe(false);
    expect(server.zombieOnceByClientMessageId.has('zombie-once')).toBe(false); // self-cleared after the one swallow

    const ack2 = await send(c1, 'zombie-once', 'retry');
    expect(ack2.ok).toBe(true);
  });

  it('documents deterministic precedence if a clientMessageId were ever in both swallow sets (alwaysSwallow wins, zombieOnce untouched)', async () => {
    server = await TestChatServer.start();
    // Normal usage never puts the same cid in both sets — this test exists
    // only to pin down that the server checks alwaysSwallow BEFORE
    // zombieOnce, so there is no ambiguity if it ever happened.
    server.alwaysSwallowClientMessageId.add('both-sets');
    server.zombieOnceByClientMessageId.add('both-sets');
    const c1 = await connectClient(server.port);
    openClients.push(c1);

    let acked = false;
    void send(c1, 'both-sets', 'x').then(() => {
      acked = true;
    });
    await new Promise((r) => setTimeout(r, 150));

    expect(acked).toBe(false);
    // zombieOnce entry was never consulted/cleared — proves alwaysSwallow's
    // early return ran first.
    expect(server.zombieOnceByClientMessageId.has('both-sets')).toBe(true);
  });

  it('disconnectAllAndResetConnections() only clears history after the real server-side close, and the next connIndex starts fresh at 0', async () => {
    server = await TestChatServer.start();
    const c1 = await connectClient(server.port);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'connection recorded');

    // Deliberately do NOT disconnect the client first — the safe teardown
    // method must force-close it itself and wait for the real close.
    await server.disconnectAllAndResetConnections();
    expect(server.connections).toHaveLength(0);
    expect(server.liveConnectionCount()).toBe(0);

    const c2 = await connectClient(server.port);
    openClients.push(c2);
    await waitUntil(() => server!.connections.length === 1, 2_000, 'next connection recorded fresh');

    const ack = await send(c2, 'after-reset', 'x');
    expect(server.received[0]!.connIndex).toBe(0); // legitimately reset, not colliding with a hidden live one
    expect(ack.ok).toBe(true);
  });
});
