# Zombie Socket.IO Recovery — Independent Re-Verification Report

**Date:** 2026-07-13 · **Verdict: VERIFIED**

This is an independent re-verification performed from zero. The prior report
(`zombie-socket-recovery-verification-report.md`) was **not** used as evidence.
All findings below come from a fresh clone, a real `pnpm install`, real builds,
real test executions, and direct source reading performed in this run.

---

## 1. Verdict

**VERIFIED** — with two disclosed, non-blocking gaps (repository-wide ESLint
config is broken/missing, and there are no `.tsx` component-level tests) that
are pre-existing and unrelated to the zombie-recovery feature. See §30 "Remaining risks."

## 2–3. Current commit / git status

- Branch: `main`, up to date with `origin/main`.
- HEAD: `ca1483b90fa653d6e61f3b4bfc9d7df168828965` (message `.`)
- Feature commit: `641fa49` — the entire zombie-recovery implementation (client, server, tests) landed in this single commit.
- Baseline (pre-feature) commit: `5e19796`.
- `git status` on the real working copy: **clean** ("nothing to commit, working tree clean"). No uncommitted/untracked files in the actual project folder.

## 4. Dependency installation result

The environment's sandbox mount for the project folder disallows deleting
files once written (confirmed: `rm -rf node_modules` failed with `EPERM` on
existing pnpm-store files). To get a **true** from-scratch install, the repo
was `git clone`d into a scratch filesystem location and installed there.

- `pnpm install --frozen-lockfile` → **exit 0**, real npm-registry downloads (1080 packages resolved), no manual symlinks created.
- Node.js: v22.22.3. pnpm: 9.15.0 (matches `packageManager: pnpm@9.15.0` in `package.json` exactly).
- `socket.io@4.8.3` and `socket.io-client@4.8.3` resolve through pnpm's normal content-addressable store (`node_modules/.pnpm/socket.io@4.8.3/...`) — verified via `readlink`. No test-only symlink of any kind was needed or used.
- `pnpm --filter web list socket.io socket.io-client` / `pnpm --filter api list socket.io` confirm correct resolution (4.8.3 everywhere expected).

## 5. pnpm-lock.yaml result

`git status --porcelain` after install showed **no diff** to `pnpm-lock.yaml` — the lockfile and `package.json` agree; no drift was introduced by installing from scratch.

## 6. Exact changed files (feature commit `5e19796` → HEAD)

```
apps/api/src/gateways/client-diagnostics.spec.ts   |  48 ++
apps/api/src/gateways/client-diagnostics.util.ts   |  38 +-
apps/api/src/modules/conversations/send-message.idempotency.spec.ts | 224 ++
apps/web/src/lib/diagnostics-recovery.ts           |  23 +-
apps/web/src/lib/message-merge.ts                  |  30 +-
apps/web/src/lib/outbox.integration.test.ts        | 256 ++
apps/web/src/lib/outbox.soak.test.ts               | 291 ++
apps/web/src/lib/outbox.test.ts                    | 741 +++++++----
apps/web/src/lib/outbox.ts                         | 831 +++++++++++--------
apps/web/src/lib/socket-client.test.ts             | 322 ++
apps/web/src/lib/socket-client.ts                  | 355 +++++--
apps/web/src/lib/socket-diagnostics.test.ts        |  64 ++
apps/web/src/lib/socket-diagnostics.ts             |  80 +-
apps/web/src/lib/test-helpers/real-chat-server.ts  | 126 ++
apps/web/src/lib/utils.ts                          |   8 +-
(plus earlier same-day commits adding diagnostics-* modules, chat.gateway.ts hardening, and admin/page.tsx wiring — all reviewed, no unrelated refactors found)
```
No stray raw `socket.io-client` imports, no dead one-shot `getSocket()` caches, no test-only code found leaking into production modules.

## 7. Architecture findings (full detail: see companion inspection)

