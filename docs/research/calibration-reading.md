# The calibration reading: what it costs and how long it lasts (issue #10486)

> **Measured** 2026-11-22 on the development MacBook (Apple M1 Pro, 8 cores)
> while it was also the pipeline's runner (load average 11–15), bun 1.3.9
> (JavaScriptCore), on the tree of issue #10486's PR over base `e62f7295ca`.
> **Dated:** every number below is as of that tree and that day. Node, V8 and
> a browser's Worker were not measured: see Not measured.

**Question.** The vs-Bot field telemetry takes a calibration reading in the
Brain's Worker (`convex/gre/ai/calibration.ts`): units of the same fixed work
on a fixed board, until a time budget is spent. A consult posted behind a
reading waits for it. How long does a reading last, and what does it read on
code the engine has not compiled yet?

## What was wrong with the first design

The first design (issue #10451) ran one 8-iteration search under a 50 ms cap
checked between iterations. In a fresh process, at `e62f7295ca`:

| run | wall, ms | iterations completed | ms per iteration |
| --- | -------- | -------------------- | ---------------- |
| 1   | 67.8     | 4 (cut by the cap)   | 14.5             |
| 2   | 24.7     | 8                    | 2.93             |
| 5   | 13.7     | 8                    | 1.57             |
| 8   | 12.4     | 8                    | 1.46             |

The cold run overshot its cap by a third, building the board (4.5 ms cold)
and the root's read after the loop sat outside the clock, and a run the cap
cut covered fewer iterations of a search whose iterations do not cost the
same: a different workload. A device three times slower would be cut on every
reading, so two devices never compared.

## The unit

One unit builds the board and searches it for one iteration, root pick and
trace included. In a fresh process a unit costs:

| iterations per unit | first unit, ms | units 2–6, ms | steady (units 21–30), ms | rollout probes per unit |
| ------------------- | -------------- | ------------- | ------------------------ | ----------------------- |
| 1                   | 33.5           | 3.8–10.8      | 1.95–2.59                | 10                      |
| 2                   | 40.1           | 6.0–14.9      | 3.13–5.96                | 18                      |
| 4                   | 52.7           | 8.9–14.8      | 5.08–8.25                | 30                      |

One iteration per unit was taken: the smallest unit is the lowest floor on a
reading's length. The search does not mutate the board it is handed (checked
on 30 units), and every unit picks the same move.

## A reading: budget 25 ms, at most 16 units

Eight consecutive readings in each of three fresh processes:

| reading | wall, ms  | units | ms per unit |
| ------- | --------- | ----- | ----------- |
| 1       | 33.2–34.9 | 1     | 33.2–34.9   |
| 2       | 25.7–30.8 | 4     | 6.43–7.69   |
| 3       | 26.1–27.3 | 6–8   | 3.26–4.36   |
| 4       | 26.0–26.8 | 5–8   | 3.35–5.27   |
| 5       | 25.9–26.3 | 10–13 | 2.03–2.63   |
| 6       | 25.1–27.2 | 11–12 | 2.09–2.47   |
| 7       | 25.7–26.3 | 9–15  | 1.73–2.92   |
| 8       | 25.0–51.9 | 13–15 | 1.87–3.46   |

- **The bound.** A reading stops at the first unit that ends past the budget:
  it lasts under the budget plus one unit. Warm, that is 25–27 ms here; cold,
  one unit of 33–35 ms. One reading took 51.9 ms with 15 units of 3.46 ms:
  the machine took the process off the core. The bound is on the work, not
  on the wall clock of a busy machine.
- **One unit is the floor.** A device takes one unit whatever the budget
  says. On a device N times slower than this one, a cold first reading is
  about N × 34 ms and a warm one the budget plus N × 2 ms.
- **Cold code.** The first reading of a process is one unit of cold code, 15
  to 18 times the steady figure, and the reading reaches the steady figure
  around the fifth. The units count says so: 1, 4, 6–8, then 10 and more. A
  game takes three readings back to back and then one every 30 s, so its
  best reading (`calibration.min`) is a warm one in any game longer than a
  few turns.

## Not measured

- **A browser's Worker**, on any engine, and a phone. These are JavaScriptCore
  figures from a bun process; V8's and SpiderMonkey's compile tiers differ.
  The first production readings are the measurement: `calibration.first`
  beside `calibration.firstUnits`, by `device.engine`.
- **A Worker that has already searched.** Every figure above starts from a
  process that had searched nothing. In a game the first reading follows a
  real consult, so the engine's shared paths are compiled; the first unit
  should cost less than 34 ms there.
- **The wait a consult actually pays.** The driver posts its next consult no
  sooner than its 200 ms think beat after the board changes, so a consult
  should rarely find a reading ahead of it. The span's `calibrationWaitMs`
  is the field's reading of how often it does.

## Reproduce

```bash
# from the worktree; a fresh process per run
bun -e 'import { runCalibration } from "./convex/gre/ai/calibration.ts";
for (let i = 1; i <= 8; i++) { const t = performance.now(); const r = runCalibration();
console.log(i, (performance.now() - t).toFixed(1), r?.iterations, r?.msPerIteration.toFixed(2)); }'
```
