# Context residency audit — the static half

_Measured 2026-08-11 against `HEAD` = 9521ae3. Third pass in the series after
`skill-timing-optimization.md` (2026-07-11 → 07-21) and
`workflow-token-economics.md` (2026-08-04, PRD #2180)._

## What this pass is, and what it is NOT

`workflow-token-economics.md` § Next measurement sets the next pass's first
job: **compare realised deltas against the projections**, not produce a fresh
ranking. This document does **not** do that, and it is important to say why
rather than quietly substitute a different result.

The telemetry that pass ran on — `.claude/telemetry/tool-events.jsonl`, 188,639
events over 293 sessions — is **gitignored** (`.gitignore:46`). It lives only on
the machine that produced it. This audit was run in a remote container cloned
fresh from `origin`, where the same file holds **28 events from this session
alone** and `.claude/receipts/` does not exist. `bun run loop:scorecard --days
30` prints zeroes and says so.

So the programme splits cleanly in two, and only one half is answerable here:

| Half                                                                                       | Needs                      | Status                       |
| ------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------- |
| **Dynamic** — did #2184/#2189/#2190 land the projected −47.5 M? is gp `>150k` below 31%?   | local telemetry + receipts | **blocked** — see § Handover |
| **Static** — how much context mass does the repo itself impose, per session and per agent? | the repo at a commit       | **this document**            |

The static half has never been audited as such. Both prior passes measured
_behaviour_ (which agents, which tier, how many tool calls) and treated the
scaffold as a fixed ~14.7 k backdrop. It is not fixed: it grew 26% in the four
days before this measurement, and one file in it is 80% whitespace.

## Method

Sizes are `wc -c` at `HEAD`, exact and re-checkable. Tokens use the series'
**3.5 chars/token** divisor. One estimate carries a much wider error bar than
that and is flagged where it appears (§ The ADR index).

Cost model is inherited unchanged from the economics pass, and it is the reason
resident mass ranks above tool output:

```
input-equivalent = fresh × 1.0 + resident × 0.1     (cache_read = 98.9% of input-side)
```

A resident token is not paid once. It is paid on **every request, in every
context that carries it** — and the scaffold is carried by the main session
_and_ by every subagent it spawns. At the 1,587-subagent volume the 2026-07-21
scorecard recorded, the scaffold's multiplier is four figures.

## Measured: the resident scaffold

Loaded before the first user turn, in every session and every subagent.

| File                                   |      chars |       ~tok |
| -------------------------------------- | ---------: | ---------: |
| `CLAUDE.md`                            |     22,847 |      6,528 |
| `.claude/rules/gre-development.md`     |     16,535 |      4,724 |
| `.claude/rules/chrome-debug.md`        |      4,202 |      1,201 |
| `.claude/rules/frontend-components.md` |      1,233 |        352 |
| **Total**                              | **44,817** | **12,805** |

Two things about that number are new.

### It is 30% of every subagent's handed-in context

The 2026-07-21 drill-down established **median first-turn ctx = 43 k** for
general-purpose implement subagents and called it "healthy". It is healthy —
but 12.8 k of those 43 k is scaffold the subagent did not ask for and mostly
cannot use. An implement subagent working a UI ticket carries all 4,724 tokens
of `gre-development.md`; one working a GRE ticket carries `chrome-debug.md`,
whose own first line says "do not start Chrome by default".

### Glob-scoped rules are loading unconditionally

`gre-development.md` and `frontend-components.md` both declare frontmatter
globs (`convex/gre/**/*.ts`, `src/components/**/*.tsx`). CLAUDE.md documents
them as "Path-specific rules (auto-loaded)". **In this session both were
present in the system prompt before any file was read or edited** — 5,076
tokens (`16,535 + 1,233` chars) resident regardless of what the session
touches.

That is an observation about the harness this session ran under, not a proven
invariant across every Claude Code version — but it is the shape the cost model
should assume until someone checks the other direction, because assuming the
globs work costs 5 k tokens per agent when they don't, and assuming they don't
costs nothing when they do.

## Measured: regrowth

Every optimization in this series reduced the scaffold **once**. Nothing
prevents it growing back, and it is growing back faster than it was pruned.

```
CLAUDE.md      2026-08-07  18,124 chars
               2026-08-08  18,850
               2026-08-10  21,742
               2026-08-11  22,847      +4,723 chars (+26%) in 4 days = +1,350 tok resident
```

(Window limited to the 65 commits in this shallow clone; the true series is
longer and the trend is unlikely to be kinder.)

For scale: #2189's projected **−25.3 M input-equivalent** rested on pruning
~4,000 resident tokens. CLAUDE.md alone has since re-added ~1,350 — **roughly a
third of that win, eaten back in one week**, by prose documenting the gate
optimizations of #2431/#2433/#2447/#2452.

Where it went:

| CLAUDE.md section               |  chars | share |
| ------------------------------- | -----: | ----: |
| `### Quality gates (mandatory)` | 10,295 |   45% |
| `### Skills`                    |  2,055 |    9% |
| `### Development cycle`         |  1,830 |    8% |
| _everything else, 11 sections_  |  8,667 |   38% |

**One subsection is 45% of the most expensive file in the project.** Its
content is largely episodic — the benchmark seconds from the happy-dom swap
(`119.35s wall / 44.33s environment vs 180.05s / 113.03s`, `2207 passed both
ways`), file counts that change every week (692, 110, 252), and narrative
post-mortems ("a branch reached review with `validate.test.ts` red and a
`check:pr` that exited 0"). All of it is true, all of it is worth keeping, and
none of it needs to be re-read on every request of every agent.

This is exactly the category #2190 identified and removed from
`process-gh-issues/SKILL.md` ("episodic sections", 4,838 tok). **The same lens
was never turned on CLAUDE.md**, which is strictly more expensive than the
skill: the skill is paid by loop sessions, CLAUDE.md is paid by all of them plus
every subagent.

## Measured: the ADR index — the outlier

`docs/adr/README.md` is **207,433 chars**. CLAUDE.md tells every agent it is
"the queryable index"; the file's own first line says **"Read this first"**.

| Quantity                        |             Value |
| ------------------------------- | ----------------: |
| Total chars                     |           207,433 |
| **Space characters**            | **165,649 (80%)** |
| Non-space chars                 |            41,784 |
| Table rows                      |               103 |
| Median row's real Decision text |          73 chars |
| p90                             |       1,379 chars |
| Max                             |       1,919 chars |

The mechanism: ~10 rows carry a full ADR abstract — a 1,000–1,900 character
paragraph — inside an index cell. Prettier aligns markdown tables to the widest
cell, so **all 103 rows are padded to 1,919 characters**. One over-long entry
(ADR 0079) inflates the other 102 rows by roughly 160,000 characters of pure
whitespace.

**Token estimate, with its caveat.** At the series' 3.5 divisor this file is
59,267 tokens, but that divisor is calibrated on prose and BPE tokenizers merge
runs of spaces aggressively, so the true figure is lower — a defensible band is
**~20–30 k tokens, of which roughly half is padding**. The exact number does not
change the decision: even at the bottom of the band, the file CLAUDE.md points
every agent at first costs a fifth of a 100 k budget, and reformatting it to
one-line rows brings it to ~46,000 chars (~13 k) with **zero information lost**
— the long abstracts belong in the ADR bodies they were copied from.

It is also, by a wide margin, the only file with this pathology. Sweeping every
markdown file in the repo over 8 KB for >33% space content returns exactly one
hit: this one.

## Measured: the loop's per-invocation mass

| File                         |      chars |       ~tok |
| ---------------------------- | ---------: | ---------: |
| `process-gh-issues/SKILL.md` |     50,132 |     14,323 |
| `references/` (8 files)      |     47,785 |     13,653 |
| **Total**                    | **97,917** | **27,976** |

`SKILL.md` alone is **larger than CLAUDE.md** and resident for the whole loop
session once invoked. #2190's decomposition did land — the body went
64,865 → 50,132 chars (−23%, close to its 4,838-tok projection) — but the
material moved into `references/`, which is now 47,785 chars, and **the total
grew**. Progressive disclosure only pays when the references stay unread; two
of them (`subagent-brief.md` at 4,779 tok, `reviewer-brief.md` at 1,531) are
read on essentially every pass, so ~6.3 k of the "deferred" mass is in practice
resident. Whether the remaining 7.3 k is genuinely deferred is a **telemetry
question** — see § Handover.

The file grew again after the decomposition (45,559 → 49,921 chars on
2026-08-08, 50,132 today). Same regrowth signature as CLAUDE.md.

## Ranked levers

Ordered by measured mass × multiplier. Confidence is about the _saving_, not
about the measurement — the char counts are exact.

| #   | Lever                                                                                    |                  Mass freed | Multiplier                                      | Confidence                  |
| --- | ---------------------------------------------------------------------------------------- | --------------------------: | ----------------------------------------------- | --------------------------- |
| 1   | **Compact the ADR index** — one-line rows, abstracts back into the ADR bodies            | ~160 k chars / ~10–15 k tok | per read, every agent told to "read this first" | **high**                    |
| 2   | **Episodic-prose lens on CLAUDE.md** — `### Quality gates` → `.claude/rules/` or `docs/` |       ~7 k chars / ~2 k tok | resident × every request × every agent          | **high**                    |
| 3   | **A resident-mass budget with a gate test** — the project's own doctrine, unapplied here |           prevents regrowth | —                                               | **high**                    |
| 4   | **Make the glob-scoped rules actually scope** (or accept and shrink them)                |             up to 5,076 tok | resident × every agent                          | medium — depends on harness |
| 5   | **Re-decompose `process-gh-issues/SKILL.md`** against real read-rates                    |                 ≤ 7.3 k tok | per loop session                                | low — needs telemetry       |

### Why #3 is the one that matters most

Levers 1, 2 and 4 are each worth more tokens than #3. But this is the **third**
optimization pass in this series, and passes one and two both won and both
decayed — the scaffold is back to within 2 k of the 14.7 k that pass one
measured, and `SKILL.md` has regrown past its decomposition. A one-shot prune is
a payment against a bill that keeps arriving.

CLAUDE.md states the principle already: _"A rule that CAN be enforced
mechanically belongs in a script the gate runs — prose is the fallback for
judgment, not the home of invariants."_ Resident mass is mechanically
checkable — `wc -c` over a fixed file list, compared to a pinned ceiling. The
project has 41 guard tests in `scripts/__tests__/`, including
`action-space.test.ts`, written for #2189 to stop exactly this kind of drift in
the _spawn names_. It does not have one for the residency the same issue was
about.

Shape: a test asserting `CLAUDE.md + .claude/rules/**` stays under a ceiling set
just above today's post-prune figure, failing with the section table and the
instruction to move episodic prose out. Raising the ceiling stays possible — it
just has to be a commit someone signs, not a side effect of a doc edit.

## Cross-check: the five-layer map

The measurement above was made before reading the framing the user brought to
it — a widely-circulated thread (starmex, 2026-08-01) arguing that "prompt vs
context vs harness vs loop vs graph engineering" is not four competing
paradigms but **one stack of five layers, each wrapping the one below**, and
that the standing mistake is fixing the wrong layer. Its two operative rules:
_never skip a layer_, and _fix **down**, not up — a symptom at layer 4 usually
originates at layer 2_.

Mapped onto this project, the map is unusually flattering and the diagnosis
lands exactly where the measurement independently did.

| Layer         | This project                                                                                                                    | State                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **1 Prompt**  | Skill files, subagent briefs                                                                                                    | fine                                                                               |
| **2 Context** | Resident scaffold, skill bodies, `bun run cr`, ADR index                                                                        | **where the remaining waste is** — this document                                   |
| **3 Harness** | `.claude/hooks/` — `deny-guard`, `spawn-guard`, `receipt-guard`, `claim-ledger`; gate tiers; worktree isolation                 | done, and ahead of the article: "'be careful' is not a permission model" is a hook |
| **4 Loop**    | `bun run check:all` / `bun run test`; proof-of-failure doctrine; the identity-only-test purge (#2363)                           | done, and the strongest layer in the repo                                          |
| **5 Graph**   | `process-gh-issues`: file-disjoint batch → parallel implement (fan-out) → review in fresh context → serial merge-train (fan-in) | done, right-sized                                                                  |

Three things in the article are worth extracting; two are worth explicitly
**not** acting on.

### Worth extracting

**1. Its context budget is a direct indictment of the number above.** The
article's layer-2 table gives a "typical" and a "should be" for each line. The
one line it does not even flag as a problem is `System prompt + rules`:
typical 2,000 tokens, should be 2,000. **This project measures 12,805** — a 6.4×
overrun on the only budget line the article assumes nobody gets wrong. Its other
lines are already handled here: tool definitions load on demand (deferred MCP
tools + `ToolSearch`), and retrieval-not-dumping is exactly what ADR 0098 did by
vendoring the CR behind `bun run cr <id>` instead of fetching or pasting it.

**2. "Fix down, not up" is the ranking argument.** Layers 3, 4 and 5 have had
sustained investment here; layer 2 has had two passes that both decayed. The
article's decision tree exits at layer 2 for this project, and the lever list
above is a layer-2 list — no new machinery, no more nodes.

**3. Its layer-5 trap test retires a question rather than opening one.** _"Point
at each node and name the specialty that forced it; if deleting a node changes
nothing, it was decoration."_ Applied to the loop: implement, review (fresh
context, the one thing a single loop structurally cannot do) and merge-train
each survive. There is no graph work to do, which is a result — it removes the
temptation the article warns about.

### Deliberately not acted on

**Context editing is real but not ours to configure.** The article's third
layer-2 move — clear tool outputs once used, its own table's largest single line
(30,000 → 3,000) — maps exactly onto this repo's largest open behavioural
finding: general-purpose implement subagents whose context balloons from a 43 k
median first turn to a 228 k median peak purely on inline tool-call volume, 31%
of them past 150 k. The mechanism exists: **`context_management.edits` with
`clear_tool_uses_20250919`, beta `context-management-2025-06-27`.** But it is a
**Claude API request parameter on `client.beta.messages.*`** — a knob for
someone building an agent, not one Claude Code exposes to the repository it is
working in. Same for compaction (`compact_20260112`). So the fix stays where
the 2026-07-21 pass put it: **behavioural — don't generate the output in the
first place** (delegate mapping to an investigator subagent whose dumps stay in
its own context; pipe noisy `Bash` through `tail`). Worth knowing the mechanical
version exists one layer down, and worth not filing a ticket for it.

**Knowledge graphs are the article's own conflation warning, and it applies
here.** It spends a section separating "knowledge graph = layer 2, what the
model knows" from "agent graph = layer 5, how work is organised", and notes half
the online argument is two people agreeing about different things. This project
needs neither: there is no prose corpus to build entity-relation triples over —
the two things agents retrieve are a codebase (already structured, already
searchable) and the CR (already sliced by rule id). GraphRAG here would be a
layer-2 answer to a problem layer 2 does not have.

## Handover — running the dynamic half

These must run on the machine holding the telemetry, from a normal checkout:

```bash
bun run loop:scorecard --days 30 --json     # ships, review rate, tokens by role
bun scripts/agent-timing-report.ts --scorecard   # gp token share, ctx bands, >150k count
bun run usage:window --hours 24              # local burn proxy vs budget
```

Against them, in the order `workflow-token-economics.md` § Next measurement
fixes:

1. Re-measure its baseline quantities over the new window, same shape.
2. Realised delta beside each projection, **with the ratio stated**. The
   projections most likely to be wrong, in order: the prunable mass in #2189,
   the ~1.5 tool-calls-per-request ratio, the 105 k subagent median (n=24).
3. The 2026-07-21 success measure: **gp `>150k` share, baseline 340/1107 =
   31%**, with gp token share (78%) flat. That is still the largest single
   behavioural lever identified in this series, and the static half above does
   not touch it — median first-turn context is 43 k while median _peak_ is
   228 k, so the ballooning is inline tool-call volume, not scaffold.
4. Read-rates for `process-gh-issues/references/*` — resolves lever #5 and
   tells us whether #2190's decomposition is paying or just relocating.

**The static levers above do not need any of that to proceed.** Their masses
are exact, their multipliers are inherited from an already-measured cache-read
share, and nothing in the telemetry could make 165,649 characters of whitespace
worth keeping.

## Caveats

- **Char counts are exact; token counts are estimates** at 3.5 chars/token,
  ±10% on prose. The ADR index estimate is worse than that and is banded
  explicitly above.
- **Shallow clone (65 commits)** — the CLAUDE.md growth series is a 4-day
  window, not the full history. It establishes that regrowth happens, not its
  long-run rate.
- **The unconditional rule-loading observation is single-session.** It is what
  this harness did; it is not proven across Claude Code versions.
- **"Resident in every subagent" is inherited from the prior passes**, not
  re-verified here.
- **No claim is made about realised savings from #2180's programme.** That is
  the dynamic half, and it is blocked, not answered.
