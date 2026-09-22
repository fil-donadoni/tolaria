---
name: new-set
description: Drive a full MTG set rollout for the Tolaria engine the grammar-first way (ADR 0137) — compile the set with the Oracle compiler, read its ranked Grammar Gap backlog, and cut one ticket per gap plus the Guard C residue queue and the set's acceptance ticket. Invoke as "/new-set <3-letter code>", e.g. "/new-set inv".
argument-hint: "<set-code>"
---

# New Set Rollout — v2, compile-first

A set rollout is **a ranked grammar backlog, not a pile of cards** (ADR 0137).
The compiler is the authoring path: the set's cards enter the catalogue as
`ready` Compiled Definitions, and the unit of work is the **Grammar Rule** —
one clause form accepted by a slot or a shared sub-grammar — measured by the
cards it turns `ready` in this set and across the corpus. Hand-writing is the
Guard C fallback for what the grammar does not reach, never the plan.

This skill produces: an **umbrella PRD**, **one ticket per ranked Grammar Gap**
(implemented by `/grammar-rule`), **one residue ticket** for the cards hand-
written under Guard C, and **one acceptance ticket** carrying the set's `ready`
percentage. It sequences `grill-with-docs` → `to-prd` → `to-tickets` and
injects the settled conventions, so the user never re-explains them.

