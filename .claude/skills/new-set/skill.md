---
name: new-set
description: Drive a full MTG set rollout for the Tolaria engine — grill the design, write the PRD, cut the issues — with all standing conventions (CR-first, cluster split, primitive reuse, import pipeline) already baked in. Invoke as "/new-set <3-letter code>", e.g. "/new-set inv".
argument-hint: "<set-code>"
---

# New Set Rollout

Orchestrate implementing a whole MTG set, from `/new-set <code>` to a published
umbrella PRD + dependency-ordered cluster issues. This skill **sequences three
existing global skills** — `grill-with-docs` → `to-prd` → `to-issues` — and
injects the set context and the conventions we have already settled, so the
user never re-explains them.

`$1` (or the word after `/new-set`) is the **3-letter lowercase set code**
(`inv`, `tmp`, `usg`, …). If it's missing or ambiguous, ask for it — one
question — before anything else.

## What you already know (do NOT re-ask)

These are settled defaults. Apply them silently; escalate only on the stated
exceptions. They drive every recommendation you make during the grill.

1. **CR-compliance is the default — never ask whether to follow the
   Comprehensive Rules.** Implement behaviour exactly per CR; cite the CR
   section in code comments. Verify CR text first with `/mtg-rules-check`.
   Escalate ONLY when the CR is genuinely ambiguous, when intentionally
   simplifying/deferring (flag it), or when it's a design choice the CR doesn't
   dictate. (`feedback_cr_compliance_default`)
2. **Full, end-to-end card implementation — never partial.** Every clause of a
   card's Oracle text must be enforced. Do NOT propose "card data now, engine
   later" as a default. Any engine extension a card needs (primitive, target
   type, combat hook) is part of that card's work. All-or-nothing per card: if
   a clause needs a missing framework, build it in the wave or defer the whole
   card — flag, don't silently ship a stub as "done".
   (`feedback_full_card_implementation`)
3. **Primitive reuse over creation.** Before any new `SpellContext` /
   ability-context primitive: decompose into existing ones, generalize an
   almost-right one, check orthogonality (zone/mana/life operations, not
   card-shaped effects), compose rather than add boolean flags. Target ~80k
   cards — per-card primitives don't scale. Flag explicitly if a new primitive
   is truly unavoidable. (`feedback_primitive_reuse`)
4. **Modern Scryfall Oracle text, not printed/1994 wording.** Old sets are
   heavily errata'd. Always work from the live Scryfall `oracleText`; if the
   impl diverges from it, that's a bug in the impl. (`feedback_modern_oracle_text`)
5. **Fix the bug class, not the single card.** If a bug surfaces via one card,
   grep all `convex/cards/sets/**/*.ts` + the shared consumer for the same
   code-path shape, enumerate every affected card, and make the fix general —
   no per-card special-casing. (`feedback_fix_bug_class_not_single_card`)
6. **One question per turn while grilling.** Pose exactly one decision, state
   your recommended answer, wait for confirmation. A recap table of resolved
   decisions is fine; previewing upcoming questions is not.
   (`feedback_grill_one_step_at_a_time`)
7. **Decide autonomously when consistent.** Once a pattern is blessed, decide
   structurally-equivalent later cases yourself (state the shape briefly, decide
   it, log it in the recap). Escalate only on genuine divergence / a new axis /
   a broken invariant. (`feedback_autonomous_when_consistent`)

## Phase 0 — Scope the set (before grilling)

Explore, don't ask, for anything the data or codebase can answer.

1. **Get the set data.** The importer reads an MTGJSON blob at
   `data/json/<CODE_UPPER>.json` (e.g. `data/json/INV.json`). If it's missing,
   download it: `curl -s -A "Mozilla/5.0" -o data/json/<CODE_UPPER>.json
https://mtgjson.com/api/v5/<CODE_UPPER>.json`.
2. **Check for prior work — this set may be partially done.** A set can carry
   a pre-existing `convex/cards/sets/<code>/` directory (colour-split per
   ADR 0043: `white|blue|black|red|green|multicolor|colorless.ts` + an
   `index.ts` barrel) from an earlier rollout. You MUST treat it as the source
   of truth for what's already implemented and **never lose it**:
    - **`json-to-cards.mjs` OVERWRITES the whole `<code>/` directory** (every
      colour module + the barrel). Do NOT run it against an existing, non-empty
      set directory — it would clobber hand-written implementations. If the
      directory exists, import into a scratch path instead (e.g. import to a
      temp set code, then diff per colour module), and **only graft in the
      cards that are missing**.
    - Parse the existing colour modules: **active** `export const … :
CardDefinition` (and `CardPrint`) are implemented; **commented-out** stub
      blocks are capability cards staged earlier — uncomment them when their
      cluster ships, do not re-stub or duplicate them.
    - The set directory and the lockfile can disagree if the lockfile is stale
      — reconcile by running `bun run check:index` (and backfilling if it
      fails) so "done" reflects reality before you scope.