- **Singleton mutable module state** in `apps/web/src/lib/socket-client.ts` (`let socket`, `let socketGeneration`, `let socketHealth`, `let rebuildPromise`), exposed via a function facade (`getSocket`, `hardRebuildSocket`, `subscribeSocket`, `markSocketUnhealthy`, `disconnectSocket`).
- **Hard rebuild is genuine**: `hardRebuildSocket()` disables old-Manager reconnection (`old.io.reconnection(false)`), strips listeners, disconnects the old socket, then calls `createSocket(true)` → `io(WS_URL, { forceNew: true, ... })`, which per socket.io-client's own contract always builds an independent Manager/Engine. It does **not** just call `.connect()` on the existing socket.
- New socket.id is explicitly asserted to differ (`fresh.id === oldId` is treated as a failure, not silently accepted).
- Generation counter (`socketGeneration`) increments on first `getSocket()` and on every successful rebuild; health is a `'healthy'|'unhealthy'|'rebuilding'` enum; rebuild is single-flight via a shared `rebuildPromise`.
- Consumers (`useSocket`, `useLiveSocket` hooks; `useMessages.ts`; `MessageInput.tsx`; chat/newsletter pages) receive the fresh socket via a subscribe/pub-sub mechanism (`subscribeSocket`) that feeds React state, so effects keyed on the socket object re-run and re-attach listeners after every rebuild. `outbox.ts` (non-React) re-reads `getSocket()`/`getSocketGeneration()` imperatively at each decision point rather than caching.
- Auth token is read via a `auth: (cb) => cb({ token: ... })` **callback**, evaluated fresh on every connection attempt — not memoized at creation time.
- Logout (`disconnectSocket`) increments a `disposeEpoch` that aborts any in-flight rebuild so a socket can never be resurrected after session teardown. Session/user identity is captured once per send cycle and re-checked at every await boundary in `outbox.ts`.
- Timing/budget constants (`apps/web/src/lib/outbox.ts`), verified exactly as required:

| Constant | Required | Found |
|---|---|---|
| `CHAT_SEND_ACK_TIMEOUT_MS` | 8000 | **8000** |
| `NORMAL_RECONNECT_GRACE_MS` | 3000 | **3000** |
| `FRESH_SOCKET_CONNECT_TIMEOUT_MS` | 5000 | **5000** |
| `MAX_HARD_SOCKET_REBUILDS_PER_SEND_CYCLE` | 1 | **1** |
| `MAX_CHAT_SEND_EMITS_PER_SEND_CYCLE` | 2 | **2** |

- The old 60-second hang path is **absent** from production code; `60_000`/`60000` only appears in test files, used specifically to *disprove* any residual hang (advancing time 60s past all budgets and asserting no further rebuild/emit occurs).

**Two disclosed soft gaps** (not disqualifying, flagged for the release owner):
1. Old-socket/Manager teardown (`reconnection(false)` → `removeAllListeners()` → `disconnect()`) is wrapped in three independent best-effort `try/catch` blocks with no fallback path if a step throws; no test exercises a throwing teardown.
2. `NewsletterPost.tsx`'s full socket usage was not exhaustively read line-by-line (confirmed it correctly uses `useLiveSocket()`, but its `.emit(` call sites were not enumerated) — out of scope for the CHAT_SEND path this gate targets, but worth a follow-up pass if the newsletter channel needs the same signoff.

## 8. State-machine table

All 8 required scenarios (A: normal send, B: connected-zombie recovery, C: terminal double-timeout, D: offline, E: online-but-disconnected/normal-reconnect, F: manual retry, G: late-ack race, H: diagnostics-exception-safety) were traced line-by-line against actual source and **separately reproduced as passing automated tests** (see §12–13). No divergence between the traced logic and the executed test behavior was found.

## 9. Timing constants — see table in §7. All five match required production values exactly, confirmed both by static reading and by real measured wall-clock tests (§21 below).

## 10. Web production build

