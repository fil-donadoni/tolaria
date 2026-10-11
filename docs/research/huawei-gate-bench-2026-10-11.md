# Huawei gate bench — can the second machine carry the batch gates?

Date: 2026-10-11. Status: **measurement brief, results pending** (§ 4 is
filled in by the instance that runs it).

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
| `check:pr`       | 378–525 s   |              |              |          |                     |      |
| `test`           | ~600 s      |              |              |          |                     |      |
| `check:all`      | ~150 s      |              |              |          |                     |      |
| `check:ui --all` | ~1140 s     | —            |              |          |                     |      |
| `health`         | 1000–1900 s | —            |              |          |                     |      |

CPU model (from `lscpu`): _…_
`bun run machine` at idle: _…_
Steps that could not run, with the verbatim error: _…_
Throttling observed (run 2 slower than run 1, or temperature ≥ 90 °C): _…_

## 5. How the numbers decide

| `test` on the Huawei | Verdict                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| ≤ 25 min             | B' confirmed: batch health, nightly bot refresh, release walk and audits move there       |
| 25–40 min            | B' with a thinner health (the `test` step only, `check:ui --all` kept on the MacBook)     |
| > 40 min             | Huawei takes only the nightly crons (`bot:reach`, `gaps:sync`, audits); health stays here |

`check:pr` matters less: `land` stays on the MacBook in every outcome. It is
measured because it is the one number that says what a PR lane would cost
if the Huawei ever had to land anything.
