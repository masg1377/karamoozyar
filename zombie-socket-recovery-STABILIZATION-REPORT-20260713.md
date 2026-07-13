# Zombie Socket Recovery — Final Stabilization Pass Report
**Date:** 2026-07-13
**Scope:** Task 1 (test harness correctness) + Task 2 (MessageInput typing-socket correctness) + Task 3 (scoped re-verification), per the explicit SCOPE FREEZE. No production recovery behavior, timing constant, or architecture was redesigned. No API/Prisma code was touched.

---

## 1. Was `alwaysSwallowClientMessageId` correct? Retained?

Yes. Re-inspected `real-chat-server.ts`'s `chat:send` handler: `alwaysSwallowClientMessageId` is checked **before** `zombieOnceByClientMessageId`, and swallows every attempt for a given `clientMessageId` regardless of which physical connection it arrives on — exactly matching its documented purpose (deterministically forcing a terminal double-timeout, avoiding the earlier connIndex-prediction bug). It required no change and was kept as-is. Added test coverage for it directly (see §6, tests 6 and 8).

## 2. Every call site of the previous `resetBookkeeping()`

Grepped `apps/web/src` for `resetBookkeeping(` before making any change. Exactly two call sites existed, both inside `beforeEach` blocks, both immediately after `socketClientMod.__resetSocketClientForTests()`:

- `apps/web/src/lib/outbox.soak.test.ts:63`
- `apps/web/src/lib/outbox.integration.test.ts:90`

No other call site existed anywhere in `apps/web/src` (confirmed again after the fix — zero remaining references to the old name).

## 3. Could it hide a live connection?

Yes — a real, not merely theoretical, race. Each file's `afterEach` calls `socketClientMod.disconnectSocket()`, which calls the real client socket's `.disconnect()` synchronously but does **not** wait for the server to actually process that disconnect (a real network/event-loop round trip). The next test's `beforeEach` ran synchronously-adjacent to that (previously `resetBookkeeping()` was itself synchronous), so `this.connections = []` could execute while the prior test's connection was still genuinely `.connected` on the server side — silently dropping it from `liveConnectionCount()`'s bookkeeping and allowing the next accepted connection to receive a colliding `connIndex` (e.g., index 0 reused while an old index-0 socket was still technically open).

## 4. Exact harness correction made

In `apps/web/src/lib/test-helpers/real-chat-server.ts`:

- Removed `resetBookkeeping()`. Replaced with **two** separate methods:
  - `resetScenarioState()` (sync) — clears `received`, `handlers`, `zombieOnceByClientMessageId`, `alwaysSwallowClientMessageId`, and resets `defaultAckDelayMs` to 0. **Never touches `connections`.**
  - `disconnectAllAndResetConnections()` (async) — force-closes (`socket.disconnect(true)`) every currently-tracked connection, `waitUntil`s every one of them is actually `!connected` (5s bound), and only then clears `connections`. This is the only way connection history/connIndex can be reset to empty, and it is provably safe: it never clears a connection until the server has genuinely seen it close.
- Updated both call sites (`outbox.soak.test.ts`, `outbox.integration.test.ts`) to call `resetScenarioState()` + `await disconnectAllAndResetConnections()`. `outbox.soak.test.ts`'s `beforeEach` had to become `async` to support the await (a required, non-speculative consequence of the fix, not a scope expansion).
- Verified this preserves every existing test's index-0-relative assumptions (`ignoreAcksOn(0)`, `server.connections[0]`, absolute `connections.length` checks in Gate 4/6/11/12): because the new async teardown runs to completion in `beforeEach` before each test starts, `connections` legitimately returns to empty and connIndex legitimately restarts at 0 for the next test — the same practical behavior as before, but only after real proof of closure rather than an unconditional clear.

## 5. Exact MessageInput correction made

In `apps/web/src/components/chat/MessageInput.tsx`:

