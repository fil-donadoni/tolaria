# Huawei gate bench — can the second machine carry the batch gates?

Date: 2026-10-11. Status: **measured 2026-10-12** (§ 4; issue #5463).
Machine setup: `docs/guides/huawei-runner.md` § Set up the Huawei for the
batch gates.

## 1. Why

The workflow reset of 2026-10-11 sets a hard target: **10 issues/hour over
two machines** (5/h each). Telemetry on the MacBook (M1 Pro, 8 cores,
16 GiB) over the last 14 days says the limiting resource is the heavy-gate
mutex, not the model:

| Measured on the MacBook        | Value                              |
| ------------------------------ | ---------------------------------- |
| `/next-ticket` session, median | wall 35 min — tool 25, **model 5** |
| `land` under the mutex         | 6.8 min avg; `check:pr` 378–525 s  |
| health offline phase           | 17–32 min/run, 2–10 runs/day       |
| health mutex time per day      | **1–4 h** (2026-10-04: 252 min)    |
| `test` (full suite)            | 10 min                             |
| `check:ui --all`               | 19 min                             |
| `check:convex-heap`            | 9–17 min                           |
| PRs landed                     | ~18/day ≈ 0.8/h                    |

The candidate topology ("B'"): the MacBook keeps the LLM sessions and the
latency-critical `land`; the Huawei (Omarchy, Intel i7 1.8 GHz, 4 cores /
8 threads, 16 GiB) takes everything nobody waits on — batch health, the
nightly bot refresh, `check:ui --all` at release, the robustness audits.
That only works if the Huawei finishes a health run in a useful time. Public
benchmarks put this CPU class at ~0.35× the M1 Pro on multi-thread work and
it throttles under sustained load, so the projection is **×2.5–3**, but a
projection is not a measurement. This brief is the measurement.

## 2. Ground rules for the measuring instance

- **Measure only.** No `queue:claim`, no `wt:new`, no `land`, no issue
  edits. The primary checkout on the Huawei is the bench; nothing is
  authored there except § 4 of this file.
- `bun run …` output goes to a file, never into a pipe (the `deny-guard`
  hook refuses the pipe; the exit code must be read from `$?`).
- Record `uptime` and the CPU temperature **before and after every step**:
  the throttling question is answered by the temperature, not by the
  wall-clock alone.
- Each step runs **twice**: the first run is cold (caches, tsbuildinfo,
  vitest cache), the second is the number we compare. Report both.
- Do not fight the environment for more than 15 minutes on any single step:
  record the error verbatim in § 4 and move on. A step that cannot run is a
  finding.
- When done: commit this file on a branch `research/huawei-gate-bench`,
  push, open a PR against `staging` with the title
  `research: Huawei gate bench results`. The MacBook lands it.

## 3. The steps

Set a scratch directory first and keep every log in it:

```bash
cd ~/code/mtg/tolaria          # or wherever the primary checkout lives
git fetch origin && git checkout staging && git pull --ff-only
bun install
S=$HOME/huawei-bench; mkdir -p "$S"
```

A helper for the two readings, used around every step:

```bash
probe() { echo "== $1 $(date +%H:%M:%S)"; uptime; cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | tr '\n' ' '; echo; free -m | sed -n 2p; }
```

### 3.1 Hardware and admission (1 min)

```bash
lscpu >"$S/lscpu.txt"; free -g >"$S/free.txt"; nproc >"$S/nproc.txt"
bun run machine >"$S/machine.txt" 2>&1; echo "exit=$?"
```

Note in § 4: the CPU model string, whether `bun run machine` reports the
same thresholds as the MacBook (`loadMax 8`, `waitMaxS 900`), and the
effective session cap it computes. Linux load averages count runnable AND
uninterruptible tasks, so the `loadMax` semantics differ from macOS — say
whether the probe looks sane at idle.

### 3.2 `check:pr` — the PR lane's worst case (expected 15–25 min, twice)

This is what a `full`-lane `land` pays on the MacBook (378–525 s).

```bash
probe before-check-pr >>"$S/probes.txt"
/usr/bin/time -v bun run check:pr >"$S/check-pr-1.log" 2>"$S/check-pr-1.time"; echo "exit=$?"
probe after-check-pr-1 >>"$S/probes.txt"
/usr/bin/time -v bun run check:pr >"$S/check-pr-2.log" 2>"$S/check-pr-2.time"; echo "exit=$?"
probe after-check-pr-2 >>"$S/probes.txt"
grep -E 'Elapsed|Maximum resident' "$S"/check-pr-*.time
grep -E '^ *Duration' "$S"/check-pr-2.log
```

Report: elapsed of both runs, peak RSS, the two vitest `Duration` lines
(bot projects, then node+dom), and the exit codes. A red run is still a
timing — note which test failed, do not fix it.

### 3.3 `test` — the full suite, the one step health cannot skip (expected 25–35 min, twice)

```bash
probe before-test >>"$S/probes.txt"
/usr/bin/time -v bun run test >"$S/test-1.log" 2>"$S/test-1.time"; echo "exit=$?"
probe after-test-1 >>"$S/probes.txt"
/usr/bin/time -v bun run test >"$S/test-2.log" 2>"$S/test-2.time"; echo "exit=$?"
probe after-test-2 >>"$S/probes.txt"
grep -E 'Elapsed|Maximum resident' "$S"/test-*.time
grep -E '^ *Duration|Tests ' "$S"/test-2.log
```

The heavy tier runs `min(ncpu - 1, 4)` vitest workers; on 8 threads that is
4 workers on 4 physical cores. If the second run is slower than the first,
the CPU throttled — the temperatures in `probes.txt` confirm it.

### 3.4 `check:all` — the static gate alone (5 min, twice)

```bash
probe before-check-all >>"$S/probes.txt"
/usr/bin/time -v bun run check:all >"$S/check-all-1.log" 2>"$S/check-all-1.time"; echo "exit=$?"
/usr/bin/time -v bun run check:all >"$S/check-all-2.log" 2>"$S/check-all-2.time"; echo "exit=$?"
probe after-check-all >>"$S/probes.txt"
grep -E 'Elapsed|Maximum resident' "$S"/check-all-*.time
```

### 3.5 `check:ui --all` — browser walk (expected 40–60 min, once)

Needs a local Convex deployment and Playwright's Chromium. Both are set up
once; both may fail on this machine — that is a finding, not a blocker.

```bash
bunx playwright install chromium >"$S/pw-install.log" 2>&1; echo "exit=$?"
bun run convex:ensure >"$S/convex-ensure.log" 2>&1; echo "exit=$?"
probe before-check-ui >>"$S/probes.txt"
/usr/bin/time -v bun run check:ui -- --all --serve=build >"$S/check-ui.log" 2>"$S/check-ui.time"; echo "exit=$?"
probe after-check-ui >>"$S/probes.txt"
grep -E 'Elapsed|Maximum resident' "$S/check-ui.time"
grep -E 'check:ui|RECEIPT|PASS|UNWALKED|INFRA|parallel' "$S/check-ui.log" | head -40
```

Exit 3 = deployment down (Convex could not be reached: record what
`convex:ensure` printed). A Chromium launch failure prints the install
command; if `bunx playwright install-deps` is needed it targets Debian
package names, so on Arch record the missing shared libraries from the
error instead and stop. Report the parallelism the lane chose (it prints
it) and the receipt banner.

### 3.6 Full `bun run health` (optional, only if 3.2–3.5 all ran; 60–90 min)

```bash
probe before-health >>"$S/probes.txt"
/usr/bin/time -v bun run health >"$S/health.log" 2>"$S/health.time"; echo "exit=$?"
probe after-health >>"$S/probes.txt"
grep -E 'Elapsed' "$S/health.time"; grep -E '^\[health|GREEN|RED|infra|step' "$S/health.log" | tail -30
```

This is the number the decision actually needs: wall-clock of one batch
health run on this machine. If 3.3 already exceeded 40 min, skip this and
say so — the projection from 3.2–3.4 is enough.

## 4. Results (filled in on the Huawei)

Reference column = MacBook M1 Pro, 8 cores, 16 GiB, load 2–9 at the time.

| Step             | MacBook     | Huawei run 1 | Huawei run 2 | Peak RSS | Temp before → after | Exit |
| ---------------- | ----------- | ------------ | ------------ | -------- | ------------------- | ---- |
| `check:pr`       | 378–525 s   | 1934 s       | 1525 s       | 3.43 GB  | 43 → 53 °C          | 1, 1 |
| `test`           | ~600 s      | 655 s ¹      | 589 s ¹      | 2.03 GB  | 53 → 59 °C          | 1, 1 |
| ↳ `test:bot`     | —           | —            | 510 s ²      | —        | 55 → 57 °C          | 0    |
| ↳ `test:blade`   | —           | —            | 1383 s ²     | —        | 57 → 57 °C          | 0    |
| `check:all`      | ~150 s      | 108 s        | 61 s         | 2.42 GB  | 56 → 57 °C          | 0, 0 |
| `check:ui --all` | ~1140 s     | —            | 880 s        | 2.40 GB  | 57 → 57 °C          | 1    |
| `health`         | 1000–1900 s | —            | skipped ³    | —        | —                   | —    |

Run on 2026-10-12, staging `a811f273c`, logs in `~/huawei-bench/` on the
Huawei. Temperatures are the hottest of the 13 thermal zones. Peak RSS is
`time -v`'s maximum resident set, the larger of the two runs.

1. **`test` stopped at `test:app`.** `test` is
   `test:app && test:bot && test:blade`; `test:app` went red (below), so
   the 655 s / 589 s are `test:app` alone (vitest `Duration` 651 s / 570 s,
   4 heavy workers).
2. **`test:bot` and `test:blade` timed separately**, once each, warm, via
   `gate:run` (elapsed from timestamps, so no peak RSS). The full chain is
   therefore **589 + 510 + 1383 = 2482 s ≈ 41 min**. `test:blade` alone is
   23 min: it runs on the light tier (≤ 2 vitest workers), 238 tests whose
   summed test time is 2598 s.
3. **`health` skipped** per § 3.6: the `test` chain exceeds 40 min, and
   three of 3.2–3.5 were red.

`check:pr`'s two vitest `Duration` lines (run 2): bot projects 565 s,
node+dom 885 s — both at the light tier's 2 workers. The same node+dom
projects take 570 s at the heavy tier's 4 workers (`test:app`, run 2), so
this machine scales with workers; during `check:pr` the 1-minute load
stayed ~2 of 8.

CPU model (from `lscpu`): `Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz`, 4
cores / 8 threads, 15 GiB usable RAM.

`bun run machine` at idle (09:04, before the first step):

```
machine — 8 cores, 15 GB (probes: sample 1 ms, session census 23 ms)
  load (1 min)     1.9  ·  max 8  ·  ok
  memory pressure  kernel level 1  ·  max 1 (normal)  ·  ok
  swap used        919 MB  ·  recorded, not a threshold (a high-water mark)
  reclaimable RAM  11384 MB (free + inactive)  ·  1900 MB per session
  sessions         2 live  ·  cap 5  ·  effective cap 5
  a gate start     is admitted (load 1.9, swap 919 MB)
  a claim/worktree is admitted (counted from this session: the others)
  process leases   4 registered (/home/fil/.cache/tolaria/leases)
  reaper           never swept on this machine — install it (docs/guides/huawei-runner.md § The reaper)
```

Same thresholds as the MacBook (`loadMax 8`, `waitMaxS 900` from
`tolaria.config.json`; `waitMaxS` is not printed). Effective session cap 5.
Idle load 1.2–1.9 with a desktop session and two Claude Code processes: sane
— Linux counts uninterruptible tasks too, but nothing here sat in D state.
The four leases are expired leftovers of `land` gate tests from 2026-10-11;
the reaper (issue #5470) is not installed yet, which is why nothing swept
them. `journalctl` (system and kernel), `systemd-inhibit --list` (three
`delay` inhibitors: NetworkManager, UPower, Omarchy lock — none `block`) and
`perl -v` (5.42.2) all answer.

Steps that ran red (timings stand; nothing was fixed, per § 2):

- **`scripts/__tests__/dashboard-actions.test.ts`, 2 tests, every run**
  (`check:pr` ×2, `test` ×2). Machine-specific: `scripts/telemetry-serve.ts`
  opens `.claude/telemetry/telemetry.db` at import when the file exists, and
  this checkout has one (written by `telemetry:ingest`), so the import
  reaches `bun:sqlite` under vitest's Node runtime:
  `Error: Cannot find module 'bun:sqlite'` at `scripts/telemetry-serve.ts:133`.
  A checkout without `telemetry.db` never takes that path. Any machine that
  runs `telemetry:ingest` in its primary checkout and then the full suite
  is red here.
- **`scripts/__tests__/dashboard-glossary.test.ts`, 3 tests, `check:pr` run 1
  only** (`every dimension/metric/fact table the server whitelists has a
human label`); green in the three later runs.
- **`check:ui --all`**: one cell of the walk failed, every other cell
  `PASS every floor at zero`, 67/70 surfaces measured (2 declared unwalked,
  issue #3506), viewport parallelism `5 of 5 at a time, 5 lane account(s) —
sized from 8 cpus and 15 GiB`, console errors none:
  `dlg-attack-all @ 390x844x3: assertion "confirm: Attack" — reachable
role=button name="Attack" — not actionable: click: Timeout 5000ms
exceeded.` Playwright's Chromium launched (the Ubuntu 24.04 fallback build;
  no missing library) and `convex:ensure` found the local backend serving.

Throttling observed (run 2 slower than run 1, or temperature ≥ 90 °C): **none.**
Every run 2 was faster than its run 1 (cache warm-up), and the hottest zone
never passed 59 °C.

### Reading against § 5

The full `test` chain is **~41 min: the `> 40 min` row, by 1.4 min** — on
its strict reading the Huawei takes only the nightly crons. Two facts move
the number, and both are tickets rather than a verdict:

- `test:blade` is 56 % of the chain and runs at the light tier's 2 workers on
  a machine whose idle load during the bench never passed ~2. On the heavy
  tier's 4 workers it would plausibly halve, which would put the chain in
  the `25–40 min` row.
- The `test:app` red above makes every Huawei health run RED until the
  `telemetry.db` dependency is removed from the test.

`check:ui --all` is _faster_ here than on the MacBook (880 s vs ~1140 s,
5-way parallel on an otherwise idle machine). `check:pr` is ~3–4× the
MacBook, the projection's upper end: `land` stays on the MacBook.

## 5. How the numbers decide

| `test` on the Huawei | Verdict                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| ≤ 25 min             | B' confirmed: batch health, nightly bot refresh, release walk and audits move there       |
| 25–40 min            | B' with a thinner health (the `test` step only, `check:ui --all` kept on the MacBook)     |
| > 40 min             | Huawei takes only the nightly crons (`bot:reach`, `gaps:sync`, audits); health stays here |

`check:pr` matters less: `land` stays on the MacBook in every outcome. It is
measured because it is the one number that says what a PR lane would cost
if the Huawei ever had to land anything.
