/**
 * Offline export + human-readable summary for locally retained diagnostics.
 *
 * Reads ONLY the diagnostics IndexedDB store (already sanitized at record
 * time — see socket-diagnostics.ts / diagnostics-store.ts) and produces:
 *   - a UTF-8 JSONL file (one JSON object per line, metadata line first),
 *     generated entirely client-side so it works with no network, no DNS,
 *     no VPN, and no server;
 *   - a short Persian summary string for clipboard copy.
 *
 * Nothing here touches chat sending, the outbox, or server telemetry.
 */

import {
  readAllDiagEvents,
  type StoredDiagEvent,
} from './diagnostics-store';
import { pageInstanceId, getBrowserSessionId } from './socket-diagnostics';

// ─── Shared helpers ────────────────────────────────────────────────────────────

export function diagFileTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Best-effort build identifier from the deploy's version.json. Export must
 *  work offline, so any failure just yields 'unknown'. */
async function appVersion(): Promise<string> {
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { v?: string };
    return typeof data.v === 'string' ? data.v : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─── JSONL export ──────────────────────────────────────────────────────────────

export interface DiagExportMeta {
  type: 'meta';
  exportedAt: string;
  appVersion: string;
  pageInstanceId: string;
  browserSessionId: string;
  eventCount: number;
  earliestTs: number | null;
  latestTs: number | null;
}

/** Pure: build the JSONL text (metadata line + one line per event, sorted by
 *  client timestamp). Exported separately so tests can inspect the content. */
export function buildDiagnosticsJsonl(
  events: readonly StoredDiagEvent[],
  meta: Omit<DiagExportMeta, 'type' | 'eventCount' | 'earliestTs' | 'latestTs'>,
): string {
  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const metaLine: DiagExportMeta = {
    type: 'meta',
    ...meta,
    eventCount: sorted.length,
    earliestTs: sorted.length > 0 ? sorted[0]!.ts : null,
    latestTs: sorted.length > 0 ? sorted[sorted.length - 1]!.ts : null,
  };
  const lines = [JSON.stringify(metaLine), ...sorted.map((e) => JSON.stringify(e))];
  return `${lines.join('\n')}\n`;
}

/**
 * Read all retained events and download them as
 * `karamooz-chat-diagnostics-YYYYMMDD-HHmmss.jsonl`. Fully client-side.
 * Returns the exported event count, or null on failure (UI shows the error).
 */
export async function exportDiagnosticsJsonl(): Promise<number | null> {
  try {
    const events = await readAllDiagEvents();
    const jsonl = buildDiagnosticsJsonl(events, {
      exportedAt: new Date().toISOString(),
      appVersion: await appVersion(),
      pageInstanceId,
      browserSessionId: getBrowserSessionId(),
    });
    const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `karamooz-chat-diagnostics-${diagFileTimestamp()}.jsonl`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Delay revoke so the click's navigation grabs the blob first.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return events.length;
  } catch {
    return null;
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────────

export interface DiagSummary {
  socketDisconnects: number;
  disconnectReasons: Record<string, number>;
  reconnectAttempts: number;
  reconnectSuccesses: number;
  reconnectFailures: number;
  pageInstanceChanges: number;
  browserOffline: number;
  browserOnline: number;
  newMessageSends: number;
  manualRetries: number;
  autoReconnectRetries: number;
  ackTimeouts: number;
  serverRejections: number;
  forceFailed: number;
  notServerReceived: number;
  eventCount: number;
}

/** Pure aggregation over stored events — no message/attachment data exists in
 *  the input, so none can appear in the output. */
export function summarizeDiagEvents(events: readonly StoredDiagEvent[]): DiagSummary {
  const s: DiagSummary = {
    socketDisconnects: 0,
    disconnectReasons: {},
    reconnectAttempts: 0,
    reconnectSuccesses: 0,
    reconnectFailures: 0,
    pageInstanceChanges: 0,
    browserOffline: 0,
    browserOnline: 0,
    newMessageSends: 0,
    manualRetries: 0,
    autoReconnectRetries: 0,
    ackTimeouts: 0,
    serverRejections: 0,
    forceFailed: 0,
    notServerReceived: 0,
    eventCount: events.length,
  };
  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  let lastPid: string | null = null;
  for (const e of sorted) {
    if (e.serverReceived !== true) s.notServerReceived += 1;
    if (lastPid !== null && e.pageInstanceId !== lastPid) s.pageInstanceChanges += 1;
    lastPid = e.pageInstanceId;

    if (e.kind === 'lifecycle') {
      switch (e.event) {
        case 'socket_disconnect': {
          s.socketDisconnects += 1;
          const reason = e.reason ?? 'unknown';
          s.disconnectReasons[reason] = (s.disconnectReasons[reason] ?? 0) + 1;
          break;
        }
        case 'reconnect_attempt':
          s.reconnectAttempts += 1;
          break;
        case 'reconnect_success':
          s.reconnectSuccesses += 1;
          break;
        case 'reconnect_failed':
          s.reconnectFailures += 1;
          break;
        case 'browser_offline':
          s.browserOffline += 1;
          break;
        case 'browser_online':
          s.browserOnline += 1;
          break;
        default:
          break;
      }
    } else {
      switch (e.phase) {
        case 'optimistic-inserted':
          s.newMessageSends += 1;
          break;
        case 'manual-retry-start':
          s.manualRetries += 1;
          break;
        case 'auto-retry-start':
          s.autoReconnectRetries += 1;
          break;
        case 'ack-timeout':
          s.ackTimeouts += 1;
          break;
        case 'server-rejection':
          s.serverRejections += 1;
          break;
        case 'force-failed':
          s.forceFailed += 1;
          break;
        default:
          break;
      }
    }
  }
  return s;
}

/** Persian, human-readable clipboard summary. Counts and fixed reason codes
 *  only — never message or attachment data. */
export function formatDiagSummaryFa(s: DiagSummary, exportedAt: Date = new Date()): string {
  const reasons =
    Object.entries(s.disconnectReasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `    - ${reason}: ${count}`)
      .join('\n') || '    - (هیچ)';
  return [
    `خلاصه گزارش اتصال و ارسال پیام — ${exportedAt.toISOString()}`,
    `کل رویدادهای ثبت‌شده: ${s.eventCount}`,
    `قطع اتصال سوکت: ${s.socketDisconnects}`,
    `دلایل قطع اتصال:`,
    reasons,
    `تلاش اتصال مجدد: ${s.reconnectAttempts} | موفق: ${s.reconnectSuccesses} | ناموفق: ${s.reconnectFailures}`,
    `تغییر شناسه صفحه (رفرش/بوت جدید): ${s.pageInstanceChanges}`,
    `آفلاین‌شدن مرورگر: ${s.browserOffline} | آنلاین‌شدن: ${s.browserOnline}`,
    `ارسال پیام جدید: ${s.newMessageSends}`,
    `تلاش مجدد دستی: ${s.manualRetries}`,
    `ارسال خودکار پس از اتصال مجدد: ${s.autoReconnectRetries}`,
    `مهلت تمام‌شده تایید سرور (ack timeout): ${s.ackTimeouts}`,
    `رد شدن توسط سرور: ${s.serverRejections}`,
    `شکست نهایی پس از سقف اتصال مجدد: ${s.forceFailed}`,
    `رویدادهای محلی بدون تایید دریافت سرور: ${s.notServerReceived}`,
  ].join('\n');
}

/** Read the local store and build the Persian summary (null on failure). */
export async function buildDiagnosticsSummaryFa(): Promise<string | null> {
  try {
    const events = await readAllDiagEvents();
    return formatDiagSummaryFa(summarizeDiagEvents(events));
  } catch {
    return null;
  }
}
