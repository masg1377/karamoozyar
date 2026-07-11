/**
 * Persistent local storage for the chat/socket diagnostics system.
 *
 * A diagnostics-ONLY IndexedDB database (`karamooz-diagnostics`). It shares
 * nothing with chat messages, auth, or any other app storage, so clearing it
 * can never touch anything else. It stores exactly the sanitized DiagEvent
 * fields produced by socket-diagnostics.ts plus two local bookkeeping fields
 * (`diagnosticEventId`, `serverReceived`) — never message content, file
 * names, URLs, tokens, phone numbers, or profile data (those are structurally
 * absent from DiagEvent in the first place).
 *
 * Hard guarantees (mirrors socket-diagnostics.ts):
 *   - No function here ever throws or rejects into a caller: every public
 *     API resolves normally even when IndexedDB is unavailable/broken.
 *   - Everything is async and off the chat-send critical path.
 *   - Writes use `add()` keyed on a deterministic `diagnosticEventId`
 *     (pageInstanceId + seq), so a re-persisted/retried event is a silent
 *     no-op: no duplicates and an existing `serverReceived: true` flag is
 *     never regressed.
 *   - Multiple tabs each have a unique pageInstanceId → key collisions are
 *     impossible and concurrent transactions are serialized by IndexedDB.
 */

import type { DiagEvent } from './socket-diagnostics';

export const DIAG_DB_NAME = 'karamooz-diagnostics';
export const DIAG_DB_VERSION = 1;
export const DIAG_EVENTS_STORE = 'events';
export const DIAG_META_STORE = 'meta'; // live-log file handle only — NOT cleared by clearDiagnosticsEvents

export const DIAG_RETENTION_MAX_EVENTS = 2_000;
export const DIAG_RETENTION_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h
/** Prune at most this often; keeps pruning bounded + amortized. */
export const DIAG_PRUNE_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** One locally persisted diagnostics record. */
export interface StoredDiagEvent extends DiagEvent {
  /** Stable id derived from fields the event already carries — identical on
   *  every retry/re-persist of the same event. Never sent to the server. */
  diagnosticEventId: string;
  /** True once the server acked the telemetry batch containing this event. */
  serverReceived: boolean;
  /** Set when the server ack that covered this event arrived. */
  serverReceivedAt?: number;
}

/** Deterministic — MUST stay derivable from the wire event (no randomness). */
export function diagnosticEventIdOf(evt: Pick<DiagEvent, 'pageInstanceId' | 'seq'>): string {
  return `${evt.pageInstanceId}:${evt.seq}`;
}

