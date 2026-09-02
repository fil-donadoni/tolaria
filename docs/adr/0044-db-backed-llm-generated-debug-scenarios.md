# DB-backed, LLM-generated debug scenarios

## Status

accepted

## Context

Debug scenarios — preset board states loaded one-click from the Debug panel to
exercise a card or interaction — live as a single `PRESET_SCENARIOS: PresetScenario[]`
literal in `src/components/debug/debug-panel.tsx`. That array has grown to ~8,300
lines (the file is 8,500), making it the **second-largest monolith after a set
file** and the **highest-frequency merge-conflict point** in the repo: CLAUDE.md
§ Development cycle step 7 mandates a new scenario per feature, so _every_
mechanic cluster appends to the same array at the same region. In the move toward
a parallel agentic loop (ADR 0043 + merge-train), this single shared array is the
one file touched by 100 % of feature work — the worst serializer after the engine
registries.

Most scenarios are **single-use**: created to eyeball one card during
development, never reloaded. They are pure _data_ — an array of card placements
(`{ name, owner, zone, tapped, counters, damageMarked, faceDown, … }`) plus
global setup (phase, active player, life, mana). The code that turns that spec
into a `GameState`, `debugSetupScenario` in `convex/game.ts`, is the load-bearing
part; the literal is just its argument.

## Decision

**Scenarios become rows in a Convex table, not a code literal.** The spec moves
out of `debug-panel.tsx` into a `debugScenarios` table; the panel lists scenarios
from a query and passes the selected spec to the **existing, unchanged**
`debugSetupScenario` builder. `debug-panel.tsx` drops from ~8,500 to ~200 lines.
The builder stays in code — only its _argument_ relocates to the DB.

**The Debug panel gains an LLM generator.** A textarea takes a natural-language
board description — e.g. _"Mishra's Factory with the lands needed to animate it;
opponent holds Shatter and has 2 Mountains in play"_ — and an LLM produces a
scenario spec, which is stored and immediately available as a preset. Generation
runs in a **Convex `action`** (or a client-side fetch), **never inside a
mutation**: a mutation is deterministic and cannot make the external API call.
The pipeline is three stages: `action` generates via **structured output** →
resolve/validate → `mutation` writes the row.

**Validation is loadability, not legality.** These are _debug_ states —
intentionally illegal positions (8-card hands, summoning-sick attackers) are the
whole point, so the engine's SBA/legality is **not** run on generated specs. The
only guard is that the spec **loads without corrupting state**: every referenced
card name resolves to a real `CardDefinition` id in the catalogue (validated
against `data/card-index.json`), and zones/fields are well-formed. An unresolved
card is rejected before write, with the error surfaced for edit — not silently
inserted. The LLM is given the catalogue lookup so it only picks implemented
cards.

**Store the resolved spec, plus the prompt as metadata.** The preset _is_ the
frozen, resolved spec (reproducible, deterministic on load). The originating
prompt is kept alongside it for "regenerate / vary" and to document intent — but
the prompt is never what gets loaded.

**Per-user, disposable, promotable.** Rows are scoped per user and ephemeral by
default. A scenario can be flagged "golden" (keep) or deleted. This relocates the
"too many scenarios" problem into the DB **on purpose** — there it is filterable,
flaggable, and deletable, which the code array never was.

**Dev/admin gating is inherited, not new.** The write path is the same
`debugSetupScenario` mutation used today; whatever gate guards it now guards the
DB path too — no new state-mutation surface is exposed to players. (Confirming
that gate exists is tracked separately; if it doesn't, that is a pre-existing
bug, not introduced here.)

## Consequences

- **Removes the 100 %-frequency conflict point and the #2 monolith** in one move,
  and retires CLAUDE.md step 7's mandated code churn (adding a scenario becomes a
  runtime DB insert, not a tracked edit) — a direct, large win for the parallel
  loop, on top of a smaller `debug-panel.tsx` transform/context.
