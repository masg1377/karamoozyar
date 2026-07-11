/**
 * Optional live file logging of diagnostics events (desktop Chromium only).
 *
 * Uses the File System Access API to append sanitized diagnostic events to a
 * user-chosen .jsonl file. Strictly optional convenience: IndexedDB
 * (diagnostics-store.ts) remains the authoritative local store and keeps
 * recording regardless of what happens here.
 *
 * Rules enforced here:
 *   - `showSaveFilePicker()` only ever runs from an explicit user click.
 *   - The browser's own picker handles overwrite confirmation natively.
 *   - The handle is stored in the diagnostics DB meta store (Chromium can
 *     structured-clone handles) and reused; permission is verified before
 *     any reuse in a new session and NEVER re-prompted automatically —
 *     silent resume happens only when permission is already 'granted'.
 *   - Unsupported API / denied permission / write failure → silently fall
 *     back to IndexedDB-only, record ONE safe `local_diag_error` event, and
 *     never affect chat or server telemetry.
 */

import type { DiagEvent } from './socket-diagnostics';
import { setLiveLogSink, recordDiagInternalError } from './socket-diagnostics';
import {
  getDiagMeta,
  setDiagMeta,
  deleteDiagMeta,
  diagnosticEventIdOf,
} from './diagnostics-store';

const HANDLE_KEY = 'liveLogHandle';
const FLUSH_INTERVAL_MS = 3_000;
const MAX_QUEUE_LINES = 500;

// Minimal FS Access API typings (not in lib.dom for all TS targets).
interface FsWritable {
  write(data: string): Promise<void>;
  seek(position: number): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  getFile(): Promise<{ size: number }>;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<FsWritable>;
  queryPermission?(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'readwrite' }): Promise<PermissionState>;
}
type SaveFilePicker = (opts?: {
  suggestedName?: string;
  types?: { description?: string; accept?: Record<string, string[]> }[];
}) => Promise<FsFileHandle>;

export type LiveLogStartResult =
  | 'started'
  | 'unsupported'
  | 'cancelled'
  | 'permission-denied'
  | 'error';

export interface LiveLogStatus {
  supported: boolean;
  active: boolean;
  hasStoredHandle: boolean;
}

let activeHandle: FsFileHandle | null = null;
let queue: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let writing = false;

export function isLiveLogSupported(): boolean {
  try {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  } catch {
    return false;
  }
}

export async function getLiveLogStatus(): Promise<LiveLogStatus> {
  return {
    supported: isLiveLogSupported(),
    active: activeHandle !== null,
    hasStoredHandle: (await getDiagMeta<unknown>(HANDLE_KEY)) !== null,
  };
}

function enqueue(evt: DiagEvent): void {
  // Sanitized-by-construction: DiagEvent is the closed allowlisted shape.
  const line = `${JSON.stringify({ diagnosticEventId: diagnosticEventIdOf(evt), ...evt })}\n`;
  queue.push(line);
  if (queue.length > MAX_QUEUE_LINES) queue.splice(0, queue.length - MAX_QUEUE_LINES);
}

async function flushQueue(): Promise<void> {
  if (writing || !activeHandle || queue.length === 0) return;
  writing = true;
  const lines = queue;
  queue = [];
  try {
    const file = await activeHandle.getFile();
    const writable = await activeHandle.createWritable({ keepExistingData: true });
    await writable.seek(file.size); // append — never clobber earlier lines
    await writable.write(lines.join(''));
    await writable.close();
  } catch {
    // Write failed (revoked permission, file moved, disk error, …):
    // silent fallback to IndexedDB-only + one safe local diagnostic error.
    stopLiveFileLog();
    recordDiagInternalError('fs-write-failed');
  } finally {
    writing = false;
  }
}

function activate(handle: FsFileHandle): void {
  activeHandle = handle;
  setLiveLogSink(enqueue);
  if (flushTimer === null) flushTimer = setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
}

/**
 * Start live file logging. MUST be called from a user click (picker/permission
 * requirements). Reuses the stored handle when permitted, otherwise opens the
 * save-file picker.
 */
export async function startLiveFileLog(): Promise<LiveLogStartResult> {
  try {
    if (activeHandle) return 'started';
    if (!isLiveLogSupported()) {
      recordDiagInternalError('fs-api-unsupported');
      return 'unsupported';
    }

    // 1) Try the stored handle (explicit user action → requestPermission is OK).
    const stored = await getDiagMeta<FsFileHandle>(HANDLE_KEY);
    if (stored && typeof stored.createWritable === 'function') {
      try {
        let perm: PermissionState =
          (await stored.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
        if (perm === 'prompt') {
          perm = (await stored.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
        }
        if (perm === 'granted') {
          activate(stored);
          return 'started';
        }
        // Denied/revoked: forget the handle, fall through to a fresh picker.
        await deleteDiagMeta(HANDLE_KEY);
        recordDiagInternalError('fs-permission-denied');
      } catch {
        await deleteDiagMeta(HANDLE_KEY);
      }
    }

    // 2) Fresh picker (the browser confirms overwrites natively).
    let handle: FsFileHandle;
    try {
      const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker })
        .showSaveFilePicker;
      handle = await picker({
        suggestedName: `karamooz-chat-diagnostics-live.jsonl`,
        types: [{ description: 'JSON Lines', accept: { 'application/x-ndjson': ['.jsonl'] } }],
      });
    } catch (err) {
      if ((err as Error | undefined)?.name === 'AbortError') return 'cancelled';
      recordDiagInternalError('fs-picker-failed');
      return 'error';
    }

    // Persist the handle for later sessions (best-effort — Chromium only).
    void setDiagMeta(HANDLE_KEY, handle);
    activate(handle);
    return 'started';
  } catch {
    recordDiagInternalError('fs-start-failed');
    return 'error';
  }
}

/**
 * Silently resume in a new session ONLY if permission is still 'granted'.
 * Never prompts — if the browser would prompt, we stay stopped until the
 * ADMIN explicitly clicks start again.
 */
export async function resumeLiveLogIfPermitted(): Promise<boolean> {
  try {
    if (activeHandle || !isLiveLogSupported()) return activeHandle !== null;
    const stored = await getDiagMeta<FsFileHandle>(HANDLE_KEY);
    if (!stored || typeof stored.createWritable !== 'function') return false;
    const perm = (await stored.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
    if (perm !== 'granted') return false; // verify-only: no automatic prompt
    activate(stored);
    return true;
  } catch {
    return false;
  }
}

/** Stop live logging. The stored handle is kept for later reuse. */
export function stopLiveFileLog(): void {
  try {
    setLiveLogSink(null);
    activeHandle = null;
    queue = [];
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  } catch {
    /* never throw */
  }
}

/** Test-only: reset module state. */
export function __resetLiveLogForTests(): void {
  stopLiveFileLog();
  writing = false;
}

/** Test-only: run one queue flush immediately (production uses the interval). */
export async function __flushLiveLogForTests(): Promise<void> {
  await flushQueue();
}
