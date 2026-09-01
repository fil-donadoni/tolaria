---
name: new-set
description: Drive a full MTG set rollout for the Tolaria engine — grill the design, write the PRD, cut the issues — with all standing conventions (CR-first, cluster split, primitive reuse, import pipeline) already baked in. Invoke as "/new-set <3-letter code>", e.g. "/new-set inv".
argument-hint: "<set-code>"
---

# New Set Rollout

Orchestrate implementing a whole MTG set, from `/new-set <code>` to a published
umbrella PRD + dependency-ordered cluster issues. This skill **sequences three
existing global skills** — `grill-with-docs` → `to-prd` → `to-tickets` — and
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
8. **DSL-first authoring is the default (ADR 0045).** Every free and capability
   card is written as an Effect Script (`effects: EffectOp[]`) by default;
   `resolve()` is the escape hatch for genuinely protocol-like cards and needs
   an explicit justification (`.claude/rules/gre-development.md` § DSL-first
   authoring). Every keyword/Op used must be `status: "implemented"` in the
   Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) — an uncensused
   mechanic is a stop-and-flag case in Phase 0 triage, never an invented name.

## Phase 0 — Scope the set (before grilling)

Explore, don't ask, for anything the data or codebase can answer.

### Phase 0 model routing (mandatory)

Phase 0 mixes two very different kinds of work, and they must NOT run on the
same tier. The **gathering** steps are mechanical — download a blob, aggregate
it with `jq`, parse colour modules, extract registry rows — and their raw
output is bulky (7 colour modules, a several-hundred-card blob, the whole
Mechanics Registry). The **bucketing** step (free vs capability) is the single
hardest judgement in the whole rollout: it needs the engine's real Op
vocabulary held against every card's Oracle text, and a mis-bucketed card
passes every gate the skill has (the closure invariant checks the _tally_, not
the _verdict_) and only explodes mid-cluster.

So: **delegate the gathering to `model: sonnet` subagents, keep the bucketing
on the session tier (run this skill on Opus).** Each subagent returns a compact
list, not file dumps — that is the point.

| Sub-step                                         | Who                                   |
| ------------------------------------------------ | ------------------------------------- |
| **A** Set data + blob profile (steps 1, 3)       | `Explore`, `model: sonnet`            |
| **B** Prior-work scan (step 2) → `done`/`staged` | `Explore`, `model: sonnet`            |
| **C** Registry snapshot (feeds step 6)           | `Explore`, `model: sonnet`            |
| **D** Mechanical pre-filter (splits step 4)      | `Explore`, `model: sonnet`, after A+C |
| **Triage verdicts** (step 4), step 5 gap calls   | **main thread, session tier**         |
| Closure invariant + manifest                     | **main thread, session tier**         |

A, B and C are independent — spawn them in **one message, three tool calls**.
D depends on A+C, so it goes in a second message.

**A — set data + profile.** Ensure `data/json/<CODE_UPPER>.json` exists
(download per step 1 if not), then run the step-3 `jq` profiling. Returns:
total unique cards, breakdown by colour / rarity / layout, and the explicit
list of card names whose `layout` is not `normal` (the out-of-scope
candidates). Not the blob, not per-card dumps.

**B — prior-work scan.** Returns two name lists from
`convex/cards/sets/<code>/` (all colour modules) plus `data/card-index.json`:
`done` (active `CardDefinition` export, or present in the lockfile) and
`staged` (commented-out stub block, with its `// tracked-by:` tag if any).
Names only. It must also report whether the directory exists at all — that
gates the never-overwrite rule in step 2.

**C — registry snapshot.** Returns, from
`convex/cards/mechanicsRegistry.ts`: every keyword row with
`status: "implemented"` (name + `bindingPattern` where parametrized), every
keyword row that is `planned` or otherwise NOT implemented, and the full list
of Op names in `EFFECT_OP_REGISTRY`. Flat lists, no prose.

**D — mechanical pre-filter.** Given A's card list and C's implemented-keyword
list, split every not-yet-`done`/`staged` card into:

- `trivial-free` — the card's `oracleText` is **empty**, or consists **only**
  of lines that are keyword abilities all present in C's implemented list
  (vanilla, French vanilla, basic lands, plain reminder text). This is a
  syntactic test, not a judgement: if a line is anything other than a listed
  keyword — any sentence, any triggered/activated ability, any static effect —
  the card is NOT `trivial-free`.
- `needs-judgement` — everything else, returned **with its oracle text** so the
  main thread can bucket it without re-fetching.

D exists to keep the expensive tier's input to the cards that actually need
reasoning; on a typical old set it removes 30–50% of the pool. Because its rule
is syntactic, the main thread **spot-checks it**: sample ~10 `trivial-free`
cards and confirm each really is keyword-only. A card wrongly filtered into
`trivial-free` is invisible to every downstream gate.

The main thread then buckets `needs-judgement` (+ D's `trivial-free` ⇒ `free`)
into free / capability / out-of-scope, does the step-5 engine cross-check and
the step-6 registry gap calls, and computes the closure invariant. Those are
never delegated: they are the reasoning the rollout is bought with.

### Steps

1. **Get the set data.** _(sub-agent A)_ The importer reads an MTGJSON blob at
   `data/json/<CODE_UPPER>.json` (e.g. `data/json/INV.json`). If it's missing,
   download it: `curl -s -A "Mozilla/5.0" -o data/json/<CODE_UPPER>.json
https://mtgjson.com/api/v5/<CODE_UPPER>.json`.
2. **Check for prior work — this set may be partially done.** _(sub-agent B
   gathers; the never-overwrite decision below stays on the main thread.)_ A set can carry
   a pre-existing `convex/cards/sets/<code>/` directory (colour-split per
   ADR 0043: `white|blue|black|red|green|multicolor|colorless.ts` + an
   `index.ts` barrel) from an earlier rollout. You MUST treat it as the source
   of truth for what's already implemented and **never lose it**: - **`json-to-cards.mjs` OVERWRITES the whole `<code>/` directory** (every
   colour module + the barrel). Do NOT run it against an existing, non-empty
   set directory — it would clobber hand-written implementations. If the
   directory exists, import into a scratch path instead (e.g. import to a
   temp set code, then diff per colour module), and **only graft in the
   cards that are missing**. - Parse the existing colour modules: **active** `export const … :
CardDefinition` (and `CardPrint`) are implemented; **commented-out** stub
   blocks are capability cards staged earlier — uncomment them when their
   cluster ships, do not re-stub or duplicate them. - The set directory and the lockfile can disagree if the lockfile is stale
   — reconcile by running `bun run check:index` (and backfilling if it
   fails) so "done" reflects reality before you scope.
3. **Profile the set from the blob** _(sub-agent A)_ (use `jq`): total unique cards, breakdown
   by colour, by rarity, and — critically — by **card layout** (`normal` vs
   `transform`/`modal_dfc`/`split`/`adventure`/`flip`/`meld`/`saga`/`leveler`/
   `class`). Unmodelled layouts are out-of-scope (ADR 0010 / ADR 0041).
4. **Triage every card into five buckets** — **main thread, never delegated**
   (sub-agent D only pre-filters the input, see the routing block above).
   This IS the scope, and it must
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
6. **Mechanics Registry closure check (ADR 0045/0046).** _(sub-agent C supplies
   the registry lists; the gap verdicts are main-thread.)_ Cross-reference every
   keyword ability and keyword action the set's cards use against
   `convex/cards/mechanicsRegistry.ts` (`status: "implemented"` rows +
   `EFFECT_OP_REGISTRY`). This IS part of the capability triage: a mechanic
   that's `planned`/absent from the registry is a capability candidate (or an
   out-of-scope call) exactly like an unshipped engine feature — never
   authored by inventing a keyword string or an Op name. Any gap surfaced here
   gets its own registry row (`planned` costs nothing) before the set's issues
   are cut, so `/new-card` runs during rollout never hit a stop-and-issue mid-cluster.

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
- **Escape-hatch budget per cluster (DSL-first, ADR 0045)** — for each
  cluster (free tranche included), estimate and state the expected count of
  `resolve()` cards vs Effect Script cards up front. A cluster where more than
  a small minority of cards need `resolve()` is a signal to look harder for a
  missing, reusable Op before accepting the budget — the ~80–85% DSL-coverage
  design point (ADR 0045) is a catalogue-wide expectation, not a per-cluster
  cap, but a cluster that's mostly `resolve()` deserves a second look in the
  grill, not a rubber stamp. Record the accepted budget in the PRD so
  `to-tickets` / the cluster PR can point back to it instead of re-litigating
  each `resolve()` justification from scratch.

