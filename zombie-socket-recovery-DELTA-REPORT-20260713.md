# Zombie Socket.IO Recovery — Delta Re-Verification Report

This report closes the 4 gaps identified in the prior review and issues a corrected verdict. It does not repeat evidence already established (architecture inspection, state-machine trace, timing constants, unit tests) — see the prior report for that. This report only covers what changed.

---

## 1. Corrected verdict

**NOT VERIFIED.**

Per the explicit rule: *"If normal Prisma generation cannot complete, the verdict must remain NOT VERIFIED."* Real `prisma generate` was attempted with no copied artifacts, no flags, no workaround, and it fails in this sandbox because `binaries.prisma.sh` is blocked by the outbound network proxy (`403` on both HTTP and HTTPS, confirmed via direct `curl`, while `registry.npmjs.org` and `github.com` are reachable). This is a hard, reproducible, environment-level network-policy block, not a code defect — but the rule is unconditional, so the verdict is **NOT VERIFIED** regardless of how the other three gaps closed (all three closed successfully — see below).

---

## 2. Real clean Prisma generation / API build evidence

Removed the previously-copied `.prisma/client` output entirely, then ran the real command with no flags:

```
$ pnpm --filter api exec prisma generate
Error: Failed to fetch sha256 checksum at
  https://binaries.prisma.sh/all_commits/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/linux-arm64-openssl-3.0.x/libquery_engine.so.node.gz.sha256 - 403 Forbidden
exit code: 1
```

Connectivity proof:
```
$ curl https://binaries.prisma.sh/           → HTTP 403 (from proxy)
$ curl http://binaries.prisma.sh/            → HTTP 403 (from proxy)
$ curl https://registry.npmjs.org/           → HTTP 200
$ curl https://github.com/                   → HTTP 200
```
Checked `@prisma/engines`' own dependency tree: this Prisma version (6.19.3) has no npm-registry-hosted fallback for engine binaries — `binaries.prisma.sh` is the only source. No legitimate path around this was found.

Downstream consequence (proven, not assumed): without a generated client,
```
$ pnpm --filter api type-check   → exit 2, 122 TypeScript errors (PrismaClient has no exported member, PrismaService missing $connect/user/conversation/etc.)
$ pnpm --filter api build        → exit 1
$ pnpm --filter api test         → 3 of 5 suites fail to even load ("Cannot find module '.prisma/client/default'"): notifications.service.spec.ts, client-diagnostics.spec.ts, send-message.idempotency.spec.ts
```
This is a strictly worse (and more honest) result than the prior report's copied-artifact evidence, which had masked this cascading test-suite breakage. **This is the correct behavior to report — nothing here is a product defect; it is the accurate blast radius of the network block.**

**Action needed to close this gap:** run `pnpm --filter api exec prisma generate && pnpm --filter api type-check && pnpm --filter api build` on a machine/CI runner with network access to `binaries.prisma.sh`.

---

## 3. Continuous 1000+ message soak — one process, one lifecycle

Rewrote the soak test so generation, health, listeners, diagnostics, and the outbox are never reset — one `beforeAll`, one real Socket.IO server, one client socket lifecycle, chunked dispatch (yielding to the event loop between chunks of 40, not resetting anything) so the 1075 messages actually get real network turnaround instead of being fired into an unyielding synchronous burst.

Checkpoints (generation is CUMULATIVE, never reset):

| Messages dispatched | Generation | Health | Live server connections | Listener count |
|---|---|---|---|---|
| 1 | 2 | healthy | 1 | 4 |
| 100 | 4 | healthy | 1 | 4 |
| 250 | 8 | healthy | 1 | 4 |
| 500 | 14 | healthy | 1 | 4 |
| 750 | 20 | healthy | 1 | 4 |
| 1000 | 26 | healthy | 1 | 4 |
| final (1075) | 46–48 | healthy | 1 | 4 |

Final metrics (Run 1 / Run 2, both real, both passed):
```
Run 1: total=1075 zombieScheduled=102 reconnectScheduled=55 offlineScheduled=20 terminalScheduled=18
       collateralFailures=78 stillFailedAfterRetry=0 finalGeneration=46 liveServerConnections=1
Run 2: total=1075 zombieScheduled=102 reconnectScheduled=55 offlineScheduled=20 terminalScheduled=18
       collateralFailures=82 stillFailedAfterRetry=0 finalGeneration=45 liveServerConnections=1
```
- ≥100 connected-zombie recoveries: **102** ✓ (each real ack-timeout → real rebuild → real retry)
- ≥50 real disconnect/reconnect cases: **55** ✓ (server-side `socket.disconnect(true)` on the live connection; client's real Socket.IO reconnection or the app's hard-rebuild fallback recovers it)
- ≥20 offline/online transitions: **20** ✓ (real `navigator.onLine` + `window` `online` event)
- Deliberate terminal second-attempt failures: **18**, all correctly reached `failed`
- Text/image/file/voice rotated every send; 4 conversations used
- `collateralFailures` (a message whose retry *also* got interrupted by an unrelated overlapping disconnect/zombie event — realistic chaotic-network overlap, not a bug) all fully recovered via manual Retry: **stillFailedAfterRetry = 0** in both runs
- **Max simultaneous Manager/socket/server-connections: 1, at every checkpoint and at the end, in both runs.**
- Zero lost messages, zero duplicate messages (`dupCheck.size === grandTotal` in both runs), zero duplicate uploads, zero residual rebuild Promise (asserted via `getSocketHealth() === 'healthy'`), zero unhandled rejections/exceptions (vitest reports none; a failing `act`/rejection would have failed the test run).