// ─── DB open (lazy, cached, failure-tolerant) ──────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function idbFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB !== 'undefined') return indexedDB;
  } catch {
    /* blocked */
  }
  return null;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const factory = idbFactory();
      if (!factory) {
        resolve(null);
        return;
      }
      const req = factory.open(DIAG_DB_NAME, DIAG_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DIAG_EVENTS_STORE)) {
          const store = db.createObjectStore(DIAG_EVENTS_STORE, { keyPath: 'diagnosticEventId' });
          store.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains(DIAG_META_STORE)) {
          db.createObjectStore(DIAG_META_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades the schema later, release our connection.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Await a transaction's completion without ever rejecting. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ─── Persist (local-first, dedup by stable id) ─────────────────────────────────

/**
 * Persist sanitized events locally BEFORE any server delivery attempt.
 * `add()` + swallowed ConstraintError = idempotent: retried events are no-ops.
 * Resolves `false` only if the database itself was unusable.
 */
export async function persistDiagEvents(events: readonly DiagEvent[]): Promise<boolean> {
  try {
    if (events.length === 0) return true;
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(DIAG_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(DIAG_EVENTS_STORE);
    for (const evt of events) {
      const record: StoredDiagEvent = {
        ...stripUndefined(evt),
        diagnosticEventId: diagnosticEventIdOf(evt),
        serverReceived: false,
      };
      const req = store.add(record);
      // Already persisted (retry/restore) — keep the existing record + its
      // serverReceived flag. Must preventDefault so the tx doesn't abort.
      req.onerror = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
    }
    await txDone(tx);
    schedulePrune();
    return true;
  } catch {
    return false;
  }
}

/** IndexedDB structured clone rejects nothing here, but undefined properties
 *  waste space and make exports noisy — drop them. */
function stripUndefined(evt: DiagEvent): DiagEvent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(evt)) {
    if (v !== undefined) out[k] = v;
  }
  return out as unknown as DiagEvent;
}

/** Mark events as acknowledged by the server. Never deletes — records stay
 *  until normal retention pruning so an export shows the complete timeline. */
export async function markDiagEventsServerReceived(
  ids: readonly string[],
  receivedAt: number = Date.now(),
): Promise<void> {
  try {
    if (ids.length === 0) return;
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(DIAG_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(DIAG_EVENTS_STORE);
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result as StoredDiagEvent | undefined;
        if (rec && rec.serverReceived !== true) {
          rec.serverReceived = true;
          rec.serverReceivedAt = receivedAt;
          const putReq = store.put(rec);
          putReq.onerror = (e) => {
            e.preventDefault();
            e.stopPropagation();
          };
        }
      };
      getReq.onerror = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
    }
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

// ─── Read (export path) ────────────────────────────────────────────────────────

/** All retained events sorted by client timestamp (via the ts index). */
export async function readAllDiagEvents(): Promise<StoredDiagEvent[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const tx = db.transaction(DIAG_EVENTS_STORE, 'readonly');
    const index = tx.objectStore(DIAG_EVENTS_STORE).index('ts');
    return await new Promise<StoredDiagEvent[]>((resolve) => {
      const req = index.getAll();
      req.onsuccess = () => resolve((req.result as StoredDiagEvent[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Count of locally retained events not yet acknowledged by the server. */
export async function countUnacknowledged(): Promise<number> {
  const all = await readAllDiagEvents();
  return all.filter((e) => e.serverReceived !== true).length;
}

/**
 * Oldest-first (by ts) events not yet acknowledged by the server, capped at
 * `limit`. IndexedDB is the authoritative source of unsent diagnostics — the
 * startup recovery flush (diagnostics-recovery.ts) reads from here, never from
 * the in-memory or sessionStorage buffers.
 */
export async function readUnsentDiagEvents(limit: number): Promise<StoredDiagEvent[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const tx = db.transaction(DIAG_EVENTS_STORE, 'readonly');
    const index = tx.objectStore(DIAG_EVENTS_STORE).index('ts');
    return await new Promise<StoredDiagEvent[]>((resolve) => {
      const out: StoredDiagEvent[] = [];
      const cursorReq = index.openCursor(); // ascending ts → oldest first
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        const rec = cursor.value as StoredDiagEvent;
        if (rec.serverReceived !== true) out.push(rec);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}

// ─── Clear (events only) ───────────────────────────────────────────────────────

/**
 * Clears ONLY the diagnostics events store. Chat messages, outbox state,
 * auth, the live-log handle, and every other database are untouched.
 */
export async function clearDiagnosticsEvents(): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(DIAG_EVENTS_STORE, 'readwrite');
    tx.objectStore(DIAG_EVENTS_STORE).clear();
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

// ─── Retention pruning (bounded, throttled, async) ─────────────────────────────

let lastPruneAt = 0;
let pruneScheduled = false;

/** Throttled prune trigger — called after persists, never awaited by callers. */
export function schedulePrune(): void {
  try {
    if (pruneScheduled) return;
    if (Date.now() - lastPruneAt < DIAG_PRUNE_MIN_INTERVAL_MS) return;
    pruneScheduled = true;
    setTimeout(() => {
      pruneScheduled = false;
      lastPruneAt = Date.now();
      void pruneDiagEvents();
    }, 1_000);
  } catch {
    /* never throw */
  }
}

/**
 * Enforce retention: drop events older than 48h, then drop oldest beyond the
 * 2,000-event cap. Cursor-based and bounded by the store size; runs entirely
 * in its own async transactions.
 */
export async function pruneDiagEvents(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;

    // Pass 1: age limit — delete everything with ts < cutoff via the index.
    const cutoff = Date.now() - DIAG_RETENTION_MAX_AGE_MS;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DIAG_EVENTS_STORE, 'readwrite');
      const index = tx.objectStore(DIAG_EVENTS_STORE).index('ts');
      const range = IDBKeyRange.upperBound(cutoff, true);
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      cursorReq.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    });

    // Pass 2: count cap — delete oldest (by ts) beyond the max.
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(DIAG_EVENTS_STORE, 'readonly');
      const req = tx.objectStore(DIAG_EVENTS_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    let toDelete = count - DIAG_RETENTION_MAX_EVENTS;
    if (toDelete <= 0) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(DIAG_EVENTS_STORE, 'readwrite');
      const index = tx.objectStore(DIAG_EVENTS_STORE).index('ts');
      const cursorReq = index.openCursor(); // ascending ts → oldest first
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && toDelete > 0) {
          toDelete -= 1;
          cursor.delete();
          cursor.continue();
        }
      };
      cursorReq.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

// ─── Meta store (live-log file handle only) ────────────────────────────────────

export async function getDiagMeta<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const tx = db.transaction(DIAG_META_STORE, 'readonly');
    return await new Promise<T | null>((resolve) => {
      const req = tx.objectStore(DIAG_META_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setDiagMeta(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(DIAG_META_STORE, 'readwrite');
    tx.objectStore(DIAG_META_STORE).put(value, key);
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

export async function deleteDiagMeta(key: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(DIAG_META_STORE, 'readwrite');
    tx.objectStore(DIAG_META_STORE).delete(key);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

// ─── Test-only ─────────────────────────────────────────────────────────────────

/** Test-only: close + delete the whole diagnostics DB and reset module state. */
export async function __resetDiagnosticsDbForTests(): Promise<void> {
  try {
    const db = await (dbPromise ?? Promise.resolve(null));
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    dbPromise = null;
    lastPruneAt = 0;
    pruneScheduled = false;
    const factory = idbFactory();
    if (!factory) return;
    await new Promise<void>((resolve) => {
      const req = factory.deleteDatabase(DIAG_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {
    /* ignore */
  }
}