`grill-with-docs` updates `CONTEXT.md` inline as terms resolve and may create
an ADR under `docs/adr/` for a hard-to-reverse mechanic.

## Phase 2 — Write the PRD (`to-prd`)

Invoke **`to-prd`**. It synthesizes the grill context (does NOT re-interview)
into one **umbrella GitHub issue** labeled `prd` — and **not**
`ready-for-agent`: a PRD is a spec, not a work item, and
`/process-gh-issues` refuses to select `prd`-labelled issues, so the queue
label would make the umbrella get skipped on every pass forever while
falsifying the loop's stop condition. If `to-prd` applied it, remove it. The
executable work is the Phase 3 issues, which carry the queue label and hang
off this umbrella as sub-issues. Ensure the PRD's **Implementation Decisions**
name:

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
  top up `data/card-index.json` with `bun run scripts/backfill-card-index.ts`
  (add `--prune` only if the guard reports pollution), and `bun run check:index`
  must pass (the drift guard). Never reset the file to `[]` first — that also
  destroys the ~1400 `source: "compiled"` rows, which the backfill cannot
  rebuild. Forgetting the refresh breaks the gate loudly — that's the intended
  failure mode. (ADR 0041, `project_card_index_lockfile`)
- Multi-art note (ADR 0014): one `CardDefinition` per card + one `CardPrint`
  per artwork.
- **DSL-first authoring (ADR 0045)**: free and capability cards are written as
  Effect Scripts by default; state the per-cluster escape-hatch budget agreed
  in the grill (see Phase 1) and note any Mechanics Registry gaps surfaced
  during Phase 0 triage that need a `planned` row added before rollout.
- **The Phase 0 scope manifest** (per-card bucket partition + the
  `done+staged+free+capability+OOS == total` tally) goes in the PRD body as the
  tracked rollout contract — `to-tickets` reconciles against it, Phase 4 closes
  against it.

## Phase 3 — Cut the issues (`to-tickets`)

Invoke **`to-tickets`** with the umbrella PRD issue number. It splits into
**tracer-bullet vertical slices**, each end-to-end through all layers, demoable,
tagged HITL/AFK (prefer AFK), published in dependency order (blockers first).

Conventions to hold it to:

- **Every cut issue is a native SUB-ISSUE of the umbrella PRD** —
  `gh issue edit <child> --parent <umbrella>`, in the same pass that creates
  it, never back-wired later. `to-tickets` mandates this; hold it to it and
  verify rather than assume: `gh issue view <umbrella> --json subIssuesSummary`
  must report `total` equal to the number of issues just cut. The reason is
  scheduling, not tidiness — `/process-gh-issues` sorts by
  `parent.number ?? number` (oldest **lineage** first) off its cheap Stage-1
  list call, so a cluster issue with no edge sorts on its own number and the
  set's later slices land at the BACK of the queue while its earlier ones
  starve. The edge is also what `subIssuesSummary` reads, which is what lets
  the loop close the umbrella in Phase 4 once the last cluster lands. The
  `## Parent` body line below is for humans and is NOT the sort key.
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
  `## Related` · `## Target files` (module/glob-level scheduling metadata for
  the processing loop's disjoint batching — e.g. the colour files + engine
  registries the cluster touches; coarse ok, `- *` if it touches everything).
- A card may ship (as a body/stub) before its cluster's mechanic and be
  corrected by the cluster PR — keep the build green throughout.
- **DSL-first per cluster.** Every cluster-issue's `## Acceptance criteria`
  includes: cards are written as Effect Scripts by default; any `resolve()`
  usage carries its justification in the PR; any mechanic the cluster needs
  that isn't yet `implemented` in the Mechanics Registry is either added as
  part of the cluster's engine work (registry row flips to `implemented` with
  a real binding) or flagged and deferred — never authored via an invented
  name (`.claude/rules/gre-development.md` § DSL-first authoring).
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