Run each in a single continuous `vitest` process, ~11–13s wall time.

---

## 4. Complete UI-consumer verification and new test results

Every consumer on the required list was read in full (not excerpted) by an adversarial pass: user chat page, admin conversation detail, admin conversation list, user/admin newsletter list+detail (4 pages), MessageInput, MessageBubble, NewsletterPost, useMessages, useSocket/useLiveSocket, typing, seen, presence (`NotificationsProvider` — not previously reviewed), newsletter-realtime, diagnostics recovery.

**One real, previously-undisclosed defect found and fixed:** `MessageInput.tsx`'s unmount-cleanup effect (`deps=[conversationId]` only) closed over a **stale `socket`** from render time. A hard rebuild while the component stayed mounted on the same conversation meant the `CHAT_TYPING_STOP` emit on unmount silently targeted the torn-down socket. Low severity (only a typing-stop signal, no message loss), but a genuine violation of "always emit through the live socket." **Fixed** via a `socketRef` mirror (`apps/web/src/components/chat/MessageInput.tsx`). Proven: the new regression test **fails against the pre-fix code** (reverted and re-ran — confirmed 0 calls / stale-socket call) and **passes against the fix** (re-applied).

Everywhere else checked: every consumer receives the replacement socket via `useLiveSocket()`/`subscribeSocket()`, no stale one-shot caching, every `.on` has a matching `.off` in cleanup, no duplicate attachment (complete dependency arrays), no consumer that should be reactive but isn't.

**New automated regression tests added** (all passing, real jsdom + `@testing-library/react`, not source-inspection-only):

| Test file | Proves |
|---|---|
| `hooks/__tests__/useMessages.consumer.test.tsx` | Listeners attach exactly once, fully removed from the old socket after rebuild, exactly one attached to the fresh socket, an event on the old socket is never handled, unmount removes all listeners |
| `components/chat/__tests__/MessageInput.rebuild.test.tsx` | **The defect fix**: `CHAT_TYPING_STOP` at unmount fires on the fresh socket, never the old one (fails pre-fix, passes post-fix — verified both ways) |
| `components/chat/__tests__/MessageBubble.retry.test.tsx` | Manual Retry button calls `retryMessage(conversationId, clientMessageId)` exactly once for a failed message; absent for a sent message |
| `components/newsletter/__tests__/NewsletterPost.reactions.test.tsx` | Reaction removal emits on the fresh socket after a rebuild, never the old one |
| `app/(user)/chat/__tests__/page.rebuild.test.tsx` | User chat page's `CHAT_MESSAGE_PINNED` listener moves to the fresh socket, old one fully removed, no duplicate handling |
| `app/(admin)/admin/conversations/[id]/__tests__/page.rebuild.test.tsx` | Same proof for the admin conversation-detail page |

All 6 required targets covered. Test infrastructure added: `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` (declared in `apps/web/package.json` devDependencies; **`pnpm-lock.yaml` was not regenerated** — `pnpm add` could not complete dependency resolution in this sandbox due to registry flakiness after ~6 retries reaching partial resolution each time; a real `pnpm install` should be run to lock these before merging). `vitest.config.ts` gained `esbuild: { jsx: 'automatic' }`, required for component tests to render the app's actual (SWC-automatic-runtime) `.tsx` files under vitest.

One disclosed test-tooling anomaly (not a product defect, does not affect the verdict): in this sandbox, importing `SOCKET_EVENTS` from `@karamooziyar/shared` under vitest silently drops exactly two keys (`CHAT_MESSAGE_PINNED`, `NOTIFICATION_NEW`) that are present in source, present in a standalone `esbuild.build()` transform of the same file, and present in the real `next build` output — isolated to the two new page-level tests, worked around there via an explicit `vi.mock` supplying the real, source-verified value, clearly commented in both files.

---

## 5. Full Run 1 results

| Check | Result |
|---|---|
| Dependency verification | `pnpm -v` 9.15.0; git status clean except intended new/modified files |
| Prisma generate | **exit 1** (network-blocked, real command) |
| Web type-check | exit 0 |
| API type-check | **exit 2**, 122 errors (no generated client) |
| Web production build | exit 0 |
| API production build | **exit 1** |
| Web test suite | **18 files / 116 tests passed**, 6.79s |
| API test suite | **2 suites / 6 tests passed**, **3 suites failed to load** (no Prisma client) |
| Continuous 1000+ soak | **1/1 passed**, see §3 |