3. **Profile the set from the blob** (use `jq`): total unique cards, breakdown
   by colour, by rarity, and — critically — by **card layout** (`normal` vs
   `transform`/`modal_dfc`/`split`/`adventure`/`flip`/`meld`/`saga`/`leveler`/
   `class`). Unmodelled layouts are out-of-scope (ADR 0010 / ADR 0041).
4. **Triage every card into five buckets** — this IS the scope, and it must
   **skip everything already implemented** (resume-aware): - **done** — already implemented: an active def in one of the
   `convex/cards/sets/<code>/` colour modules OR present in
   `data/card-index.json` (lockfile). Excluded from all slices. (A partial
   `<code>/` directory with e.g. 3 cube cards and zero stubs is fine: those 3
   are `done` and excluded; everything else triages fresh. Run
   `bun run check:index` first so the lockfile already lists those 3 — that's
   what makes them count as `done`.) - **staged** — a commented-out stub already in a `<code>/` colour module from
   a prior run: its cluster PR only needs to _uncomment_ it, not re-create it. - **free** — expressible with already-shipped primitives/keywords. "Free"
   means no NEW engine capability, **not zero code** (many free cards still
   need a small bespoke `resolve()`). - **capability** — needs a genuinely new engine mechanic. Group these into
   clusters, one mechanic per cluster. - **out-of-scope** — unmodelled layout / ante / subgame. - **Closure invariant (compute it, don't just eyeball the report).** Emit a
   per-card **scope manifest** (every card name → its bucket) and assert
   `done + staged + free + capability + out-of-scope == total unique cards in
the blob`, with the buckets **disjoint**. If the sum is short, a card is
   unaccounted — find it before grilling. Report the counts (e.g. "187 cards:
   40 done, 12 staged, 110 free, 20 capability across 4 clusters, 5
   out-of-scope = 187 ✓"). This manifest is the **contract the whole rollout
   must satisfy at the end** (Phase 4) — persist it (PRD body / scratch file),
   it is not a throwaway tally. The ICE rollout skipped this and silently lost
   ~26 cards to bare `TODO` stubs with no tracking issue.
5. **Cross-check** each capability candidate against the engine — many
   mechanics already shipped (layers, replacements, complex triggers, APNAP).
   Flag a real gap explicitly; never assume "deferred". (`project_lost_cards_audit`)

## Phase 1 — Grill the design (`grill-with-docs`)

Invoke the **`grill-with-docs`** skill and run the interview, seeded with the
Phase 0 triage. Drive it toward these set-specific decisions (one question per
turn, recommended answer stated each time):

- **Cluster organization** — pick the axis explicitly with the user:
    - _Free tranche + feature clusters_ (default; DRK #409, LEG #369, ICE #628).
      Large reuse-only tranche first, split by colour for review-sized batches;
      then a small number of capability clusters, **one new mechanic each**.
    - _Thematic faction clusters_ (FEM #566) — when nearly every card belongs to
      a colour faction; reuse-only cards live inside their faction's cluster
      alongside that faction's new capability.
- **Cluster ordering** — by reuse × foundationality × risk. The cluster that
  mutates a player-state seam goes first (e.g. poison, the legend rule). A
  foundational primitive other clusters reuse precedes its consumers.
- **One new capability per cluster**, each with its own tests and — only if
  hard-to-reverse — an ADR (`grill-with-docs` offers ADRs sparingly).
- **Scope statement** — total card count, in-scope (default: whole set, zero
  deferral), out-of-scope (unmodelled layouts; ante/subgame per ADR 0010;
  3+ player). Niche 1-card clusters may be flagged trim-deferrable.
- **No new seam types** — confirm all changes ride existing test seams
  (`<code>.test.ts`, `gameProjections` wire-format, game.ts integration,
  `card-utils`/board, `serialize` round-trip). Enumerate any new `GameState`
  surface and register it in `PERSISTED_OPTIONAL_KEYS` / `TRANSIENT_KEYS`.

`grill-with-docs` updates `CONTEXT.md` inline as terms resolve and may create
an ADR under `docs/adr/` for a hard-to-reverse mechanic.

## Phase 2 — Write the PRD (`to-prd`)

Invoke **`to-prd`**. It synthesizes the grill context (does NOT re-interview)
into one **umbrella GitHub issue** labeled `prd` + `ready-for-agent`. Ensure the
PRD's **Implementation Decisions** name:

- The **import mode**: **set mode** (`bun scripts/json-to-cards.mjs
data/json/<CODE_UPPER>.json` → the colour-split `convex/cards/sets/<code>/`
  directory: 7 colour modules + `index.ts` barrel, ADR 0043) is the default for
  a single set. It runs under `bun` (it reuses the TypeScript colour helper
  `getColorsFromCost`), classifies each card by the colour identity of its mana
  cost (CR 202.2; lands / colourless artifacts → `colorless.ts`), and never
  emits a single monolithic file. (List mode — `scripts/list-to-cards.mjs` — is
  for cross-set worklists, not a single set.) If `<code>/` already exists
  (partial prior rollout), do NOT overwrite it — import to scratch and graft
  only the missing cards (see Phase 0, step 2).
- The emit contract: free cards → active `CardDefinition`s; capability cards →
  **commented-out stubs** (uncommented by their cluster PR so the build stays
  green); unmodelled layouts → out-of-scope, no stub.
- **Lockfile refresh as an explicit engineering story**: after import/wiring,
  regenerate `data/card-index.json` with
  `printf '[]\n' > data/card-index.json && bun run scripts/backfill-card-index.ts`,
  and `bun run check:index` must pass (the drift guard). Forgetting this breaks
  the gate loudly — that's the intended failure mode. (ADR 0041,
  `project_card_index_lockfile`)
- Multi-art note (ADR 0014): one `CardDefinition` per card + one `CardPrint`
  per artwork.
- **The Phase 0 scope manifest** (per-card bucket partition + the
  `done+staged+free+capability+OOS == total` tally) goes in the PRD body as the
  tracked rollout contract — `to-issues` reconciles against it, Phase 4 closes
  against it.

## Phase 3 — Cut the issues (`to-issues`)

Invoke **`to-issues`** with the umbrella PRD issue number. It splits into
**tracer-bullet vertical slices**, each end-to-end through all layers, demoable,
tagged HITL/AFK (prefer AFK), published in dependency order (blockers first).

Conventions to hold it to:

- **Walking skeleton first** (scaffold the `sets/<code>/` directory — 7 colour
  modules + `index.ts` barrel, per-colour `__tests__/` — plus registry wiring
  via `import * as <code> from "./sets/<code>"` + import), then free-tranche
  slices, then capability-cluster slices.
- Issue title conventions: free tranche → `[<CODE>] Free tranche — <Colour>`;
  cluster → `[<CODE>] C<n> — <capability> (CR <ref>)`
  (e.g. `[DRK] C1 — Poison counters + loss SBA (CR 122 / 704.5c)`).
- Cluster-issue body (model on DRK C1 #418): `## Parent` (→ umbrella) ·
  `## What to build` (end-to-end, no file paths) · `## Design decisions
(grill <date> → ADR NNNN)` · `## Acceptance criteria` (checkboxes, ending
  with "`bun run check:all` + `bun run test` green") · `## Blocked by` ·
  `## Related`.
- A card may ship (as a body/stub) before its cluster's mechanic and be
  corrected by the cluster PR — keep the build green throughout.
- **Every staged/capability card is named in exactly one cut issue.** Reconcile
  the published issues against the Phase 0 scope manifest: the cards listed
  across all issues must equal `staged ∪ free ∪ capability` exactly — no card in
  the manifest is missing from the issues, none appears twice. A card that's in
  no issue is the ICE failure mode; catch it here, not six months later.
- **Every commented stub carries a tracking tag.** When the walking-skeleton
  slice (or any cluster) emits a commented-out stub, the stub block MUST include
  an `// tracked-by: #NNN` line naming its cluster issue. A stub with no
  tracking tag is an orphan with no path to ever shipping — see Phase 4.

## Phase 4 — Coverage closure (the loud gate)

The scope manifest from Phase 0 is a contract; this phase makes violating it a
**build failure** instead of a silent hole. Two enforcement layers — wire both:

1. **`scripts/check-stub-coverage.ts`, in `check:all` (`bun run check:stubs`) —
   already built, serves every set.** Static, offline (no `gh` call). Parses
   every commented-out stub in `convex/cards/sets/**/*.ts` (every colour module
   of every set directory) and fails if a stub's
   comment block carries no traceable disposition. Accepted, in order of
   preference: `// tracked-by: #NNN` (the convention for a work issue), a bare
   `#NNN` issue ref (legacy — a PRD/parent ref passes offline; the online check
   below is what proves it's an open WORK issue), or an `out of scope` / `ADR
NNNN` marker (permanent OOS). A stub with NONE of these is the exact orphan
   that lost ~26 ICE cards — now a red gate the moment it lands, same
   intended-failure-mode as the lockfile drift guard. It ALSO fails on a
   **dead-duplicate** stub — a commented block whose `name:` matches an active
   def (reprints are active `CardPrint`s, never commented stubs; a leftover
   commented copy is garbage — delete it). **When you emit a new stub, tag it
   `// tracked-by: #NNN` with its cluster issue.**
2. **Coverage reconciliation at rollout close.** Produce a final manifest:
   every card in the set blob → its disposition (`active def` / `lockfile` /
   `issue #N` / `out-of-scope`). Assert the partition is **total and disjoint** —
   `active + lockfile + tracked-by-open-issue + OOS == total`. Any card that is
   neither implemented, nor in the lockfile, nor named by an open issue, nor
   OOS is unaccounted: the rollout is NOT done until that set is empty. This is
   the `gh`-querying check (open-issue membership) that the offline gate can't do;
   run it when closing the umbrella PRD.

Without these two, the skill's 5-bucket triage is only as good as the human/agent
doing it once — and a single mis-bucketed or skipped card vanishes with no gate
to catch it. With them, every card is provably either shipped, in-flight (an open
issue), or explicitly out-of-scope.

## Testing requirements (every slice)

Per `.claude/rules/gre-development.md`:

- Per-card GRE tests in the parallel per-colour test file
  `convex/cards/sets/<code>/__tests__/<colour>.test.ts` (matching the colour
  module the card lives in), one `describe` per non-trivial card, each citing
  its CR section. Fixtures from `convex/cards/__tests__/setup.ts` — never
  duplicated.
- **Wire-format test mandatory** for every client-visible effect (re-run the
  assertion after `projectPublicState`).
- **≥1 full-path integration test** for any feature crossing GRE → game.ts → UI
  (new cost/target shapes get the full 5-layer matrix).
- New optional `GameState` field → `PERSISTED_OPTIONAL_KEYS`/`TRANSIENT_KEYS` +
  round-trip test (serialize drift guard).
- A **preset scenario** per cluster in `PRESET_SCENARIOS`
  (`src/components/debug/debug-panel.tsx`).
- Cadence: targeted tests while iterating; full gate once before done/merge —
  `bun run check:all` + full `bun run test`, zero errors/failures. `check:all`
  now also runs `check:stub-coverage` (Phase 4) — every commented stub must
  carry its `// tracked-by: #NNN` tag or the gate fails.

## Reference

- Skills sequenced: `~/.claude/skills/{grill-with-docs,to-prd,to-issues}/SKILL.md`
- ADR 0041 (worklist/import), ADR 0014 (prints vs defs), ADR 0010 (ante/subgame)
- Import: `scripts/{json-to-cards.mjs,backfill-card-index.ts,check-card-index.ts}`
- Exemplar PRDs: DRK #409 (free tranche + clusters), FEM #566 (thematic),
  ICE #628 (colour-split, zero-deferral). Cluster-issue exemplar: #418.