- **Per-Op regime for DSL cards (ADR 0045).** A card whose `effects[]` only
  reuses already-exercised Ops needs NO hand-written per-card test — the
  catalogue-wide static sweep (`convex/cards/__tests__/effectScripts.test.ts`)
  plus the auto-generated canned-scenario smoke test
  (`convex/cards/__tests__/effectScriptSmoke.test.ts`) cover it for free. A
  card introducing a new Op earns that Op its permanent interpreter + wire-
  format test, inherited by every later card that reuses it. `resolve()`
  cards, and DSL cards hitting a new Op, keep the full per-card regime below.
- Per-card GRE tests in the parallel per-colour test file
  `convex/cards/sets/<code>/__tests__/<colour>.test.ts` (matching the colour
  module the card lives in), one `describe` per non-trivial card, each citing
  its CR section. Fixtures from `convex/cards/__tests__/setup.ts` — never
  duplicated.
- **Wire-format test mandatory** for every client-visible effect (re-run the
  assertion after `projectPublicState`).
- **≥1 full-path integration test** for any feature crossing GRE → game.ts → UI
  (new cost/target shapes get the full 5-layer matrix).
- **Frontend wiring walked** for every card (`.claude/rules/gre-development.md`
  § Frontend wiring analysis): confirm each affordability / target / instance
  field survives the client view reducers (`buildTriggerStateView`,
  `projectPublicState`). A new activation-cost shape must be added to the
  affordability catalogue sweep
  (`src/lib/__tests__/activation-affordability.catalogue.test.ts`) and gated in
  `getStackAbilities`; existing shapes are covered automatically.
- New optional `GameState` field → `PERSISTED_OPTIONAL_KEYS`/`TRANSIENT_KEYS` +
  round-trip test (serialize drift guard).
- A **preset scenario** per cluster, saved as a `debugScenarios` DB row via the
  Debug panel's "Save scenario" form / `saveDebugScenario`
  (`convex/debugScenarios.ts`) — a DB insert, not a `debug-panel.tsx` edit
  (ADR 0044, issue #770).
- Cadence: targeted tests while iterating; full gate once before done/merge —
  `bun run check:all` + full `bun run test`, zero errors/failures. `check:all`
  now also runs `check:stub-coverage` (Phase 4) — every commented stub must
  carry its `// tracked-by: #NNN` tag or the gate fails.

## Model routing recap (two different axes — don't conflate them)

- **Inside this skill**: only Phase 0's _gathering_ is delegated, to
  `model: sonnet` sub-agents (A–D above). Phases 1–3 are never delegated —
  the grill is an interactive one-question-per-turn interview with the user,
  and the PRD/tickets are synthesis over that conversation. Run `/new-set`
  itself on Opus.
- **Downstream, a separate axis**: `to-tickets` stamps a `model:*` label on
  each cut issue, and `/process-gh-issues` routes that ticket's
  implement-subagent to that tier (**no label ⇒ Sonnet**, which is the right
  default for a DSL card reusing shipped Ops). `model:opus` is for a ticket
  introducing a new Op/primitive/cross-layer shape later tickets will copy.
  That routing is `to-tickets`' job, not this skill's. The same goes for the
  `area:*` family label (one per ticket — for a set rollout almost always
  `area:cards`, `area:mechanics` for a capability-cluster ticket): stamped at
  ticket-cutting time, per `to-tickets`' area-label rule.

## Reference

- Skills sequenced: `~/.claude/skills/{grill-with-docs,to-prd,to-tickets}/SKILL.md`
- ADR 0041 (worklist/import), ADR 0014 (prints vs defs), ADR 0010 (ante/subgame)
- Import: `scripts/{json-to-cards.mjs,backfill-card-index.ts,check-card-index.ts}`
- Exemplar PRDs: DRK #409 (free tranche + clusters), FEM #566 (thematic),
  ICE #628 (colour-split, zero-deferral). Cluster-issue exemplar: #418.
