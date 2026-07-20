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

## Session 2026-07-19 — telemetry read + 3 levers applied

Ran the report over the accumulated log: **55.669 events, 113 sessions, 499
Agent calls, 88 Skill calls.**

### What the data said

- **Model routing leak, quantified.** Of 499 subagent spawns, 137 passed no
  explicit `model` (logged `null`). But `null` ≠ leak: `cavecrew-*` pin their
  model in frontmatter (haiku), so 26 of those are safe. **True leak = 111**
  read-only/mechanical agents that inherit the session tier: `general-purpose`
  61, `Explore` 30, `fork` 18 (fork _always_ inherits parent — not
  controllable), +2. Wall-time by model: opus 3883s/n=186, sonnet 2635s/n=171,
  inherited 526s/n=130.
- **Token attribution was blind.** Only 6 of 55k events carried `tokens` — the
  hook's `.tool_response.totalTokens` path is correct but the harness only
  started emitting the field recently. Inspecting a live transcript, the Agent
  `toolUseResult` actually exposes `resolvedModel, totalTokens, totalDurationMs,
totalToolUseCount, usage` — `resolvedModel` is the ground truth that ends the
  "is `null` a leak?" guessing entirely.
- **"Whole-codebase context" is a myth.** The codebase is not auto-loaded.
  Always-on scaffold ≈ **14.7k tok** (CLAUDE.md + 3 rule files + MEMORY.md
  index), and it is prompt-**cached** → ~free per turn after the first. The 70
  memory files (36.8k) load only on recall. The real token sink is (a)
  expensive tier on read-only subagents and (b) linear main-context growth over
  a long session (every tool result stays resident until `/clear`/compaction).

### Levers applied

1. **Lever 4 — telemetry now measures reality.** `timing-log.sh` captures
   `resolved_model`, `out_tokens`, `dur_ms`, `tool_uses`.
   `agent-timing-report.ts` prefers `resolvedModel`, prints `[inherited]`, and
   flags `⚠ model LEAK` when a read-only agent (`Explore`/`general-purpose`)
   with no explicit model resolved onto an opus/fable tier. Legacy events show
   `?(pre-resolvedModel)`.
2. **Lever 1 — model routing.** `cavecrew-builder.md` pinned `model: sonnet`
   (was inheriting; `investigator`/`reviewer` already haiku). New CLAUDE.md
   rule "Subagent model routing (cost)": spawn `Explore`/`general-purpose`
   read-only work with `model: sonnet`, reserve the session tier for hard
   reasoning.
3. **Lever 3 — scaffold trim (low ROI, confirmed).** Collapsed the CLAUDE.md
   Chrome section (28 lines) that fully duplicated the auto-loaded
   `chrome-debug.md` rule → pointer. Net CLAUDE.md −49 tok after adding the
   routing rule. **Did NOT touch `gre-development.md`**: normative, CI-guard-
   referenced, path-specific, and cached — risk > marginal benefit.

### Real remaining win (behavioral, not mechanical)

Levers 1+4 attack model tier + measurement. The bigger lever left is **main-
context discipline**: delegate reads/mapping to subagents (their file dumps
stay in the subagent; only the compressed report returns) and `/clear` between
unrelated tasks. This is the linear-growth sink, not the cached scaffold.
Re-run the report after a few real skill runs and confirm zero `⚠ LEAK` rows.

### Quality-vs-cost mitigation (applied)

Over-routing sonnet is safe for **correctness** (opus reviewer + full merge-train
gate + catalogue guards `validateEffectScript`/mechanicsRegistry/triggerDedup/
serialize-drift are all model-independent and block red at the train). The
residual exposure is **design** — a diff-review is weak at catching a wrong
abstraction from a cheaper implementer. Mitigation: `/to-tickets` now stamps a
`model:*` label by a complexity heuristic **at creation** (where design context
is freshest), surfaced in its quiz for user veto:

- `model:opus` — new Op / primitive / cross-layer interaction / pattern later
  tickets copy. `model:fable` — architecture-setting only (rare). No label ⇒
  Sonnet default (DSL reuse, localized fix, refactor, tests). Human-decision
  cases → HITL / `needs-design`, not a model label.
- Verified: labels `model:sonnet|opus|fable` + `needs-design` exist on the
  tracker; `/process-gh-issues` §156/§282 routes implement + fixup + conflict
  handbacks by the label, defaulting to Sonnet when absent.