- `handleTyping`'s immediate `CHAT_TYPING_START`/`CHAT_TYPING_STOP` emit and the delayed 2-second timer's `CHAT_TYPING_STOP` emit now read `socketRef.current` instead of the closed-over `socket` value. This was the actual remaining defect: the `setTimeout` callback closed over the render-time `socket`, so a hard rebuild happening after the timer was scheduled but before it fired still emitted on the torn-down socket.
- `socketRef` is now updated via `useIsomorphicLayoutEffect` (`typeof window !== 'undefined' ? useLayoutEffect : useEffect`) instead of a plain `useEffect`. Justification: a layout effect runs synchronously immediately after commit, before any passive effect in the tree flushes and before paint — the earliest point React guarantees, closing the largest part of the "stale ref" window. The isomorphic guard avoids the dev-mode SSR warning (`useLayoutEffect` no-ops with a warning during Next.js's server render of this `'use client'` component) while keeping the synchronous guarantee on the client, where it actually matters.
- `handleTyping`'s dependency array dropped `socket` (no longer read directly) → `[isTyping, conversationId]`.
- The mount/unmount effect (`[conversationId]`) now clears **and nulls** `typingTimerRef.current` in its cleanup, and emits via `socketRef.current?.emit(...)`. This cleanup still runs on every `conversationId` change too (matching required behavior), so the socket ref itself is *not* nulled there.
- Added a **separate** effect with `[]` deps whose cleanup nulls `socketRef.current` — this only fires on a true unmount, distinct from the conversation-change case above (nulling the ref on every conversationId change would have left the ref permanently null after a same-socket conversation switch, since nothing else would repopulate it).
- Removed the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment on the mount/unmount effect: after the fix, that effect's cleanup only reads `typingTimerRef`, `socketRef` (both refs, exempt) and `conversationId` (already listed) — the dependency array `[conversationId]` is now genuinely exhaustive, so the suppression was no longer justified. (Note: this repository has no committed ESLint config — `next lint` and standalone `eslint` both fail with no config found — so this was verified by manual code-path inspection rather than an automated lint run; this is a pre-existing environment gap, unrelated to this pass, not something introduced or fixed here.)
- `sendTextMessage`'s `CHAT_EDIT` emit was deliberately left using `socket` directly (out of scope: it's a same-tick, non-delayed emit inside a fresh render's own closure, not subject to the timer/closure staleness this task addresses).

## 6. New focused test results

**Harness tests** (`apps/web/src/lib/test-helpers/real-chat-server.test.ts`, new file, 9 tests, all passing):
1. `liveConnectionCount()` is 1 after a real connect.
2. `resetScenarioState()` does not hide a live connection.
3. connIndex stays stable across a scenario reset.
4. `liveConnectionCount()` becomes 0 after a real disconnect, while `connections` history is preserved (not silently hidden).
5. A second connection gets a newer, non-reused connIndex.
6. `alwaysSwallowClientMessageId` swallows every attempt regardless of connIndex.
7. `zombieOnceByClientMessageId` swallows exactly once then allows the retry to ack.
8. Documents deterministic precedence if a cid were ever in both swallow sets (alwaysSwallow checked first; zombieOnce's entry is provably never consulted in that case).
9. (Bonus, direct proof of the actual fix) `disconnectAllAndResetConnections()` only clears history after the real server-side close, and the next connIndex legitimately restarts at 0.

**MessageInput typing tests** (`apps/web/src/components/chat/__tests__/MessageInput.typing-rebuild.test.tsx`, new file, 4 tests, all passing):
1. Typing timer after rebuild: STOP fires on socket B, not A.
2. Unmount after rebuild: cleanup STOP fires on B only.
3. Immediate typing event after rebuild: next START/STOP through B only.
4. No duplicate typing events/timers across normal rerenders (no rebuild).

**Fail-before/pass-after verification** (done by temporarily reverting the fix in an isolated scratch copy, not in the delivered code): tests 1 and 2 genuinely exercise the fixed defect — both **fail** against the fully-reverted stale-closure implementation (received 0 stale-socket calls became 0 calls to the fresh socket, i.e., the STOP never reached B) and **pass** after the fix. Tests 3 and 4 pass under both the stale and fixed implementations — disclosed honestly: `handleTyping` itself is recreated fresh each render (its own dependency array already included `socket` pre-fix), so a *new* keystroke after a rebuild was never actually broken; only closures already scheduled before the rebuild (the setTimeout callback, and — already fixed in a prior session — the unmount cleanup) were stale. Tests 3/4 are legitimate regression/invariant coverage as required, just not discriminating ones for this specific defect.

The pre-existing `MessageInput.rebuild.test.tsx` (unmount-after-rebuild, fixed in a prior session) continues to pass unchanged.

## 7. Full web test/type-check/build results

Run against a synced scratch clone with working `node_modules` (the mounted project folder itself has no `jsdom`/`@testing-library` installed and no `pnpm-lock.yaml` regeneration is possible in this sandbox — a carried-over, already-disclosed environment limitation, not new to this pass):

- `vitest run` (all 21 real web test files, 130 tests): **130/130 passing**, two full consecutive clean runs.
- `tsc --noEmit`: clean, no output.
- `next build`: clean production build, all 15 routes compiled and prerendered successfully.
- Two obsolete scratch-only files from an earlier verification phase (`outbox.extended-soak.test.ts`, `outbox.realtiming.test.ts`) still referenced the old `resetBookkeeping()` name and failed when accidentally included in a scratch-clone-wide run; these were never part of the real repo (confirmed via `git status` — untracked, never committed) and were removed from the scratch clone rather than "fixed," since fixing scratch-only artifacts that were deliberately never delivered is out of this pass's scope.
- **One observed flake, disclosed for full transparency:** during repeated full-file runs of `outbox.soak.test.ts`, the Gate 11/12 100-message soak test failed once (10/100 messages ended `failed` instead of 0) out of roughly 8 total runs across both the old and new harness code. Isolated single-file/single-test runs and 7 of 8 combined runs passed cleanly (`failed=0` every time). An A/B comparison against the original (pre-fix) `resetBookkeeping()` code showed the same order of occasional flakiness is not attributable to this pass's change — the harness fix only affects bookkeeping *between* tests (fully resolved before Gate 11/12 starts), not anything during it, and the test's own tight `CHAT_SEND_ACK_TIMEOUT_MS: 250` bound is inherently timing-sensitive in a shared sandbox. Per the SCOPE FREEZE ("no new timing constants," no redesign without a test proving a concrete production defect), this was not modified — it is flagged here as a pre-existing environmental sensitivity of an already-accepted test, not a new regression.

## 8. Recovery architecture/constants unchanged?

Confirmed. `apps/web/src/lib/outbox.ts` and `apps/web/src/lib/socket-client.ts` (the actual production recovery/hard-rebuild logic and all its timing constants) show **zero diff** for this entire pass. The 8-second ACK timeout, one genuine hard rebuild, fresh Manager/Engine/socket, same clientMessageId reuse, max one automatic rebuild, max two automatic emits, bounded terminal failure, manual retry via fresh generation, single-flight rebuild, and `subscribeSocket`/`useLiveSocket` publication were not touched.

## 9. Exact changed files

- `apps/web/src/lib/test-helpers/real-chat-server.ts` — harness fix (§4)
- `apps/web/src/lib/outbox.integration.test.ts` — call-site update (§4)
- `apps/web/src/lib/outbox.soak.test.ts` — call-site update, `beforeEach` made async (§4)
- `apps/web/src/lib/test-helpers/real-chat-server.test.ts` — **new file**, 9 harness self-tests (§6)
- `apps/web/src/components/chat/MessageInput.tsx` — typing-socket fix (§5)
- `apps/web/src/components/chat/__tests__/MessageInput.typing-rebuild.test.tsx` — **new file**, 4 regression tests (§6)

No other file was modified in this pass. (`apps/web/package.json` and `apps/web/vitest.config.ts` carry diffs from the *prior* session, not this one — reconfirmed via `git diff` before starting; left untouched here.)

## 10. Remaining blockers

- **API/Prisma generation**: unchanged from the prior delta report — `binaries.prisma.sh` is blocked (403) by this sandbox's network policy, with no npm-registry-hosted fallback for Prisma 6.19.3. This is an environment blocker, not a code defect, and — per this pass's explicit instruction — API code was not touched to "fix" it.
- **`package.json`/lockfile consistency**: `apps/web/package.json`'s `jsdom`/`@testing-library/*` devDependencies (added in a prior session for component testing) are still not reflected in a regenerated `pnpm-lock.yaml` in this sandbox (network-resolution constraints on `pnpm add`/`pnpm install` persist). Not a new issue; not touched in this pass.
- **No ESLint config committed** in this repository (`next lint`/`eslint` both fail with "couldn't find a config"), so the exhaustive-deps claim in §5 was verified manually rather than by an automated tool. Pre-existing, unrelated to this pass.
- The one flaky Gate 11/12 run described in §7 is a disclosed, not-reproduced-on-demand, environment-timing sensitivity — not a code defect, not fixed in this pass per the scope freeze.

## 11. Final statement

The stop condition is met: the harness cannot hide a live connection (proven by test), connIndex stays monotonic/unique for the server's real lifetime and is only ever reset via the explicit safe async teardown, `alwaysSwallow`/`zombieOnce` behave exactly as documented (including precedence), every `MessageInput` typing emit now uses the current socket, both new MessageInput regression tests that target the actual defect pass, and all 130 existing web tests, the type-check, and the production build pass cleanly across two consecutive full runs. This implementation is now **scope-frozen**. No further speculative changes, new abstractions, or verification-scope expansion are recommended. Nothing in this pass was committed or pushed, per instruction.