`$1` (or the word after `/new-set`) is the **3-letter lowercase set code**
(`inv`, `apc`, `usg`, …). The same pass drives any other **Target**: a format
pool (`--pool premodern`) or any Target registered in `data/targets.json` —
a deck list or a name list, the premodern metagame or the Vintage Cube
(`--target vintage-cube`, wayfinder map issue #3846). If the argument is
missing or ambiguous, ask for it — one question — before anything else.

## What v1 did that v2 does not (read once, then forget v1)

- **The five-bucket hand triage is gone.** `done / staged / free / capability /
out-of-scope` was a judgement call per card, re-derived by hand every
  rollout. The lockfile is the partition now, computed and reproducible:
  `ready / quarantine / gap-pending / hand-tail / unclaimed`
  (`scripts/lib/targets.ts`, issue #3868).
- **The hand-authoring axis is gone.** No `json-to-cards.mjs` import, no
  colour-module scaffold, no commented stubs, no free tranche per colour, no
  capability cluster. Those survive only inside the **residue** — the cards the
  grammar genuinely does not reach, hand-written under Guard C with a marker.
- **`/mtg-rules-check` still gates every mechanic**, and the evidence steps
  (A–E′) survive — rescoped from "which bucket is this card in?" to "does this
  ranked gap need an Op that does not exist?" (Phase 0.5).

## What you already know (do NOT re-ask)

Settled defaults. Apply them silently; escalate only on the stated exceptions.

1. **CR-compliance is the default — never ask whether to follow the
   Comprehensive Rules.** Print the rule, never recall it: `bun run cr <id>`
   (vendored, offline, ADR 0098), then `bun run cr:ledger confirm <file>:<line>`
   for every `CR` line authored. Escalate ONLY on genuine CR ambiguity or an
   intentional deferral (flag it). (`feedback_cr_compliance_default`)
2. **The unit of work is the Grammar Rule, not the card** (ADR 0137). A slice
   is a clause form the compiler learns to read, delivered with a golden
   fixture per accepted form, and its size is `compiles` — the cards for which
   it is the last gap. Never propose a slice shaped "implement these 9 cards".
3. **The three anti-Forge guards** — a rule that breaks one is not a rule this
   rollout ships (ADR 0137, restated by `/grammar-rule`):
   **no structural construct** (the Effect Script's structure is frozen at
   ADR 0045's `bind` / `ref` / `if` / `forEach`); **no Op named for a line**
   (an Op is named for the MECHANIC — issue #1917); **no leniency** (the parser
   stays fail-closed, ADR 0105 § 2 — coverage is earned by rules, never by
   widening a pattern to make a line consume).
4. **Primitive reuse over creation.** Before any new Op or `SpellContext`
   primitive: decompose into existing ones, generalize an almost-right one,
   check orthogonality. A gap whose rule needs a new Op goes through `/new-op`
   INSIDE its own ticket (that rule is the Op's eighth site, the emitting
   rule). (`feedback_primitive_reuse`)
5. **The corpus IS the Oracle text.** Modern Scryfall wording, never the
   printed 1994 text; the compiler reads `data/oracle-corpus.json.gz` and the
   committed lockfile, so nobody quotes a different number.
   (`feedback_modern_oracle_text`)
6. **Fix the class, not the card.** A gap is a CLASS of lines by construction —
   if a proposed rule reads exactly one card, it is a card in disguise; look
   for the form it belongs to. (`feedback_fix_bug_class_not_single_card`)
7. **One question per turn while grilling.** One decision, your recommended
   answer stated, then wait. A recap table of resolved decisions is fine;
   previewing upcoming questions is not. (`feedback_grill_one_step_at_a_time`)
8. **Decide autonomously when consistent.** Once a shape is blessed, decide
   structurally-equivalent later cases yourself and log them in the recap.
   Escalate on a genuine new axis. (`feedback_autonomous_when_consistent`)
9. **The Mechanics Registry is the single name authority** for keywords and Ops
   (`convex/cards/mechanicsRegistry.ts`, ADR 0045/0046). An uncensused mechanic
   is stop-and-open-an-issue, never an invented name. Every Op a rule lowers to
   must be `status: "implemented"` or the card lands in `quarantine`, not
   `ready` (ADR 0105 § 3).

## Phase 0 — Compile the Target (before grilling)

Explore, don't ask, for anything the compiler can answer. Nothing in this phase
is a judgement about a card: every number below is read back from the lockfile.

### 0.1 Corpus cache and the lockfile baseline

`data/oracle-corpus.json.gz` is gitignored, so a fresh worktree has none and
`oracle:compile` throws `oracle corpus cache missing`:

```bash
cp "$(git worktree list | head -1 | cut -d' ' -f1)/data/oracle-corpus.json.gz" data/
bun run oracle:compile --check >"$SCRATCHPAD/compile-check.log" 2>&1; echo "exit=$?"; tail -1 "$SCRATCHPAD/compile-check.log"
```

`lockfile is current` is the baseline every later delta is measured against.
(No primary copy either → `bun run oracle:corpus` fetches it.)

Ensure the set's MTGJSON blob exists — `oracle:report --set` reads
`data/json/<CODE_UPPER>.json` for the set's oracle ids, and the directory is
committed:

```bash
[ -f data/json/<CODE_UPPER>.json ] || curl -s -A "Mozilla/5.0" -o data/json/<CODE_UPPER>.json https://mtgjson.com/api/v5/<CODE_UPPER>.json
```

### 0.2 The Target must be registered

`data/targets.json` is what makes the set a **Target**: it is what
`oracle:report --targets` renders, what the Coverage Invariant
(`bun run check:targets`, issue #3868) enforces, and what `gaps:sync` ranks and
parents its filings by. Check for the row:

```bash
grep -n '"set-<code>"' -A 3 data/targets.json
```

Missing → it is **ticket T0** of this rollout (Phase 3), a one-line row
(`{ "id": "set-<code>", "kind": "set", "source": "data/json/<CODE_UPPER>.json" }`)
plus the committed blob. Leave `enforced` OFF and `priority` unset: a priority
is the maintainer's call in the grill (an unprioritised Target is measured, not
ranked by), and enforcement is what the **acceptance ticket** flips once the
set's cards are all claimed. Every other ticket is blocked-by T0.

### 0.3 The ranked backlog — this IS the scope

```bash
L="$SCRATCHPAD/report.log"
bun run oracle:report --set <code> --gaps 40 >"$L" 2>&1; echo "exit=$?"; head -12 "$L"
```

The header line is the set's state (`N cards: R ready (x %), Q quarantine, U
unparsed`); the table is the backlog, one row per Grammar Gap:

- **`compiles`** — cards of the Target for which this gap is the ONLY one left.
  They compile the day the rule lands. This is the slice's size.
- **`refuses`** — cards the gap refuses (it may not be their only gap).
- **`corpus c/r`** — the same two counts over the whole corpus: the leverage
  tie-break, and the reason the FIRST set pays the grammar and later sets
  inherit it.
- **`slot › sub-grammar`** + `span` + `e.g.` — the gap key, the clause shape,
  and a real card that prints it.

Ranking is Target `compiles` → Target `refuses` → corpus `refuses` → key, so
two runs over one lockfile print one list. `--pool <format>` ranks the same
table for a format pool and `--target <id>` for a registered Target; the three
are mutually exclusive and the report refuses two of them rather than picking
one. A `--target` id that no row carries exits 1 and lists the registry — it
never falls through to the corpus ranking.

### 0.4 The scope manifest — done (ready) + gaps (ranked) + residue

```bash
bun run oracle:report --targets set-<code> >"$SCRATCHPAD/targets.log" 2>&1; echo "exit=$?"
grep -E 'playable|ready|quarantine|gap-pending|hand-tail|unclaimed|by the claim missing' "$SCRATCHPAD/targets.log"
```

Every card of the Target is in exactly one **coverage state**, computed:

| State         | Meaning                                                  | Where it goes in the rollout         |
| ------------- | -------------------------------------------------------- | ------------------------------------ |
| `ready`       | shipped by the compiler                                  | **done** — no ticket                 |
| `quarantine`  | compiled, a gate withheld it (`reason.kind`)             | a `mechanic` / `scenario` gap ticket |
| `gap-pending` | refused, and its gap is claimed by an open issue         | **that** ticket, already cut         |
| `hand-tail`   | every residual gap is below `handTailFloor` corpus cards | the **residue** ticket               |
| `unclaimed`   | refused and claimed by nothing                           | **the hole — Phase 3 must empty it** |

**The closure invariant of v2 is `unclaimed == 0`**, not a hand tally. The
report prints it split by the claim that is missing
(`unclaimed, by the claim missing: hand-tail 58, grammar 54`) — the `grammar`
count is what the Phase 3 gap tickets must claim, the `hand-tail` count is the
residue ticket's scope. This manifest is the **contract the rollout closes
against** (Phase 4); persist it in the PRD body, it is not a throwaway tally.
ICE skipped the v1 equivalent and silently lost ~26 cards to untracked stubs.

**The cut line.** Cut a gap ticket per rank until the set's cumulative
`compiles` reaches the acceptance target agreed in the grill (default 80 %
`ready`), and never below `handTailFloor` (`data/targets.json`, 3 corpus
cards): a gap under the floor is residue by definition, not a rule worth its
fixtures. Say the line out loud — "ranks 1–17, cumulative 31 of 112 unparsed,
floor reached at rank 24" — so the grill argues about a number, not a feeling.

### 0.5 Evidence — the capability cross-check, for gaps that need an Op

Most Grammar Gaps need NO new Op (keyword parameters, trigger heads, effect
clauses over existing Ops — ADR 0137). The evidence steps exist for the
minority that do, and they run **per gap on the cut line**, never per card:

| Sub-step                                                  | Who                                      |
| --------------------------------------------------------- | ---------------------------------------- |
| **A** Set blob presence + layout profile                  | `Explore`, `model: sonnet`               |
| **B** Prior-work scan → the Guard C residue already there | `Explore`, `model: sonnet`               |
| **C** Registry snapshot (implemented keywords + Ops)      | `Explore`, `model: sonnet`               |
| **E** Engine evidence, one question per gap on the line   | `Explore`, `model: sonnet`, 2–3 parallel |
| **E′** Re-verification of every NO / PARTIAL              | **main thread, session tier**            |
| Cut line, ticket shapes, manifest                         | **main thread, session tier**            |

A, B and C are independent — spawn them in **one message, three tool calls**.

- **A — layout profile.** From the blob: total unique cards and the explicit
  list of names whose `layout` is not `normal`. Unmodelled layouts are
  out-of-scope (ADR 0010 / ADR 0041) and the report counts them as refused like
  anything else — name them in the PRD so the acceptance percentage is honest.
  **`split` IS modelled** (`defineSplitCard`, `CardDefinition.splitHalves`);
  grep for engine support before calling any layout unmodelled.
- **B — the residue already on disk.** From `convex/cards/sets/<code>/` (if it
  exists at all) and `convex/cards/__tests__/compilerRoundTrip.baseline.ts`:
  the hand-written cards of this set and their `compiler-gap:` / `hand-tail:`
  markers. Names and markers only. A hand-written card whose Oracle text now
  compiles is a **migration**, not a rollout slice — `oracle:report --targets`
  prints it under `hand-tail cards now migrable`, and `gaps:sync` files it.
  **Never overwrite an existing `sets/<code>/` directory**; v2 runs no import.
- **C — registry snapshot.** Every keyword row that is `implemented` (with its
  `bindingPattern`), every row that is not, and the full `EFFECT_OP_REGISTRY`
  Op list. Flat lists, no prose.
- **E — engine evidence.** For each gap on the cut line, one concrete question
  about the surface its lowering would need ("is there an Op that prevents the
  next N damage to a chosen recipient?", "can a cost tap other untapped
  creatures?"). Each answer is **YES** (the Op/field with `file:line`),
  **PARTIAL** (what exists, what is missing) or **NO** (what was searched) —
  evidence, never a proposal.
- **E′ — re-verify every NO and PARTIAL on the main thread** with your own grep
  over `convex/cards/types.ts`, `convex/cards/mechanicsRegistry.ts` and
  `convex/gre/`. **A Sonnet result is an input, never a verdict.** On APC
  (2026-09-17) E′ overturned two claimed gaps — a discard replacement event and
  a "controls a permanent of colour X" condition both already shipped — which
  would otherwise have become two needless `/new-op` tickets.

The verdict per gap is one of three, and it goes in the ticket:
**no Op needed** (most), **`/new-op` inside the ticket** (the rule is the Op's
emitting site — they land in ONE PR, the Op never lands alone), or **out of
reach** (it needs a construct outside the frozen four, or an engine surface
with no JSON shape) — which is not a ticket at all: the gap stays in the
backlog and its cards fall to the residue.

## Phase 1 — Grill the design (`grill-with-docs`)

Invoke **`grill-with-docs`**, seeded with the Phase 0 manifest and cut line.
One question per turn, recommended answer stated each time. Drive it to:

- **The acceptance target.** The set's `ready` percentage the rollout commits
  to — default **80 %**, which is what the acceptance ticket asserts. State the
  starting percentage and the cumulative `compiles` of the cut line beside it,
  so the target is arithmetic and not ambition.
- **The cut line itself** — how far down the rank tickets are cut, and what
  falls to the residue. A gap below `handTailFloor` is residue by default.
- **Slice ORDER.** By corpus leverage, not by set count: a gap with
  `2/3` in the set and `78/221` in the corpus outranks one with `2/2` in both,
  because the second set inherits the first rule for free. Where a gap's rule
  belongs to a shared sub-grammar that another gap's slot routes through, the
  shared one goes first and the dependant is **blocked-by** it.
- **Target priority.** Whether this set gets a `priority` in `data/targets.json`
  (it then ranks `gaps:sync`'s filings ahead of unprioritised Targets) — the
  maintainer's call, default unset.
- **Priority band.** The umbrella goes on the "Tolaria Backlog" board with
  `Priority` **P1** unless the user names another band; children inherit the
  band from the parent (issue #3212) and are not prioritised individually.
- **Residue policy.** Which cards are hand-written under Guard C during this
  rollout versus left `hand-tail` for the migration queue. Default: **none**
  hand-written — the residue ticket records the tail, it does not author it.
  Hand-writing is justified per card (a Target card a deck actually needs), and
  every hand-written card carries its `compiler-gap: <fragment> (#issue)` or
  `hand-tail:` marker naming an OPEN gap issue.
- **Out-of-scope** — unmodelled layouts; ante/subgame (ADR 0010); 3+ player.
  Named card by card, subtracted from the acceptance denominator explicitly.

`grill-with-docs` updates `CONTEXT.md` inline as terms resolve and may create an
ADR for a hard-to-reverse decision (it offers them sparingly — a grammar rule is
not one).

## Phase 2 — Write the PRD (`to-prd`)

Invoke **`to-prd`**. It synthesizes the grill (it does NOT re-interview) into
one **umbrella GitHub issue** labelled `prd` — and **not** `ready-for-agent`: a
PRD is a spec, the queue planner refuses `prd`-labelled issues, so the label
would only make `/next-issue` skip the umbrella forever. If `to-prd` applied it,
remove it.

**Tell `to-prd` the card-link rule** — it is MTG-agnostic and will not apply
it on its own: every card name in the body is the link
`bun run card:link "<Card Name>" […]` prints (`docs/agents/issue-tracker.md` § Card names are Scryfall links).

**The title MUST start `[<CODE>]`.** `gaps:sync` finds a set's umbrella by
`^\[<CODE>\]` over open `prd`-labelled issues (`findSetUmbrella`,
`scripts/gaps-sync.ts`) and parents the Target's computed filings under it. A
title that does not match sends every later computed gap to PRD #3820 instead.

The PRD's **Implementation Decisions** must name:

- **The compile-first scope manifest** — the Phase 0.4 coverage-state table
  verbatim, with `unclaimed` and its split by missing claim. This is the
  rollout contract.
- **The ranked backlog** — the `oracle:report --set <code> --gaps N` output
  verbatim in a fenced block, with the branch and sha it was generated at.
  Reproducibility is the point: it reads the committed lockfile, never the
  corpus, so two people quoting a number quote the same run.
- **The cut line and the acceptance target** (`ready` percentage, default 80 %),
  with the out-of-scope names subtracted from the denominator.
- **The per-gap Op verdict table** — one row per gap on the line: gap key,
  `compiles`/`refuses` (set and corpus), and the E′-verified verdict
  (`no Op` / `/new-op <name>` / `out of reach`). The gap ticket points back to
  this row instead of re-deriving it.
- **The residue** — the `hand-tail` names and the policy agreed in the grill.
- **Artefact regeneration** as an explicit engineering story, owed by every gap
  PR: `oracle:compile` → `oracle:index` → `catalogue:pack`, then
  `check:oracle` + `catalogue:check` + `check:index` + `check:gaps` +
  `cr:lint`. Never hand-edit a generated file. Forgetting reds the gate
  loudly — the intended failure mode.
  (ADR 0041, ADR 0105, `project_card_index_lockfile`)
- **No import, no scaffold.** State it: this rollout runs no
  `json-to-cards.mjs`, creates no `sets/<code>/` directory and emits no
  commented stubs. Compiled cards reach the client as `source: "compiled"`
  rows of `data/card-index.json`.

## Phase 3 — Cut the tickets (`to-tickets`)

Invoke **`to-tickets`** with the umbrella issue number, and tell it the same
card-link rule as `to-prd` above (`docs/agents/issue-tracker.md` § Card names are Scryfall links). Three ticket shapes, plus T0.

**T0 — register the Target** (only if Phase 0.2 found no row): the
`data/targets.json` row + the committed MTGJSON blob. `area:cards`,
`ready-for-agent`, no `model:*`. Every other ticket is **blocked-by** it.

**One ticket per Grammar Gap on the cut line.**

- **Title**: `[Grammar] <slot>: <form> — N <set> / M corpus`, where `N` is the
  set's `compiles` and `M` the corpus `compiles`
  (e.g. `[Grammar] triggered › effect clause: Reveal the top four cards of your library — 6 APC / 7 corpus`).
  **This prefix is deliberately NOT `gaps:sync`'s.** That command files the
  bounded, shrink-only **Op-census** rows of `data/grammar-gaps.json` under
  `Grammar Gap: <key>` (ADR 0105 § 7.3); this backlog is the **per-fragment**
  one `oracle:report --gaps` ranks — unbounded, and explicitly not that
  command's (`scripts/lib/gap-issues.ts` header). Two prefixes, two backlogs,
  no duplicate filings.
- **Labels**: `ready-for-agent` + `area:mechanics`. A `model:*` label only per
  `docs/agents/triage-labels.md` § Model-routing labels — the single authority;
  never re-derive a tier from the area a gap touches.
- **Body**: `## Parent` (→ umbrella) · `## Grammar Gap` (the key verbatim, the
  four counts, the `e.g.` card, and the PRD's Op verdict row) · `## What to
build` ("run `/grammar-rule <key>`" — the rule, one golden fixture per
  accepted form with proof of failure, the refused neighbours pinned by
  refusal tests) · `## Acceptance criteria` (the rule lands; `ready` delta ≥
  the gap's `compiles` or the shortfall explained by quarantine `reason.kind`;
  `lost` = 0; Guard C graduates removed from the baseline with
  `BASELINE_CEILING` lowered by exactly that many; the artefact checks green) ·
  `## Blocked by` (T0, plus any shared sub-grammar gap it routes through, and
  the `/new-op` note when the verdict says so) · `## Related` ·
  `## Target files` (the slot/sub-grammar file, `convex/oracle/lower*.ts`, the
  fixtures — coarse is fine; `- *` if it touches everything).
- **Native edges, always.** Every ticket is a native SUB-ISSUE of the umbrella
  in the pass that creates it — `gh issue edit <child> --parent <umbrella>` —
  and every `## Blocked by` ref is ALSO wired natively
  (`gh issue edit <n> --add-blocked-by <m>`), then read back for parity with
  `bun run queue:lint <tickets…>` — its `dependency-parity` finding names each
  side's missing refs and the one-line fix (issue #3794). The
  planner sorts by `parent.number ?? number` off its cheap Stage-1 list call,
  so an edgeless ticket sorts on its own number and the set's later slices land
  at the BACK of the queue while its earlier ones starve. Verify rather than
  assume: `gh issue view <umbrella> --json subIssuesSummary` must report
  `total` equal to the number of tickets just cut. The `## Parent` body line is
  for humans and is NOT the sort key.

**One residue ticket.** Title `[<CODE>] Guard C residue — <N> hand-tail cards`.
Body: the `hand-tail` names from Phase 0.4, the policy agreed in the grill, and
the marker each hand-written card owes (`compiler-gap: <fragment> (#issue)` or
`hand-tail:`, naming an OPEN gap issue — `check:targets` reds on a marker whose
card is now `ready`, and on one whose residual gaps have risen above the
floor). `ready-for-agent` + `area:cards`. It authors nothing by default: it is
the queue the migration kind drains.

**One acceptance ticket.** Title `[<CODE>] Acceptance — <target> % ready`.
Body: the target percentage, the command that proves it
(`bun run oracle:report --set <code>`, header line quoted), `unclaimed == 0`
via `bun run check:targets`, and the flip of `enforced: true` on the Target's
row once it holds. **Blocked-by every gap ticket and the residue ticket** — it
is what closes the umbrella.

**Reconcile before you stop.** The cards named across the cut tickets plus the
residue must equal the manifest's `unclaimed ∪ gap-pending ∪ hand-tail`
exactly: no card in the manifest missing from the tickets, none in two. A card
in no ticket is the ICE failure mode — catch it here, not six months later.

## Phase 4 — Coverage closure

Three layers, all computed; wire all three:

1. **`bun run check:targets`** (the Coverage Invariant, issue #3868) — reds on
   any `unclaimed` card of an ENFORCED Target, on a `hand-tail:` marker whose
   card is now `ready` (retire the hand-written twin, ADR 0114), and on one
   whose residual gaps have risen above the floor (flip it to `compiler-gap:`).
   Offline, runs in `health` only — never in `check:all`, `check:pr` or `land`.
   The acceptance ticket flips `enforced: true` on this set's row; do not flip
   it earlier, or the set reds `health` for every other session while its
   tickets are still open.
2. **`bun run check:gaps`** — every implemented Op that no Compiled Definition
   emits has its allowlist row with an issue, and the allowlist only shrinks
   (ADR 0105 § 7.3).
3. **`bun run check:stubs`** (in `check:all`) — any commented stub in the
   residue carries a traceable disposition (`// tracked-by: #NNN`, a bare
   `#NNN`, or an `out of scope` / `ADR NNNN` marker), and no commented block
   duplicates an active definition. Only the residue can produce a stub in v2.

`bun run gaps:sync` files the computed kinds idempotently, parented under this
set's umbrella once its title matches: `mechanic`, `scenario`, `migration` and
the Op-census `grammar` rows today. **Two of the six file nothing yet, and the
rollout must not plan around them**: `bot` has no sweep (issue #3830), and
`hand-tail` files only for cards of an `enforced` Target in
`data/targets.json` (issue #4219; only `set-apc` today) — a run prints the held
count for every other Target. That is exactly why Phase 3 cuts the **residue
ticket by hand**: until the set's Target is enforced, nothing else claims the
hand tail. **Never run it from a worktree** —
it commits the allowlist and pushes `HEAD:<base>` from its cwd. `land` runs it
post-merge from the primary checkout; `--dry-run` prints the plan and writes
nothing.

## Testing requirements (every gap slice)

`/grammar-rule` owns the per-slice detail; what the rollout holds every slice to:

- **One golden fixture per accepted form, each proven to fail** — the Oracle
  text of a real corpus card and the Compiled Definition it must produce. Break
  the rule, watch the fixture go red, revert, say what you broke
  (`.claude/rules/gre-development.md` § Proof-of-failure). A form nobody prints
  is not a form; never accept a shape "for completeness".
- **A refusal test per refused neighbour** — fail-closed is a property the
  tests pin, not a promise.
- **Gold precision over the hand-written catalogue** stays gated at 100 % of
  the cards the compiler accepts (`convex/oracle/__tests__/gold.test.ts`,
  ADR 0105 § 4). A rule that reads a hand-written card differently is
  adjudicated — the card is fixed, or the rule is, or a `KNOWN_DIVERGENCES` row
  carries the argument in full. Never relaxed.
- **`ready` delta read back** (`bun run oracle:report --delta`): `lost` must be
  0, and a `delta` far below the gap's `compiles` means the graduates stopped
  in `quarantine` — read their `reason.kind` before calling the rule done.
- **Guard C graduation** — hand-written cards that now round-trip leave
  `compilerRoundTrip.baseline.ts` (a pure deletion) with `BASELINE_CEILING`
  lowered by exactly that many, and their stale markers deleted.
- **Bot reachability is still a WALK, not a computation.** ADR 0137 says it is
  computed, but the Bot-play sweep is issue #3830, open — nothing writes
  `botReach` today. A graduated card owes the manual three-seam walk of
  `.claude/rules/gre-development.md` § Bot reachability over the Ops its rule
  emits: `enumerateMoves`, the choice surface, `OP_VALUERS` + `OP_BENEFICENCE`.
- **A preset scenario per slice** (ADR 0044) — a graduated card is a new card in
  the catalogue, so the ```json `{ "label", "spec": { "cards" } }`fence under`## Preset scenario`is owed;`land` refuses the merge without it and seeds it
  post-merge. "None owed" only when nothing graduated.
- **Cadence**: targeted runs while iterating
  (`bunx vitest run convex/oracle convex/cards/__tests__`); no pre-PR lane gate
  — `land` pays the lane once on the rebased tip (ADR 0136).

## Model routing recap (two axes — don't conflate them)

- **Inside this skill**: only Phase 0's gathering is delegated, to
  `model: sonnet` sub-agents (A, B, C, E). The cut line, the Op verdicts (E′),
  the manifest and the ticket shapes are never delegated — they are the
  reasoning the rollout is bought with. Phases 1–3 are an interactive interview
  plus synthesis over it. Run `/new-set` itself on Opus.
- **Downstream**: `to-tickets` stamps the `model:*` and `area:*` labels, and
  `/next-issue` routes each ticket's review to that tier (**no label ⇒
  Sonnet**). The criterion is `docs/agents/triage-labels.md` § Model-routing
  labels, the single authority — this skill does not restate it.

## Reference

- ADR 0137 (grammar-first authoring), ADR 0105 (fail-closed compiler, § 7 the
  amendment), ADR 0045/0046 (frozen constructs, registry seam), ADR 0041
  (worklist/import), ADR 0014 (prints vs defs), ADR 0010 (ante/subgame)
- Skills: `/grammar-rule` (implements one gap ticket), `/new-op` (inside a gap
  ticket when its rule needs an Op), `/mtg-rules-check`,
  `{grill-with-docs,to-prd,to-tickets}`
- Commands: `oracle:report` (`--set` / `--pool` / `--targets` / `--gap` /
  `--gaps` / `--delta`), `oracle:compile`, `oracle:index`, `catalogue:pack`,
  `check:targets`, `check:gaps`, `check:oracle`, `check:index`, `check:stubs`,
  `gaps:sync`
- Pilot: PRD issue #3795 (APC) — its ranked-backlog comment is the reference
  output of Phase 0.3. Wayfinder map issue #3846; Target List issue #3848.