Not applied: reviewer-driven escalation (opus reviewer flags a design concern →
forced `model:opus` handback) — option (b), deferred as redundant now that (a)
puts the tier decision at creation.

## Reframe from the built-in usage report (past days)

Claude Code's own usage analytics reshaped the priority: **79% of usage =
`general-purpose` subagents; Explore 1%, fork 1%; 64% of usage at >150k
context; 96% subagent-heavy.** Cross-checked against our log: general-purpose =
84% of spawns, requested-model split opus 186 (mostly the fixed reviewer) /
sonnet 174 (implementers) / null 61 (mostly non-implement). **The tier is
already ~right** — the leak we chased (Explore/fork) is 1–2% and negligible.
The real cost driver is **context length × volume** of long-running
general-purpose implement subagents, expensive even when cached.

Implication: sonnet routing (Lever 1) was a small win. The bigger lever is
**context discipline**, which our changes barely touched. Actions:

- **Telemetry now captures context size** (`in_tokens` + `cache_read` +
  `cache_write` → `context`, report flags `ctx=NNk⚠` above 150k and totals the
  band). This reproduces the report's key metric per-subagent — the scorecard
  for whether context actually drops.
- **Reviewer stays opus for all PRs** — considered tying review tier to the
  issue's `model:*` and rejected: the strong-reviewer-over-cheap-implementer
  asymmetry is the exact safety net that makes sonnet-implement safe; cheapening
  review for sonnet issues removes the guard where it's most needed.
- **Real levers (context, not tier):** keep implement slices small enough to
  finish under ~150k (to-tickets already mandates "single fresh context
  window" slices — enforce it); hand subagents less context; prefer
  `cavecrew-*` (haiku + compressed output) for read-only over general-purpose;
  spawn fewer, more deliberately.

### Reviewer = "Cassazione": correctness/rules, NOT design — and mostly irreducible

The §3b reviewer prompt mandate (process-gh-issues §164) reports **only** (a)
real bugs, (b) CR-correctness violations, (c) codified project-rule violations
(primitive reuse, type sourcing, one-component-per-file, test quality, missing
mandatory coverage) — `no scope creep`, so it does **not** re-judge design or
architecture. Design is decided upstream (the issue/PRD + `model:opus` routing
at creation). So on a Sonnet-implemented card the reviewer's value is the
**correctness backstop — exactly where a cheap implementer needs it most.**

**Retracted (was proposed above): a DSL-reuse light lane skipping review.** It
was justified by "DSL-reuse cards have no design space" — wrong premise: the
reviewer isn't a design check anyway. Skipping review for Sonnet cards removes
the correctness net precisely where it earns its keep. The existing `migration`
light lane (§168) is safe only because a hand-written behavioural test kept
byte-for-byte green is a **machine proof** of equivalence; the DSL-reuse smoke
test is **auto-generated from the card's own declared outcomes**, so it proves
the card matches its declaration, not that the declaration is correct — no
equivalent proof, so DSL-reuse does not qualify.

Consequence: the opus reviewer is now the per-issue cost **floor** and is
largely **irreducible** — it is the price of running cheap implementers safely.
Tier stays opus. Net per-issue saving remains positive because implement (the
larger task) went to Sonnet; the reviewer is the insurance that makes that shift
safe, not a cost to cut.

**Do NOT trim the reviewer's context (user decision, 2026-07-20).** An earlier
note here proposed shrinking what the reviewer reads to save cost — rejected.
Priority is a non-myopic reviewer over a cheap one: §164 now **mandates** the
reviewer actively pull whatever context a judgment needs (grep the primitive to
reuse, open callers/callees, read the CR rule, follow types, walk the reducer,
read the required test) and forbids approving/blocking on assumption when the
answer is one search away. A shallow backstop is worse than none. The reviewer's
cost is accepted as the price of correctness; context is spent, not saved, here.

**Success measure:** this report is the pre-change **baseline**, not a verdict.
Re-pull it after a week of real runs and compare (1) general-purpose token
share, (2) % usage >150k, (3) `resolved_model` distribution (zero `⚠ LEAK`).

## Uncommitted files (as of 2026-07-11)

`.claude/settings.json`, `.claude/hooks/timing-log.sh`,
`scripts/agent-timing-report.ts`, `.gitignore` (telemetry entry),
`.claude/skills/new-card/SKILL.md`, `docs/agents/skill-timing-optimization.md`
(this doc). Global skill edit lives outside the repo:
`~/.claude/skills/process-gh-issues/SKILL.md`.
