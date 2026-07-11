import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Live file logging (File System Access API) contract:
 *   - unsupported browsers fall back silently to IndexedDB-only,
 *   - revoked/denied permission falls back safely (and never re-prompts),
 *   - written lines contain only sanitized allowlisted fields,
 *   - a write failure stops live logging and records ONE safe local error,
 *   - none of it ever throws into the caller.
 *
 * socket-diagnostics + diagnostics-store + diagnostics-live-log are imported
 * as one live module graph (dynamic import after global stubs).
 */

// Real browsers structured-clone FileSystemFileHandle into IndexedDB; fake
// handles built from vi.fn() cannot be cloned, so the meta accessors are
// replaced with an in-memory map. Event persistence stays on the real
// (fake-indexeddb) implementation.
const { metaMap } = vi.hoisted(() => ({ metaMap: new Map<string, unknown>() }));
vi.mock('./diagnostics-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./diagnostics-store')>();
  return {
    ...orig,
    getDiagMeta: async (key: string) => metaMap.get(key) ?? null,
    setDiagMeta: async (key: string, value: unknown) => {
      metaMap.set(key, value);
      return true;
    },
    deleteDiagMeta: async (key: string) => {
      metaMap.delete(key);
    },
  };
});

const ALLOWED_KEYS = new Set([
  'seq', 'ts', 'kind', 'pageInstanceId', 'browserSessionId',
  'event', 'phase', 'sendOrigin', 'clientMessageId', 'conversationId',
  'deliveryState', 'attempt', 'reason',
  'socketId', 'connected', 'active', 'reconnecting', 'readyState',
  'transport', 'visibility', 'online', 'path',
  'diagnosticEventId',
]);

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

interface FakeWindow {
  sessionStorage: Storage;
  addEventListener: ReturnType<typeof vi.fn>;
  showSaveFilePicker?: (opts?: unknown) => Promise<unknown>;
}

let fakeWindow: FakeWindow;
let diag: typeof import('./socket-diagnostics');
let store: typeof import('./diagnostics-store');
let live: typeof import('./diagnostics-live-log');

function makeHandle(opts: {
  permission?: PermissionState;
  requestResult?: PermissionState;
  failWrites?: boolean;
}) {
  const written: string[] = [];
  const handle = {
    written,
    size: 0,
    getFile: vi.fn(async () => ({ size: handle.size })),
    createWritable: vi.fn(async () => {
      if (opts.failWrites) throw new Error('NotAllowedError');
      return {
        seek: vi.fn(async () => undefined),
        write: vi.fn(async (data: string) => {
          written.push(data);
          handle.size += data.length;
        }),
        close: vi.fn(async () => undefined),
      };
    }),
    queryPermission: vi.fn(async () => opts.permission ?? 'granted'),
    requestPermission: vi.fn(async () => opts.requestResult ?? opts.permission ?? 'granted'),
  };
  return handle;
}