## 6. Full Run 2 results

| Check | Result |
|---|---|
| Prisma generate | **exit 1** (identical failure) |
| Web type-check | exit 0 |
| API type-check | **exit 2** (identical) |
| Web production build | exit 0 |
| API production build | **exit 1** (identical) |
| Web test suite | **18 files / 116 tests passed**, 6.81s |
| API test suite | **2 suites / 6 tests passed**, 3 suites failed to load (identical) |
| Continuous 1000+ soak | **1/1 passed**, see §3 |

Run 1 and Run 2 are identical in every pass/fail outcome and exit code, with zero code changes between them (`git status --porcelain` shows no diff to any source file between runs — only the pre-existing untracked new test files). The only run-to-run variance is the exact `collateralFailures`/final-generation count in the soak test (78 vs 82, 46 vs 45), which is expected timing jitter from deliberately overlapping chaos scenarios in real elapsed time — every hard invariant (zero unrecovered failures, zero duplicates, exactly 1 live connection, all thresholds met) was identical in both runs.

## 7. Exact commands and exit codes (representative)

```
pnpm --filter api exec prisma generate                                    → 1
pnpm --filter api type-check                                              → 2
pnpm --filter api build                                                   → 1
pnpm --filter web type-check                                              → 0
pnpm --filter web build                                                   → 0
(cd apps/web && pnpm vitest run --exclude outbox.{extended-soak,realtiming,continuous-soak}.test.ts) → 0  (116/116)
(cd apps/web && pnpm vitest run src/lib/outbox.continuous-soak.test.ts)    → 0  (1/1)
(cd apps/api && pnpm test -- --runInBand)                                 → 1  (6/6 that could load; 3 suites blocked)
git apply <MessageInput.tsx fix>  →  reverted  →  regression test FAILS  →  re-applied  →  regression test PASSES
```

## 8. Remaining risks

1. **Blocking:** API cannot be built or fully tested in this sandbox — needs `prisma generate` run where `binaries.prisma.sh` is reachable, then `type-check`/`build`/`test` re-run for real, independent evidence.
2. `pnpm-lock.yaml` does not yet include the new devDependencies (jsdom/testing-library) — run `pnpm install` for real once network resolution is stable.
3. The `MessageInput.tsx` fix and all 6 new regression tests are believed correct and are proven against both pre-fix and post-fix code, but have only been exercised in this sandbox's vitest/jsdom environment, not against a real browser.
4. The two page-level tests route around a vitest/esbuild-only `SOCKET_EVENTS` resolution anomaly via an explicit mock; this anomaly itself is unexplained (though proven irrelevant to production, since `next build` succeeds) and could be worth a follow-up investigation if it recurs elsewhere.
5. Everything verified in the prior report (architecture, state machine, timing constants, unit/integration/leak/concurrency tests, backend idempotency logic itself) still stands as real evidence and was not weakened by this pass — only the four specific gaps above were in scope here.

## 9. Updated pass/fail matrix

| Item | Status |
|---|---|
| Real Prisma generate (no copied artifacts) | **FAIL** — network-blocked |
| API type-check (real client) | **FAIL** (downstream of above) |
| API production build (real client) | **FAIL** (downstream of above) |
| API test suite (real client) | **PARTIAL** — 6/6 pass where loadable, 3/5 suites can't load |
| Web type-check | PASS |
| Web production build | PASS |
| Web full test suite | PASS (116/116) |
| Continuous 1000+ message soak, one process/lifecycle | **PASS** |
| ≥100 zombie / ≥50 reconnect / ≥20 offline thresholds | **PASS** (102 / 55 / 20) |
| Max 1 Manager / 1 socket throughout | **PASS** |
| Zero lost/duplicate messages, zero unrecovered failures | **PASS** |
| Complete UI-consumer source verification (all 18 items) | **PASS** |
| New regression tests for 6 required consumers | **PASS** (all 6 present and passing) |
| Defect found and fixed (MessageInput stale-socket) | **PASS** (fixed, proven both ways) |
| Two full consecutive runs, identical results | **PASS** |

### Final verdict: **NOT VERIFIED**

Reason: real `prisma generate` cannot complete in this environment (network policy blocks `binaries.prisma.sh`), and per the explicit rule this alone is sufficient to withhold VERIFIED regardless of every other gate passing. Everything else required by this delta pass — the continuous single-lifecycle 1000+ soak, the complete UI-consumer audit with a real defect found and fixed, the six new regression tests, and two identical consecutive full runs — is closed and passing. Re-run item §2/§8-1 on a network-unrestricted machine and, if it passes, the overall verdict becomes eligible for VERIFIED.
