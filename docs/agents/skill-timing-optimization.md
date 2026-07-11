# Skill timing & token optimization — status doc

_Started 2026-07-11. Resume point for future sessions working on agent-loop
speed/cost. Related memories: `project-agent-telemetry`,
`project-loop-optimization-2026-07`._

## Problem

User-reported: `/new-card`, `/new-set`, `/process-gh-issues` runs take
**20–60 min** vs 2–10 min for the same ask given directly to Opus (perception,
no structured data — hence the telemetry below). Token consumption also very
high; suspicion that subagents were not running on cheaper models.

## Findings (2026-07-11)

1. **Model leak — confirmed.** 17 of 32 open `ready-for-agent` issues carried
   no `model:*` label, and `process-gh-issues/SKILL.md` said "no label → omit
   the `model` parameter (inherit session model)". Every unlabeled issue's
   implement/fixup subagent silently ran on the session tier (Fable/Opus).
   This was the main token sink.
2. **Full suite = ~2m20s wall** (7437 tests, 429 files; vitest `import` phase
   174s dominates — known permanent cost, see issue #811). Measured via
   background run, log in scratchpad `full-test-timing.log`.
3. **Gate arithmetic (old regime), batch of 4:** baseline suite + 4 per-issue
   full pre-PR gates + up to 3 merge-train re-gates ≈ **8 full suites ≈ 19 min**
   of pure test time per batch, plus `check:all` runs. Explains most of the
   perceived slowness.
4. **`/new-card` Step 8 waste:** skill mandated lockfile reset
   (`printf '[]' > data/card-index.json`) + full backfill = online refetch of
   all 1424 indexed cards from Scryfall per new card, even though
   `backfill-card-index.ts` is idempotent/incremental by design.
5. **`/new-set`** is interview-bound (grill, one question per turn, by design)
   — little to cut mechanically. Not touched.

## Changes applied (all live)

### `~/.claude/skills/process-gh-issues/SKILL.md`

- **`DEFAULT_IMPL_MODEL = sonnet`** (new Parameters entry): no `model:*` label
  → pass `sonnet` explicitly to the Agent tool. Never omit the param.
  Reviewer stays fixed `opus`.
- **Light pre-PR gate (§3 step 5):** subagents run only targeted tests +
  fast static checks (`check:ts` + lint). No full suite / `check:all` on the
  branch.
- **One full gate per landing tree, at the train (§4 step 4):** the merge-train
  runs the single full gate (`check:all` + full `bun run test`) per PR on the
  rebased tree that lands. The old no-op-rebase skip was removed (invalid now
  that pre-PR gates are light). Net: **2N−1 → N full gates per batch**.
- **Persistent green-SHA cache (§0):** after any full gate passes on `main`'s
  tip, write the SHA to `.claude/telemetry/green-sha`. Session start: tip ==
  file → skip baseline suite entirely (−2m20s/session).
- Header "Gate dedup" paragraph + Error-handling bullets updated to match.
- **Accepted trade-off:** a red only the full suite catches now surfaces at the
  train → fixup-subagent handback (max 3 attempts). Green-main invariant
  unchanged — the train is still the only merge point and always gates the
  landing tree.

### `.claude/skills/new-card/SKILL.md` (project)

- Step 8: **incremental backfill is the default** (`bun run
scripts/backfill-card-index.ts`, ~1 request per new card). Full reset+refetch
  only to purge pollution (indexed-but-not-implemented), which additive
  backfill can't remove. Checklist wording updated.

### Telemetry system (new, active from this session)

- `.claude/hooks/timing-log.sh` — appends one JSONL event per tracked tool call
  (pre + post) to `.claude/telemetry/tool-events.jsonl` (gitignored). Captures:
  ts, session, tool, `tool_use_id`, skill name, agent description/type/**model**
  (`null` = inherited session model — the cost trap), cmd head (160 chars),
  `run_in_background`, tokens when `tool_response` exposes them.
- `.claude/settings.json` (project, committed) — Pre/PostToolUse hooks,
  matcher `Task|Agent|Skill|Bash`.
- `scripts/agent-timing-report.ts` — `bun scripts/agent-timing-report.ts
[--last N] [--session id]`. Per-session breakdown: totals by kind, gate list
  (classified `gate:full-test` / `gate:check-all` / `gate:partial`), subagent
  durations + models (flags `INHERITED(session!)`), skill invocations. Pairs
  pre/post by `tool_use_id`, FIFO fallback.

## How to resume

1. Run `bun scripts/agent-timing-report.ts --last 5` — by now real skill runs
   should have accumulated. Compare gate time / subagent models against the
   baselines above (suite 2m20s; old regime ~8 suites/batch, new target
   ~N=4/batch + skipped baseline).
2. Verify subagent model routing in the report: no more
   `INHERITED(session!)` rows during `/process-gh-issues` runs.
3. Check `.claude/telemetry/green-sha` is being written/consumed by the loop.

## Next levers (not yet applied — decide with telemetry data)

- **Single gate per batch** (1 full suite instead of N): merge-train rebases
  all approved PRs sequentially, gates once on the final combined tree, merges
  all; on red, bisect to attribute. Biggest remaining time win; costs
  attribution complexity on red. Apply only if report shows train gates
  dominate.
- **Vitest cold-start** (~55–174s import phase) — profiling-first issue #811.
- **Skill prompt weight:** `new-card/SKILL.md` (~250 lines) + rules files are
  re-read into context every invocation; trimming/`caveman:compress` them cuts
  input tokens per run.
- **Session tier for inline skills:** `/new-card` runs inline → costs the
  session model. Running card batches from a `sonnet` session (or delegating
  the authoring step to a `model: sonnet` subagent) is the equivalent of the
  DEFAULT_IMPL_MODEL fix for inline skills.
- Bulk-labeling the 17 unlabeled issues is no longer needed (default covers
  them); labels remain the override for hard issues (`model:opus`/`model:fable`
  on architecture-setting work only, per `project-model-routing-labels`).

## Uncommitted files (as of 2026-07-11)

`.claude/settings.json`, `.claude/hooks/timing-log.sh`,
`scripts/agent-timing-report.ts`, `.gitignore` (telemetry entry),
`.claude/skills/new-card/SKILL.md`, `docs/agents/skill-timing-optimization.md`
(this doc). Global skill edit lives outside the repo:
`~/.claude/skills/process-gh-issues/SKILL.md`.