beforeEach(async () => {
  vi.resetModules();
  fakeWindow = { sessionStorage: makeStorage(), addEventListener: vi.fn() };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { pathname: '/admin/profile' });

  diag = await import('./socket-diagnostics');
  store = await import('./diagnostics-store');
  live = await import('./diagnostics-live-log');
  diag.__resetDiagnosticsForTests();
  live.__resetLiveLogForTests();
  await store.__resetDiagnosticsDbForTests();
  metaMap.clear();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  live.__resetLiveLogForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bufferEvents() {
  return diag.__getDiagnosticsBufferForTests();
}

describe('unsupported File System Access API', () => {
  it('falls back to IndexedDB-only and records exactly one safe local_diag_error', async () => {
    // no showSaveFilePicker on window
    const result = await live.startLiveFileLog();
    expect(result).toBe('unsupported');
    expect((await live.getLiveLogStatus()).active).toBe(false);

    const errors = bufferEvents().filter((e) => e.event === 'local_diag_error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toBe('fs-api-unsupported');

    // A second attempt does not spam another error event.
    await live.startLiveFileLog();
    expect(bufferEvents().filter((e) => e.event === 'local_diag_error')).toHaveLength(1);

    // IndexedDB persistence keeps working as the authoritative store.
    diag.lifecycle('socket_disconnect', 'transport close');
    await new Promise((r) => setTimeout(r, 50));
    const persisted = await store.readAllDiagEvents();
    expect(persisted.some((e) => e.event === 'socket_disconnect')).toBe(true);
  });
});

describe('revoked/denied permission', () => {
  it('never auto-resumes without granted permission (verify-only, no prompt)', async () => {
    const handle = makeHandle({ permission: 'prompt' });
    await store.setDiagMeta('liveLogHandle', handle);

    const resumed = await live.resumeLiveLogIfPermitted();
    expect(resumed).toBe(false);
    expect(handle.requestPermission).not.toHaveBeenCalled(); // NEVER prompts automatically
    expect((await live.getLiveLogStatus()).active).toBe(false);
  });

  it('explicit start with a denied stored handle falls back safely and forgets the handle', async () => {
    const handle = makeHandle({ permission: 'prompt', requestResult: 'denied' });
    await store.setDiagMeta('liveLogHandle', handle);
    // User cancels the fallback picker.
    fakeWindow.showSaveFilePicker = vi.fn(async () => {
      const err = new Error('user cancelled');
      err.name = 'AbortError';
      throw err;
    });

    const result = await live.startLiveFileLog();
    expect(result).toBe('cancelled');
    expect(await store.getDiagMeta('liveLogHandle')).toBeNull(); // revoked handle forgotten
    const errors = bufferEvents().filter((e) => e.event === 'local_diag_error');
    expect(errors.map((e) => e.reason)).toEqual(['fs-permission-denied']);
    expect((await live.getLiveLogStatus()).active).toBe(false);
  });
});

describe('live file writing', () => {
  it('appends sanitized JSONL lines only — allowlisted fields, no sensitive keys', async () => {
    const handle = makeHandle({});
    fakeWindow.showSaveFilePicker = vi.fn(async () => handle);

    expect(await live.startLiveFileLog()).toBe('started');
    diag.lifecycle('socket_disconnect', 'ping timeout');
    diag.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'auto-reconnect-retry',
      phase: 'auto-retry-start',
      attempt: 1,
    });
    await live.__flushLiveLogForTests();

    expect(handle.written).toHaveLength(1);
    const lines = handle.written[0]!.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(obj)) expect(ALLOWED_KEYS.has(key)).toBe(true);
      for (const bad of ['body', 'fileName', 'fileUrl', 'token', 'phone', 'firstName']) {
        expect(bad in obj).toBe(false);
      }
    }
    expect(JSON.parse(lines[1]!)).toMatchObject({
      phase: 'auto-retry-start',
      sendOrigin: 'auto-reconnect-retry',
    });
  });

  it('a write failure stops live logging, records one safe error, and IndexedDB keeps working', async () => {
    const handle = makeHandle({ failWrites: true });
    fakeWindow.showSaveFilePicker = vi.fn(async () => handle);

    expect(await live.startLiveFileLog()).toBe('started');
    diag.lifecycle('socket_disconnect', 'transport close');
    await live.__flushLiveLogForTests(); // write throws internally

    expect((await live.getLiveLogStatus()).active).toBe(false); // silent stop
    const errors = bufferEvents().filter((e) => e.event === 'local_diag_error');
    expect(errors.map((e) => e.reason)).toEqual(['fs-write-failed']);

    // Chat-path recording still works and still persists locally.
    expect(() => diag.lifecycle('reconnect_attempt', 'attempt-1')).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    const persisted = await store.readAllDiagEvents();
    expect(persisted.some((e) => e.event === 'reconnect_attempt')).toBe(true);
  });
});
