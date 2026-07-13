# "Message disappears after offline reconnect" — Regression Fix Report
**Date:** 2026-07-13

## 1. Confirmed root cause

`mergeServerMessages()` in `apps/web/src/lib/message-merge.ts` only protected **pending** local messages (`queued`/`uploading`/`sending`/`awaiting-connection`/`rebuilding-connection`/`retrying`/`failed`) from being wiped out by a freshly fetched REST history page that didn't happen to contain them. The instant a message was reconciled to `sent` by a real ACK, it lost that protection. `apps/web/src/hooks/useMessages.ts` refetches history (`loadInitial()`) on *every* socket `'connect'` event (line 96-99, `onReconnect`) and also whenever `useLiveSocket()`'s reactive `socket` value changes (it's in the effect's own dependency array, line 116) — both of which fire on exactly the offline→online transition the user described. If that refetch's REST response resolves (even slightly) after the real ACK already marked the message `sent`, but the response's own snapshot doesn't yet include that message, the merge silently dropped it — matching the report exactly: briefly visible as sent, then gone, fixed only by a refresh (a plain `loadInitial()` on mount, whose snapshot by then does include it).

## 2. Exact first mutation that removed the message

- **File:** `apps/web/src/lib/message-merge.ts`
- **Function:** `mergeServerMessages()`, line 130 (pre-fix): `return [...confirmedServer, ...preservedPending];`
- **Triggering event:** `useMessages.ts`'s `onReconnect` handler (or the effect's own re-run on socket replacement) calling `loadInitial()` → `chat.store.ts`'s `mergeMessages` action → `mergeServerMessages(local, server)`.
- **Old state (before mutation):** `[{ id: '<real-server-id>', clientMessageId: 'cm_xxx', deliveryState: 'sent', ... }]` — 1 item, durably confirmed.
- **New state (after mutation):** `[]` — 0 items. The message was excluded from `preservedPending` (its `deliveryState` is `'sent'`, not a pending state) **and** excluded from `confirmedServer` (the fetched page didn't contain it yet).
- Proven directly and deterministically by the new regression test `apps/web/src/hooks/__tests__/useMessages.reconnect-message-loss.test.tsx` before any fix (see §6).

## 3. Last-known-good/current diff that introduced it

Commit `641fa49` (the zombie-socket-recovery feature commit) changed `useMessages.ts`'s `const socket = getSocket();` (a plain, non-reactive call) to `const socket = useLiveSocket();` (a stateful hook), and added the `onReconnect` handler + put `socket` in the main effect's dependency array. Before that commit, socket replacement/reconnect never caused this effect to re-run or refire a history refetch, so this race did not exist. `message-merge.ts`'s pending-only preservation logic was also introduced in that same commit, already latently vulnerable to exactly this race — it just took a `sent`-state message to expose it, which requires the offline→reconnect→ACK ordering the user hit.

## 4. Exact production fix

In `apps/web/src/lib/message-merge.ts`, `mergeServerMessages()`: broadened preservation from "pending local messages absent from this page" to **"any local message absent from this page,"** regardless of delivery state. A REST page fetch is a snapshot, not an authoritative deletion signal — genuine removal is handled exclusively by the separate `CHAT_MESSAGE_DELETED` → `removeMessage()` path, which this change does not touch. `isPendingLocal()` itself is untouched and still exported/tested (it may still be used for pending-specific UI treatment); it is simply no longer the gate for this function's preservation logic.

Nothing in `useMessages.ts`, `outbox.ts`, or `socket-client.ts` was changed — the redundant reconnect-triggered refetch still happens exactly as before (deliberately not touched, since removing it would be a bigger architectural change than proven necessary; making the merge itself safe against a stale/racing snapshot is the minimal sufficient fix).

## 5. Exact changed files

- `apps/web/src/lib/message-merge.ts` — the fix (§4).
- `apps/web/src/hooks/__tests__/useMessages.reconnect-message-loss.test.tsx` — **new**, 2 tests (scenario A: exact reported bug end-to-end against a real Socket.IO server; scenario F: socket-replacement-only).
- `apps/web/src/lib/message-merge.regression-matrix.test.ts` — **new**, 12 tests (scenarios B, C, D, E, G ×3, I ×2, J).

No other file was modified as part of this fix. (`apps/web/.../chat/page.tsx` and `.../admin/conversations/[id]/page.tsx` carry an unrelated, already-verified diff from the *prior* turn's React-key-stability fix — reconfirmed via `git diff` before starting this investigation; not touched again here.)

## 6. Fail-before/pass-after proof

`useMessages.reconnect-message-loss.test.tsx`'s scenario-A test, run against the pre-fix `mergeServerMessages`:
```
AssertionError: expected [] to have a length of 1 but got +0
❯ expect(finalList).toHaveLength(1);
```
The exact reported symptom, reproduced deterministically (not a guess): message count goes from 1 (`sent`) to 0 the instant the racing stale history snapshot is merged in. After the fix, the same test passes: the message remains, with its real server id and `sent` state, exactly once.

## 7. Results of the 30 repeated focused runs

30/30 consecutive full-process runs of `useMessages.reconnect-message-loss.test.tsx` (both scenario A and F) passed with zero flakiness.

## 8. ACK-first/broadcast-first test results

Both pass: "ACK first, broadcast second" (matrix B) and "broadcast first, ACK second" (matrix C) each produce exactly one visible message with the real server id, verified via `reconcileMessage`'s existing dedup-by-identity logic (unchanged by this fix — it was already correct; only the *snapshot-merge* path had the defect).

## 9. Stale-history test result

Passes: matrix D (ACK then a reconnect history sync that doesn't yet include the message) and matrix E (a history request that started before the ACK but resolves after) both leave the reconciled `sent` message visible.

## 10. User/admin consumer results

Both `apps/web/src/app/(user)/chat/page.tsx` and `apps/web/src/app/(admin)/admin/conversations/[id]/page.tsx` call the exact same `useMessages(conversationId)` hook (confirmed via direct source inspection — identical call site, no role-specific branching in the data path). The fix lives in the shared `message-merge.ts`/`chat.store.ts` layer both consumers depend on identically, so it applies to both without any consumer-specific change or duplicate code path to separately verify.

## 11. Full web test results, twice

Two consecutive full-suite runs: **23/23 test files, 142/142 tests passed**, both times, no changes in between.

## 12. Type-check/build results

`tsc --noEmit`: clean. `next build`: clean production build, all 15 routes compiled/prerendered successfully.

## 13. Confirmation socket recovery architecture/constants untouched

Confirmed via diff: `apps/web/src/lib/outbox.ts` and `apps/web/src/lib/socket-client.ts` show **zero changes**. `CHAT_SEND_ACK_TIMEOUT_MS` (8000), `NORMAL_RECONNECT_GRACE_MS` (3000), `FRESH_SOCKET_CONNECT_TIMEOUT_MS` (5000), `MAX_HARD_SOCKET_REBUILDS_PER_SEND_CYCLE` (1), and `MAX_CHAT_SEND_EMITS_PER_SEND_CYCLE` (2) are all unchanged. `useMessages.ts` itself was also not touched — the redundant reconnect refetch it performs still happens, it is simply no longer capable of erasing a confirmed message.

## 14. Remaining risk

None specific to this bug — the fix closes the exact proven mechanism (any local-only message, not just pending ones, survives a page merge) and cannot resurrect a genuinely server-deleted message (that path is untouched and separately tested, matrix I). The pre-existing, already-disclosed, unrelated environment gaps (no committed ESLint config, Prisma network-block, lockfile not regenerated for jsdom/testing-library) remain as previously reported and are out of scope here. No API code was touched — refresh already proved the backend persisted the message correctly, so the API was never a suspect and the trace confirmed the defect is entirely client-side.

Nothing in this pass was committed, pushed, or deployed.
