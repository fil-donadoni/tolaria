# Workflow throughput reset: 10 issues an hour over two machines (topology B'); a PR owes at `land` only what it can break and what costs seconds; ADR 0104 overturned, ADR 0136 and ADR 0131 amended

## Status

accepted — owner's decision of 2026-10-11, recorded by issue #5455 under
PRD #5454. **Overturns ADR 0104** (lane content is never diff-derived).
**Amends ADR 0136** §5 (partitions), §6 (cadence), §7 (cap) and the
`HEALTH_ONLY_GUARDS` rule of issue #4963. **Amends ADR 0131** (when a PR owes
a `check:ui` receipt). Leaves ADR 0116 (green-at-release) whole. **Amended
by issue #6149** (§ 11: the `full` lane's bot half is scoped by the walk). The rollout
is PRD #5454's tickets, issues #5456–#5471; until a ticket lands, the script
it names is the authority on what runs TODAY and this record on what a PR
OWES.

## Context

Tolaria is a study project with 0–5 users. Its verification apparatus was
sized for a bank, and the owner said so: "rilasci da applicazione bancaria per
un progetto di studio con 0–5 utenti". The target set that day is not up for
negotiation: **10 issues an hour landed over two machines running `loop:afk`**,
5/h per machine. The backlog is 431 `ready-for-agent` issues; at the measured
rate it drains in three weeks, at the target in 43 h.

### The measured state, 2026-10-11

Every figure below is re-derivable; the source is named beside it.

| Measurement                                        |                          Value | Source                                                        |
| -------------------------------------------------- | -----------------------------: | ------------------------------------------------------------- |
| PRs landed, 14 days                                |             ~18/day (0.8 PR/h) | `bun run telemetry:latency`, `gate_runs`                      |
| `/next-ticket` session, median wall                |                       35.4 min | `telemetry:latency` 2026-10-05 → 10-11, 120 sessions          |
| of which model                                     |                        5.2 min | same                                                          |
| of which tool                                      |                       25.4 min | same — almost all waiting on verification                     |
| `land` holding the heavy mutex, per PR             | 6.8 min (`check:pr` 378–525 s) | `gate_lock`, `~/.cache/tolaria/gate-runs`                     |
| batch health holding the mutex                     |       17–32 min/run, 1–4 h/day | `health_detach`, `.claude/telemetry/health/detach.log`        |
| health on 2026-10-04                               |   252 min, fired mostly by age | same — batches of 1–4 landings                                |
| PRs needing 2–6 `land` attempts                    |                           42 % | `gate_attempts`                                               |
| vitest reds at `land` that were bot-node byte pins |                       29 of 34 | `gate_runs` land logs — base drift, not the PR                |
| PR/h with 3 active sessions / with 5               |                    1.28 / 3.00 | `telemetry:latency` § PRs landed per hour, by active sessions |
| `check:ui` per PR                                  |      6.8 min, red 57 % of runs | `gate_runs`                                                   |
| `check:convex-heap` in health                      |                   9–17 min/run | `detach.log` — a 35k-card capacity question nobody asks today |
| lane fallback to `full`                            |      22 of 168 landings (13 %) | `telemetry:latency` § lane fallback rate                      |
| `docs:ship` behind a `land`                        |                         8+ min | observed 2026-10-11 — its merge queues on the heavy mutex     |

Two readings follow. **The model is not the bottleneck**: five minutes of a
thirty-five-minute session. **The heavy-gate mutex is the scarce resource**:
one machine's `land` holds it ~7 min per PR and health holds it for hours a
day, so the per-machine ceiling documented in ADR 0136 §7 (1.44 PR/h at cap 3)
is a property of the gates, not of the machine — the same report shows 3.0
PR/h in the hours five sessions were active. The per-machine health verdict is
a local file, so a second machine cannot read it.

### Topology B'

