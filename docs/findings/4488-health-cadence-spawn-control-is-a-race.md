---
title: health-cadence-spawn CONTROL asserts a kill wins a race against a child's write — reds correct code under load
discoveredBy: 4488
status: draft
confidence: high
---

**What is wrong.** The CONTROL case of `scripts/__tests__/health-cadence-spawn.test.ts`
("the same work merely backgrounded IS killed") asserts that a marker file does
NOT exist after the parent's process group is killed. It is a negative
assertion on a race: the backgrounded child must be killed BEFORE it reaches
its write. Under load the kill is scheduled late, the child writes first, and
the test reds correct code. Observed 2026-09-24 at load 61 during the #4488
measurement (`bun run test`, `node-tooling` project); green 3/3 on re-run at
load 30 with nothing changed.

**Evidence.** The assertion is `expect(await waitFor(() => existsSync(doomed),
5_000)).toBe(false)` — the 5 s is how long it waits for the marker to APPEAR,
so raising a timeout cannot fix it: the failure is the marker appearing at all.
`docs/agents/quality-gates.md` § Timeouts are hang guards already records that
health runs sit at load ~21 and that load-red correct code in ≥10 of 23 RED
health runs; this test is that class in a shape the 30 s hang guard does not
reach. A red here in `health` leaves a durable RED marker, and `queue:plan`
refuses every session's pick until `health:fix` clears it — the blast radius
is the whole queue, not one PR.

**Why it may not deserve its own issue.** The case is a CONTROL, documenting
WHY `nohup … &` is not enough — it is not the guard for the detached spawn
itself (the other case is). The fix is small and local: make the child wait for
a signal (or a sentinel file) before writing, so the kill has nothing to race —
or drop the CONTROL and keep its rationale as a comment. Could be a line on a
tooling-tests tracker rather than a ticket.
