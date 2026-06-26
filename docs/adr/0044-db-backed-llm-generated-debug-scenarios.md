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