- **Scenarios become data the type-checker can't see.** A later change to the
  spec schema or the builder won't be caught against old rows by `tsc` (unlike a
  code literal, which a refactor updates wholesale). Mitigated by disposability —
  a broken single-use row is deleted — and by a **tolerant builder** (ignore
  unknown fields, default missing ones); only the few "golden" rows warrant a
  version tag.
- **LLM nondeterminism is bounded** by storing the resolved spec, not by
  re-running the prompt. Re-running the prompt yields a _new_ scenario; the saved
  one never drifts.
- **A new external dependency and key** (the LLM API) enters the dev tooling,
  with cost/latency — acceptable for a dev-only feature, kept off the player path
  by the inherited gate.
- This is a **feature in its own right** (table + generator action + validation +
  UI), implemented under its own PRD, independent of the ADR 0043 set
  decomposition.

## Amendment: the registration step had no owner, and now it is a script (2026-09-02)

This ADR settled WHERE a scenario lives (the DB, deployment-local) and CLAUDE.md
§ Development cycle step 7 settled WHO writes it: a headless agent emits
`{ label, spec }` in the PR body, and **"the orchestrator registers it
post-merge"**. ADR 0110 then retired the orchestrator — `/process-gh-issues`'s
fan-out became `/next-issue`, one session per issue — and the replacement skill
never inherited the registration step. Nothing else picked it up: `land`,
`pr-merge` and `check-lane` did not mention scenarios at all, so no gate ever
went red on a missing one and no code path ever performed the insert.

**Measured before fixing it** (last 200 merged PRs, against a `debugScenarios`
table holding 14 rows whose newest cited issue #2398):

|                                                      | count |
| ---------------------------------------------------- | ----- |
| carried a spec that was never registered anywhere    | 33    |
| carried a spec that **could not load**               | 12    |
| explicitly said none was owed                        | 26    |
| shipped a gameplay diff with no block and no decline | 39    |

The 12 unloadable ones are the sharper half. `normalizeScenarioSpec` is
deliberately fail-open — its own doc says it never throws and degrades a
malformed spec to an empty board — which is right for loading a row somebody
already saved and catastrophic as the only check before saving one. So the
corpus accumulated specs that would have loaded silently WRONG had anyone
loaded them: eight invented a shape the type does not have (`players: [{ seat,
battlefield }]`, a `combat:` block) and would have produced an empty board, and
four used `owner: "p1"` / `"opponent"`, which `normalizeCard` maps to `"me"` —
both players' cards piled onto one side.

**Decision.** The requirement moves out of prose and into the toolchain, per
CLAUDE.md § Skills ("a rule that CAN be enforced mechanically belongs in a
script the gate runs"):

- **`scripts/lib/scenario-block.ts`** is the ONE parser. It is tolerant about
  syntax (half the corpus fences a JS object literal, not JSON) and strict
  about anything that would load wrong — an unrecognised `owner` or `zone`, a
  spec that normalizes to fewer cards than it declared, an empty board.
- **`land` refuses pre-merge** when the landing diff touches
  `convex/cards/sets/**` or `convex/gre/**` and the body carries no block and
  no decline, and refuses ANY malformed block regardless of the diff. It sits
  beside the `check:ui` receipt refusal, which has exactly the same shape: a
  fact read out of the PR body that no other gate can see.
- **`land` seeds post-merge**, non-gating, in the primary checkout (a linked
  worktree has no `.env.local`, so no `CONVEX_DEPLOYMENT`). A missing local
  deployment must never turn a landed PR into a reported failure.
- **`bun run seed:backlog`** recovered the history: 33 registered, 0 rejected
  by the deployment. It stays as the re-runnable sweep (`seedScenarioDirect`
  upserts by label).

**Known imprecision, accepted.** `owesScenario` is path-based, so a
comment-only or rename-only change under `convex/gre/**` is asked for a
scenario it does not owe. The escape is one sentence in the section, which 26
PRs already write unprompted, and a narrow predicate that never fires would
have been worse than one that occasionally asks. The 39 silent PRs are reported
by `seed:backlog` and never acted on — a merged PR cannot be sent back for a
scenario.