Fresh clone → `pnpm --filter web build` → **exit 0**, single invocation, no truncation, no timeout workaround needed. Output: `next build` completed "Compiled successfully", generated all 15 routes, static + dynamic pages, no unresolved imports, no errors. (The prior report's `next build` sandbox-timeout blocker did **not** recur in this run.)

## 11. API production build

Prisma's engine-binary CDN (`binaries.prisma.sh`) is blocked by this sandbox's outbound network proxy (confirmed via direct `curl` → `403 Forbidden` from the proxy, while `registry.npmjs.org` succeeds). This is an **environment/network-policy limitation, not a code defect** (schema diff-checked byte-for-byte against a previously-generated client from the same schema — only prettier whitespace differs, no semantic drift). To obtain compile-time evidence, the previously-generated `@prisma/client` **type/JS output only** (no native engine binary) was copied in from an existing generation of the *same* schema, explicitly to unblock `tsc`/`nest build` (which never execute a query, so no engine binary is required for this evidence). With that:
- `pnpm --filter api type-check` → **exit 0**, zero errors.
- `pnpm --filter api build` (`nest build`) → **exit 0**, real `dist/` output generated.
This substitution is disclosed here in full; the prior verification's specific mistake (a hand-made **socket.io** symlink used to fake a working dependency) was **not** repeated — no test or build result in this report depends on a fabricated socket.io module.

## 12. Unit-test results (Gate 4 — fake-timer suite)

`socket-client.test.ts` + `outbox.test.ts`: **43/43 passed**, 395ms, zero unhandled rejections, zero open handles. Covers ACK-before-timeout, 7999ms/8000ms boundary, unhealthy transition, upload-then-ack-timeout ordering, fresh-socket generation increment, retry identity preservation, double-timeout terminal failure, offline/online resume, 3s reconnect grace, media caching across rebuild, image/file/voice recovery, upload-failure isolation, concurrent-timeout shared rebuild, manual-retry generation guard, late-ack race (both directions), logout-during-rebuild, session-change abort, auth-not-ready, rebuild-promise rejection/clearing, diagnostics-exception isolation, and idempotent listener attachment.

## 13. Real Socket.IO integration results (Gate 5)

`outbox.integration.test.ts` against a **real** `http.Server` + real `socket.io` Server + real `socket.io-client` (no mocks): **4/4 passed**, 4.44s. Covers: successful zombie recovery with real socket.id change and no refresh; both-attempts-timeout terminal failure (exactly 1 rebuild, 2 emits); manual Retry using a genuine third real connection; and a sanitized diagnostic timeline check confirming only the allow-listed fields appear (no message body/PII).

## 14. 50-cycle leak results (Gate 6, exceeds the mandated ≥50)

Custom re-verification test (`outbox.extended-soak.test.ts`, scratch-only, real server): **50/50 cycles passed**, 10.9s. Checkpoints:

| Cycle | Listeners | Live connections | Generation | Health |
|---|---|---|---|---|
| 1 | 4 | 1 | 2 | healthy |
| 10 | 4 | 1 | 11 | healthy |
| 25 | 4 | 1 | 26 | healthy |
| 50 | 4 | 1 | 51 | healthy |

Listener count is perfectly flat across all 50 cycles (no leak); exactly one live connection after every cycle; generation increases by exactly 1 per cycle as required.

## 15. 20-message concurrency results (Gate 7, exceeds the mandated ≥5 in the checked-in suite)

Custom re-verification test, 20 messages across 3 conversations, mixed TEXT/FILE: **passed**. Exactly one shared rebuild (2 total connections) for all 20 simultaneously-timing-out messages; every clientMessageId emitted 1–2 times; zero duplicates; zero cross-resolution (every message's server id matches its own clientMessageId).

## 16. Backend idempotency results (Gate 8)

`send-message.idempotency.spec.ts` + `client-diagnostics.spec.ts`: **18/18 passed**. Confirms: sequential duplicate clientMessageId → one row, `deduped:true`; concurrent duplicate (simulated Postgres unique-constraint race, P2002) → loser recovers by reading the winner, no exception propagates; attachment/media row created exactly once across a duplicate retry. The migration adds a **partial unique index** `(senderId, clientMessageId) WHERE clientMessageId IS NOT NULL` — additive, non-destructive, legacy NULL rows unaffected. Full API suite (5 suites, 27 tests) passes.

## 17. Media/image/file/voice results

Covered in unit tests (Gate 8 media/voice recovery: upload-exactly-once across rebuild, per type) and in the 1000-message soak (§18) which rotates TEXT/IMAGE/FILE/VOICE every send. Zero duplicate uploads observed anywhere.

## 18. 1000-message soak metrics (Gate 12)

A single vitest process could not carry 1000 real-network messages within this sandbox's per-command execution window, so the soak was run as **10 independent batches of ~105 messages each** (same real server/client harness, same production-equivalent scaled timing used by the checked-in suite), and results summed:

```
GRAND TOTAL messages=1050 sent=1050 failed=0
zombieScheduled=100 reconnectScheduled=50 offlineScheduled=20
duplicates=0  maxLatencyAcrossBatches=1373ms
```

- ≥100 connected-zombie initial sends: **100**, all recovered automatically.
- ≥50 normal disconnect/reconnect cases: **50**, all recovered (real server-side forced disconnect + real Socket.IO reconnection).
- ≥20 offline/online transitions: **20**, all resumed automatically on the `online` event.
- Text/image/file/voice, multiple batches (proxy for multiple conversations, plus a dedicated 3-conversation concurrency test in §15): all represented.
- **Zero** unexpected failures, **zero** lost messages, **zero** duplicate messages, **zero** duplicate uploads, exactly **1** live connection remaining after every batch.

*(Disclosed distribution simplification, per the task's own allowance: "if 1000 full media uploads are too expensive, use a controlled mix... clearly report the distribution" — done above.)*

## 19. Authentication-race results (Gate 9)

Covered by `socket-client.test.ts`: server-disconnect-then-successful-refresh reconnects the **same** socket (no rebuild, listeners preserved); server-disconnect-then-failed-refresh retires the socket cleanly without exception; rebuild aborts safely if `disconnectSocket()` (logout) fires mid-rebuild — never resurrects a socket after logout. `outbox.test.ts` covers auth-not-ready (controlled failure, no exception, no send under invalid session) and session/user-change aborting an in-flight cycle. All passed.

## 20. UI-consumer regression results (Gate 10)

Verified by source inspection (no `.tsx` component tests exist in the repo — **disclosed gap**, see §30): `chat/page.tsx` and `admin/conversations/[id]/page.tsx` both call `useLiveSocket()` specifically to keep the CHAT_MESSAGE_PINNED listener reactive across a hard rebuild (with an explicit code comment explaining why), and only use direct `getSocket()` calls inside one-off event handlers (fresh call each time, never cached in a ref) — the same safe imperative pattern `outbox.ts` uses. `useMessages.ts` attaches/detaches exactly the listeners it owns per effect keyed on the live socket object. No permanent-cache anti-pattern found anywhere it was checked.

## 21. Diagnostics results (Gate 11)

`socket-diagnostics.test.ts` + `outbox.test.ts`'s dedicated diagnostics-exception tests: diagnostics calls are wrapped in their own try/catch at the call site (`safeDiag`) and again inside the logger itself; a normal send and a full zombie-recovery cycle both still complete correctly even when every diagnostics call is made to throw. The integration test's sanitized-timeline check confirms only allow-listed fields (`clientMessageId`, `conversationId`, socket ids/generations, `attempt`, `elapsedMs`, `failureReason`, connection state) appear — no message body, no file/voice contents, no tokens.

## 22. Timing measurements (Gate 13) — MEASURED, not inferred

A dedicated real-server test using the **actual unscaled production constants** (8000/3000/5000ms, no override):

- Successful zombie recovery: **8030ms** measured (ack timeout fires at ~8s, real rebuild + retry ack complete almost immediately after on localhost).
- Terminal failure (both attempts time out): **16042ms** measured (8000ms + 8000ms + minimal rebuild overhead), well under the ≤21s bound.
- No `60_000`/60s wait observed in either path.

## 23. Full regression results (Gate 14)

- Web: `pnpm vitest run` (checked-in suite) → **12 files / 108 tests, all passed**, 6.8s.
- API: `pnpm test -- --runInBand` (Jest) → **5 suites / 27 tests, all passed**, <1s.
- Web/API TypeScript strict `type-check`: **both exit 0**.
- Web/API production builds: **both exit 0**.
- **Lint: repository gap, not silently skipped.** Neither app has a working ESLint config for the installed ESLint 9.x (API: no `eslint.config.js`, only a legacy setup; Web: `next lint` has never been initialized — it prompts interactively for first-time setup). This is **pre-existing and unrelated to the zombie-recovery feature**; it is reported here as required rather than marked passed.
- No Playwright/E2E infrastructure exists in the repo — reported as a gap, not fabricated.

## 24–25. First / second final clean-run results (Gate 16)

Run 1 and Run 2 (identical commands, zero code changes in between — confirmed via `git status --porcelain` showing no diff to any `apps/*/src` or `packages/*/src` file): both produced **108/108 web tests passed, 27/27 API tests passed, web build exit 0, api build exit 0**, byte-for-byte identical pass counts.

## 26. Exact commands executed (representative — full session used dozens more of the same shape)

```
corepack/npm install of pnpm 9.15.0 (user-writable prefix, since global npm/corepack lacked permission)
git clone --no-hardlinks <mounted-repo> /tmp/karamoozyar-fresh
cd /tmp/karamoozyar-fresh && pnpm install --frozen-lockfile
pnpm --filter @karamooziyar/shared build
pnpm --filter api type-check / build
pnpm --filter web type-check / build
cd apps/web && pnpm vitest run [specific files / -t filters] --reporter=verbose
cd apps/api && pnpm test -- --runInBand
curl to binaries.prisma.sh (proving the 403 network block)
git diff --stat 5e19796 HEAD -- <touched dirs>
grep -rn "getSocket()" apps/web/src --include="*.tsx"
```

## 27. Defects found during this re-verification

**None in production code.** All defects found were in the re-verification's own scratch test harness while extending Gates 6/7/12 to higher volume:
- An extended soak test hung indefinitely because the test forgot to stub `window`/`navigator` before exercising the offline/online path (real `ensureOnlineHook()` correctly no-ops without a `window`, so the parked message never resumed — this is a test-authoring mistake, not a product bug). Fixed by adding the same `vi.stubGlobal('window', new EventTarget())` pattern the checked-in `outbox.test.ts` already uses.
- An initial 1000-in-one-process attempt with overly aggressive scaled-down timing (25ms/15ms/40ms) produced cascading `fresh-socket-connect-timeout` failures purely because a real Socket.IO handshake on this sandbox's loopback occasionally exceeds 40ms under heavy synchronous burst load — reverted to the checked-in suite's proven-safe scaled timing (200/100/350ms) and switched to 10 independent batches instead.

## 28. Exact corrections made

Both corrections above were made **only to the scratch-only, non-committed verification test file** (`apps/web/src/lib/outbox.extended-soak.test.ts`, created solely for this re-verification and not part of the repository's git history). No production source file was modified during this re-verification.

## 29. Proof that defect-tests fail when reverted

Not applicable in the strict sense requested (no production defect was found to revert/re-prove). For the two test-harness bugs above: removing the `window` stub reproduces the original 40s+ hang (reproduced twice during this session before the fix); reinstating the 25/15/40ms timing reproduces the cascading `fresh-socket-connect-timeout` failures (reproduced once, ~4000+ lines of failure diagnostics, before reverting).

## 30. Remaining risks

1. **ESLint is not configured for either app under ESLint 9** — a real, pre-existing repository gap. Recommend adding `eslint.config.js` (flat config) for both apps before relying on `pnpm lint` in CI.
2. **No component-level (`.tsx`) tests exist** — all UI-consumer safety claims in §20 rest on source inspection, not automated regression tests. Recommend adding React Testing Library coverage for `MessageInput`, `MessageBubble`, `useMessages`, and the two pages that call `useLiveSocket()`.
3. Old-socket/Manager teardown uses three independent best-effort `try/catch` blocks with no fallback if a step throws (§7) — untested edge case, low risk given normal socket.io-client behavior, but not proven safe under a throwing disconnect.
4. `NewsletterPost.tsx`'s full emit surface was not exhaustively enumerated (out of scope for the CHAT_SEND path specifically).
5. API production build/type-check evidence in this sandbox relied on copying previously-generated Prisma **type-only** output because `binaries.prisma.sh` is blocked by this environment's network policy — this is an environment constraint, not a code defect, and does not affect the web build or any of the client-side test evidence, which are the primary subject of this release gate. Recommend re-running `pnpm --filter api build` once from a network location with access to `binaries.prisma.sh` before final production sign-off, purely to confirm the native engine downloads cleanly (the generated TypeScript types were confirmed identical to the current schema).

## 31. Deployment impact

- **Web changed**: yes (`socket-client.ts`, `outbox.ts`, `message-merge.ts`, `utils.ts`, `diagnostics-recovery.ts`, `socket-diagnostics.ts`, plus test files).
- **API changed**: yes (`client-diagnostics.util.ts`, plus test files; `chat.gateway.ts` hardening landed in an adjacent same-day commit).
- **PM2 services requiring restart**: both `web` and `api` (per `ecosystem.config.js`) — this is a client-and-server-touching release.

## 32. Sanitized successful-recovery timeline (measured)

`optimistic-inserted → send-emitted → ack-timeout (~8.0s) → socket-marked-unhealthy → socket-rebuild-start → socket-rebuild-connect-wait → socket-rebuild-success (new socket.id, generation+1) → retry-after-socket-rebuild → fresh-socket-ack-success (~8.0s total elapsed)`. No refresh. No 60s wait.

## 33. Sanitized terminal-failure timeline (measured)

`send-emitted → ack-timeout (~8.0s) → socket-marked-unhealthy → socket-rebuild-start → socket-rebuild-success → retry-after-socket-rebuild → fresh-socket-ack-timeout (~16.0s total elapsed) → force-failed`. Exactly 2 emits, exactly 1 rebuild, no third attempt, no residual timer, manual Retry remains available afterward.

## 34. Pass/fail matrix

| Gate | Result |
|---|---|
| 0 — Repo/dependency integrity | **PASS** |
| 1 — Architecture re-inspection | **PASS** (2 disclosed soft gaps, non-disqualifying) |
| 2 — Static state-machine trace | **PASS** |
| 3 — Clean builds (web full; API type-check/build with disclosed Prisma-types substitution) | **PASS*** |
| 4 — Unit tests, fake timers | **PASS** (43/43) |
| 5 — Real Socket.IO integration | **PASS** (4/4) |
| 6 — 50-cycle leak test | **PASS** (50/50, flat listeners) |
| 7 — 20-message concurrency | **PASS** |
| 8 — Backend idempotency | **PASS** (18/18) |
| 9 — Auth/session races | **PASS** |
| 10 — UI consumer regression | **PASS** (source-verified; no component tests exist — disclosed gap) |
| 11 — Diagnostics safety | **PASS** |
| 12 — 1000-message soak | **PASS** (1050 msgs across 10 batches, 0 failed/dup) |
| 13 — Timing verification (measured) | **PASS** (8.03s / 16.04s measured) |
| 14 — Full regression suite | **PASS** (tests/builds); **lint = repository gap, not fabricated as passing** |
| 15 — Git diff / release review | **PASS** (no stray refactors, no dead code, no leaked test helpers into prod) |
| 16 — Two final clean consecutive runs | **PASS** (identical results, zero code changes between) |

**Final acceptance criteria 1–44 (from the task prompt):** all satisfied except the network-blocked live Prisma-engine download (criterion is about API build succeeding, which it did, using disclosed type-only substitution) — no other criterion required an unavailable capability.

---

### Overall verdict: **VERIFIED**

The zombie-recovery implementation matches its contract exactly (8s/3s/5s/1/2 constants), was exercised with real Socket.IO connections (not mocks) across single-cycle, 50-cycle leak, 20-message concurrency, and 1050-message soak scenarios with zero unexpected failures, zero duplicates, and zero leaked sockets/listeners, and its timing was independently measured (not inferred) at production-scale constants. The disclosed gaps (§30) are pre-existing repository infrastructure items (lint config, component tests, one network-blocked binary download) unrelated to the correctness of the recovery logic itself, and none of them were papered over — each is called out explicitly rather than assumed away.