Two machines. The **MacBook** (M1 Pro, 8 cores, 16 GB) is the fast CPU people
wait on. The **Huawei** (Omarchy Linux, i7 4c/8t, 16 GiB, ~0.35× the MacBook
multi-thread) is a machine nobody waits on. The bench brief
`docs/research/huawei-gate-bench-2026-10-11.md` (PR #5448) decides how much of
health the Huawei carries; its § 5 table is binding (`test` ≤ 25 min → all of
health; 25–40 min → the `test` step only; > 40 min → crons alone).

## Decision

### 1. The principle

**A PR owes at `land` only what the PR itself can break and what costs
seconds.** Everything else is batch health's job, and batch health moves off
the machine where people wait. The budget per PR under the mutex: rebase +
resolver ≤ 0.5 min, lane ≤ 2 min, merge ≤ 0.5 min — ≤ 3 min, 20 landings/h of
capacity per machine.

### 2. The lane is scoped by the import graph — ADR 0104 overturned

`check:lane` runs the vitest tests **reachable from the diff through the
import graph** (vitest's changed-files mode against the base ref) for the
`engine`, `skin` and `cards` lanes, instead of whole projects or whole fixed
partitions. A lane still runs `tsc`, the diff-scoped prettier/eslint,
`cr:lint`, the cached drift guards (`check:index`, `check:stubs`,
`check:oracle`) and the cheap guards. **A test unreachable from the diff is
health's job**, and the full suite stays in batch health as the safety net.

ADR 0104's doctrine — "no lane scopes a project's tests to the diff: whole or
not at all" — is overturned, and this is why. The doctrine defended census
guards (a catalogue sweep notices what the diff did NOT touch). Its measured
cost was ~5 of the 7 mutex minutes per PR, on every PR, paid by every session
queued behind it; its benefit was a census red surfacing at `land` instead of
at the next health run, ≤ 2 h later at target cadence. The census guards do
not disappear: they run whole in health, every batch, and a census that costs
seconds rides the lane anyway (issue #4963). What ADR 0104 §3 keeps is
fail-closed admission: a path no rule places still forces `full`. ADR 0136 §5
(fixed partitions as the one permitted narrowing) is subsumed — partitions
remain how projects are organised, not the limit of what a lane may skip. ADR
0131's own exemption for `check:ui` becomes the general rule rather than the
exception.

### 3. Health-only guards grow by cost — ADR 0136 / issue #4963 amended

The ≤ 10 s lane budget is unchanged. Above it, three more guards join
`HEALTH_ONLY_GUARDS` with their measured costs: the **bot fast lane** (the
byte-identity pins that red on base drift, 29 of 34 lane reds), `check:bundle`
and `check:convex-bundle`. `check:convex-heap` leaves `HEALTH_SCRIPTS` for a
`maintenance` script run by hand.

### 4. `full` is a placement, not a fallback

A `package.json` diff is `full` only when `dependencies`, `devDependencies`,
`engines` or `packageManager` change; a scripts-only change is `engine`.
`.claude/**` non-prose (hooks, settings, skill scripts) is `engine` with the
tooling test project; `tolaria.config.json`, `.nvmrc`, `.prettierignore`,
`.gitattributes` are `engine`. The lane fallback rate in `telemetry:latency`
is the acceptance metric (13 % on 2026-10-11, every row a path above).

### 5. `land` sheds what nobody in the session waits for

The pre-lock preflight (issue #4967 / #4992) is removed: every recent run
printed `preflight skipped`, and the lane under the mutex is the one gate. The
GitHub-bound post-merge steps — `gaps:sync`, grammar residue, release claim,
umbrella detach — leave `land` for an hourly `housekeeping` cron that walks
the PRs merged since its last run. `land` keeps the landing record, the
primary fast-forward, the scenario seed, telemetry ingest and the health
detach. `land` and `release` stay on the MacBook in every bench outcome.

### 6. Cadence — ADR 0136 §6 amended

Batch health fires at the **20th landing since the last GREEN, or 8 h after
the first un-healthed landing** (was 10 / 4 h, issue #5235; before that 5 /
2 h). At target throughput that is one full suite per ~2 h, instead of runs
fired by age for batches of 1–4 landings. A failed vitest project is re-run
once before RED (11 % of reds were flaky). The bot refresh (`bot:reach`,
`seed:bot-findings`, `gaps:sync`) leaves health for a nightly cron; the
robustness and pick-agreement audits run weekly.

### 7. `check:ui` owed by glob — ADR 0131 amended

A `src/**` diff owes a walk only when it touches a stylesheet, a layout, an
overlay/portal, a z-index or a scroll-container file (a tested list in the
scope module). Otherwise the PR body says `no walk owed` and `land` accepts it.
What a walk covers when owed is ADR 0131's scoper, unchanged; `check:ui --all`
stays a release step (ADR 0131 amendment of issue #5378).

### 8. Session admission — ADR 0136 §7 amended

`sessions.cap` is **5 per machine**: the measured 3.0 PR/h at five sessions is
the default, not an escape hatch. The LLM cost per session is ingested into
telemetry so the API rate limit becomes a measured risk, not a surprise
`rate-limit` stop; `telemetry:latency` gains PR/h per machine and the land
mutex p50/p90.

### 9. Topology B' and the shared verdict

The MacBook keeps LLM sessions, `land` and `release`. The Huawei takes
everything nobody waits on: batch health, the nightly crons, the audits, the
`check:ui --all` release walk, against a self-hosted Convex deployment of its
own (ADR 0139's self-hosted path; scenario seeds stay on the MacBook's
deployment). The health verdict (GREEN / RED / infra, sha, step, machine, log
pointer) goes through a **verdict store** with two backends — the local file
of today and a **GitHub commit status on the gated sha** (`context=health`,
`context=ui-walk` for the advisory walk). `queue:plan`, `land`'s RED gate, the
loop's stop and `health:fix` read through the store on both machines; the
backend is configuration in `tolaria.config.json`. The Huawei runs a systemd
timer that polls `origin/<base>`, applies the cadence rule (the same pure plan
function) and writes the verdict; it never claims, lands or seeds.

The Huawei also owns the two crons: `tolaria-housekeeping.timer` (hourly,
`bun run housekeeping`) and `tolaria-nightly.timer` (nightly,
`bun run health:nightly`), units in `scripts/runner-units/` and install steps in
`docs/guides/huawei-runner.md` § The crons (issue #5592).

**RED across machines.** A RED on tip T blocks new picks on both machines and
refuses non-repair landings (`--red-ok` stands, issue #4964); in-flight PRs
land. A second RED on the same lineage stops the loop and notifies the owner.
A stale verdict (no verdict on any tip gated within `MAX_PENDING`) makes the
MacBook run one local health and notify. The Linux walk is advisory until a
calibration run reports identical Floors cell by cell. `release` re-proves the
exact tip on the MacBook as today — ADR 0116 is unchanged.

### 10. `docs:ship` pays the heavy mutex

CLAUDE.md said "seconds, no lock". `check:docs` is seconds and takes no lock;
the MERGE `docs:ship` performs runs inside `gate.ts heavy` (issue #2537) and
queues behind every `land` and health run — 8+ min on 2026-10-11. The
resident line now says so. The ticket that makes the lock-free reading true is
issue #5469: landing becomes asynchronous, one `land-runner` on the MacBook
merges, and `docs:ship` goes through the same runner.

### 11. The `full` lane's bot half is scoped by the import graph — amendment of issue #6149

`full` stays `check:pr` verbatim EXCEPT its bot half. Before, every `full`
diff paid the whole bot fast lane (352 files, ~122 s median at `land`) inside
`check:guards`, whatever it touched, while `engine` and `skin` ran none. The
reach of one changed file over the bot tests is lopsided: core engine modules
(state, card types, the interpreter, SBA, combat, the registry, any card set)
reach 94–95 %, `evaluate` 75 %, `search` 60 %, `game.ts` 7 %, a `src/`
component 0 %; over 328 non-docs commits from 2026-10-06, ~64 % reach under
10 % of the bot tests and 33 % nearly all.

So the lane runs `check:pr:app` — `check:pr` with `check:guards:app` in
`check:guards`' place, both pinned text-for-text to the scripts they cut — and
then ONE `vitest(bot)` step over the `bot-node` / `bot-dom` files the §2 walk
reaches (`botTests` mirrors the two projects, pinned file by file), with the
same `CENSUS_TESTS` admission for a bot test that reads its corpus through
`fs`. It runs the bot fast lane **whole** when a path is a Bot input — under
`BOT_GLOBS` or in the Bot hash, where the Bot doctrine owes the whole lane and
a budget or a term moves pins no import edge points at — or forces `full` on
its own (dependencies, test/type/build configuration, the vitest setup files
the walk never enters, an unrecognised path). Nothing reached is a skip line
naming health. The walk costs ~1.5 s, and only a `full` diff that touches no
Bot input pays it.

§3 still holds for `engine` and `skin`: their bot half is health's, because
the byte-identity pins red on base drift there. A `full` diff already owed the
bot lane; this amendment narrows what it owes to what it can break, which is
§1's rule. What would change the answer: health REDs on bot tests the scoped
half skipped, landing after landing — the fix is a `CENSUS_TESTS` row or a
wider force-whole predicate, never the whole lane back on every `full` diff.

## Consequences

- **Overturned / amended records.** ADR 0104 carries a superseded-by note;
  ADR 0136 and ADR 0131 carry an amendment pointer to this record. ADR 0136's
  numbers (cap 3, 10 landings / 4 h, `node-engine` whole in the `engine`
  lane) are history, not norms.
- **CLAUDE.md § Quality gates and `docs/agents/quality-gates.md`** are
  rewritten to the scoped lane, the 20 / 8 h cadence, the health-only guards
  by cost, the shared verdict and topology B'; the "knee at 3" derivation is
  replaced by the per-machine PR/h row.
- **Residual risk, stated plainly.** A census guard the diff cannot reach
  (a catalogue sweep, a barrel-mock drift, a `dom` layout guard) reds the base
  tip at the next health run instead of refusing the PR — ≤ 20 landings or 8 h
  later, fixed forward under ADR 0116's RED marker. At 10/h that can be a
  handful of landings on a red tip before the verdict arrives; the owner
  accepts it (user story 20 of PRD #5454): block new picks, let in-flight
  landings finish, repair fix-forward, never revert seven PRs.
- **Tests pin plans and verdicts, never timings**: the lane plan per diff
  (`check-lane.test.ts`), the cadence decision (`health-cadence.test.ts`), the
  store round-trip (`health-verdict.test.ts`), the owed-by-glob predicate
  (`ui-scope.test.ts`). Wall-clock claims go to `telemetry:latency`.
- **Acceptance is measured**: land mutex p50 ≤ 3 min and ≥ 4 PR/h on the
  MacBook after Phase 0 (issues #5456–#5460, #5464); ≥ 5 PR/h per machine over
  a 24 h window after Phase 1 (issues #5461–#5471). The API budget is the
  binding constraint behind the machines — a `/next-ticket` session measured
  ≈ 12.8 M cache-read tokens on 2026-10-11 — and asynchronous landing (issue
  #5469) is the first lever on it.

## Measured after Phase 1

Issue #5471 closes the rollout. Each row is filled when it is measured.

### Walk calibration, 2026-10-14

Both machines ran `check:ui --all` on the same tip, `aa0a38197638`, which the
Huawei's health runner had gated GREEN.

| Machine          | Result                                                     | `verdict-sha256` |
| ---------------- | ---------------------------------------------------------- | ---------------- |
| MacBook (darwin) | PASS, 68/70 surfaces measured, 2 declared unwalked (#3506) | `0e5ba6d8a77d…`  |
| Huawei (linux)   | PASS, 68/70 surfaces measured, 2 declared unwalked (#3506) | `0e5ba6d8a77d…`  |

`bun run ui:calibrate <macbook> <linux>` reported
`identical — 340 cell(s), 0 divergent` and exited 0, so `ui-walk.gating` is
now `true` and a Linux walk gates the health verdict (§ 9).

There are two caveats. The MacBook backend served the primary checkout's
functions at `00aebfc4`, not the tip's; the Huawei served the tip. The Huawei
walk needed `--parallel=2`, because at the default five lanes the lane
account's sign-in fails under load (auth backend, not a Floor). The run took
1637 s.

### Throughput, 24 h window

Still owed (issue #5471, step 4): PR/h per machine, land mutex p50/p90, health
mutex min/day and attempts/PR from `bun run telemetry:latency` after 24 h of
`loop:afk` on both machines.

## Alternatives considered

- **Topology B — every gate on the Huawei.** Rejected: at ~0.35× multi-thread
  a lane is 7–9 min and the whole pipeline lands ~5/h; `land` stays on the
  fast CPU in every bench outcome.
- **A paid remote runner** (GitHub Actions minutes, a VPS). Rejected: the same
  Convex reachability problem as the Huawei, €30–170/month; revisit only if
  the Huawei saturates.
- **Keep ADR 0104, cut elsewhere.** Rejected by the numbers: the whole-project
  doctrine was ~5 of the 7 mutex minutes per PR, and no other cut reaches the
  3-minute budget.
- **Health after every landing / a heavier `land`.** Rejected again — ADR 0116
  and ADR 0136 already measured it (213 mutex-minutes a day, 19 % RED mostly
  from contention).
- **Changing what `release` proves, the review round, proof-of-failure or the
  preset-scenario prose.** Out of scope: model time is 5 min median and not
  the bottleneck; green-at-release stays whole.

## What would change the answer

A health RED rate that climbs because the scoped lane misses what whole
projects caught, measured as REDs per landing over a window, would argue for
widening ONE guard's lane admission (issue #4963's rule: if it costs seconds,
it rides) — not for restoring whole projects. A Huawei `test` step over 40 min
on the bench leaves health on the MacBook and sends only the crons away (§ 5
of the bench brief). An API rate limit hit at the target cadence changes the
session, not the gates: asynchronous landing, context diet, a second account.
