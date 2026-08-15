# The as-enters choice point: one battlefield-entry chokepoint and an entry park

## Status

proposed

## Context

An **As-Enters Choice** (see `CONTEXT.md`) is a decision a permanent requires
_before_ it enters the battlefield. CR 614.12a: "If a replacement effect that
modifies how a permanent enters the battlefield requires a choice, that choice
is made before the permanent enters the battlefield." The rule is indifferent to
_how_ the permanent got there — CR 614.12's own first example is Voice of All,
and its second half is a **token copy** of Voice of All choosing a colour as the
token is created.

This engine raises such a choice only while a permanent SPELL is on the stack:

- `chosenModeId` is written only from `castSpell` announcement args
  (`convex/game.ts:2478`, `:2863`, `convex/gre/state.ts:15731`);
- `resolveSteps` runs behind `if (isSpell && cardDef?.resolveSteps …)`
  (`convex/gre/state.ts:4876`) — the spell-resolution path only;
- the one existing "entersWith" hook, `applyEntersWithCounters`
  (`convex/gre/state.ts:5302`), handles counters and nothing else.

Ten shipped cards therefore skip their choice on every non-cast entry, and for
eight of them the failure is card-destroying rather than inert: a reanimated
Clone or Phantasmal Image enters as its printed 0/0 and the next SBA sweep bins
it (CR 704.5f). That is how this reached us — a user bug report, not a
catalogue observation (#2451, game `jh733ewpjtfbaa84mmnrthyx8s8c6n09`, seq 321).

The umbrella spec is #2043; this ADR is its first slice (#2466) and unblocks
#2019, #2451 and the non-modal leg.

### Entry-path census

Every site that puts an object onto a battlefield, proven by sweeping
`battlefield.push(` across `convex/` (11 hits total) and every `moveCard(…,
"battlefield")` call:

| #   | Funnel                         | Site                                                                        | Covers                                                                                                                                               |
| --- | ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `finalizeSpellResolution`      | `state.ts:5806`                                                             | permanent spell resolution                                                                                                                           |
| 2   | `stageReanimatedOnBattlefield` | `state.ts:10162`, `:10179`                                                  | reanimation, `moveZone` with `to: "battlefield"`, put-onto-battlefield, tutor-to-battlefield, and the CR 400.7 batch `putReanimatedSetOnBattlefield` |
| 3   | `createTokenPermanents`        | `state.ts:16851`                                                            | token creation and `createTokenCopy` (Dance of Many, `drk/blue.ts:858`)                                                                              |
| 4   | `settleEnteredLand`            | `playLand.ts` (`:117` hand, `:193` exile, `:238` graveyard, `:291` library) | land play from all four origins                                                                                                                      |

Not entries, deliberately excluded:

- `phaseInBundle` (`state.ts:8638`) — CR 702.26d: phasing in is not entering the
  battlefield and fires no zone-change trigger.
- the two control-change pushes (`state.ts:7497`, `:7571`) — CR 110.2: a change
  of control is not a zone change.

Outside the GRE and out of scope: `convex/gre/scenarioBuilder.ts` (debug
seeding) and `convex/manual.ts` (Manual Mode runs beside the engine, ADR 0080).

The census also corrects the framing in #2043 and #2466: the four
`applyEntersWithCounters` call sites are not four scattered ad-hoc entries, they
are these same four funnels. There are four entry paths, not a long tail.

### Two shipped stackless precedents, of opposite shape

- **Land-entry** (ADR 0051): the permanent enters _provisionally_ in the
  worst case, the ETB emission is deferred to `finalizeLandEntry`, and the
  resolution does **not** suspend (`land-entry-tapped` is the single exemption
  in `resolutionSuspendedOnChoice`, `state.ts:4759`).
- **Aura host** (CR 303.4f): the Aura is held **off every zone** in
  `GameState.stagedAuraEntries` and enters later, through `finalizeAuraHost`.

The land-entry shape cannot carry this capability. `checkStateBasedActions`
(`sba.ts:778`) has no gate on `pendingChoices`, and `game.ts:11696` runs it
right after `resolveTopOfStack` **including when the resolution suspended on a
choice**. A Clone that entered provisionally as a 0/0 is dead before its own
prompt is answered.

## Decision

### 1. One entry chokepoint

Extract `enterBattlefield(state, card, controllerId, { origin, wasCast })`,
owning the entry contract end to end, and route all four funnels through it:

```
enterBattlefield()
  → redirect check      (Containment Priest CR 614.1c, Worms of the Earth)
  → AS-ENTERS CHOICES   ← new
  → entersWith counters + printed loyalty
  → shouldEnterTapped
  → push + CR 611.2 grants
  → emitPermanentEntered (CR 603.6)
```

Path-specific work (Aura attachment, the land drop record CR 305.2, token id
minting) stays in the funnel, outside the chokepoint. The contract does not.

### 2. The choice is declared, in one closed union

A new structural field on `CardDefinition`, sibling of `entersWith` — which is
already exactly this: a CR 614.1c replacement declared as **data**, not as
`EffectOp`s (`convex/cards/entersWith.ts`).

```ts
asEnters?: AsEntersChoice[]

type AsEntersChoice =
  | { kind: "mode";      modes: Mode[] }                    // Voice of All, Prismatic Ward
  | { kind: "name";      filter?: CardFilter }              // Meddling Mage
  | { kind: "subtypes";  pairs: [string, string][] }        // Illusionary Terrain
  | { kind: "body";      options: BodySpec[] }              // Primal Clay, Shapeshifter
  | { kind: "copy";      filter?: PermanentFilter; optional?: true; opts?: CopyEffectOptions }
  | { kind: "pay";       cost: MayPayCost }                 // shock lands, was ADR 0051
  | { kind: "aura-host" }                                   // CR 303.4f
  | { kind: "anchor";    options: [AnchorOption, AnchorOption] }  // CR 614.12c
```

Every answer is a write to a typed field that already exists —
`chosenModeId`, `chosenName`, `chosenSubtypes`, the `setSelfBody` quadruple
(`power`, `toughness`, `subtypes`, `staticAbilities`), or `applyCopy`. The
applier is exhaustive over the union (`assertNever`), so a new kind cannot be
added without a writer. The spec is invocable outside the entry window too:
Shapeshifter re-picks the same `body` from an upkeep trigger.

### 3. The permanent waits in an entry park

While its choices are pending, the entering object is held in **no zone** —
`GameState.stagedEntries`, the generalisation of `stagedAuraEntries`:

```ts
StagedEntry = {
    card: CardInstanceState;
    controllerId: string;
    origin: "cast" | "effect" | "token" | "land-play";
    pending: AsEntersChoiceId[];
    answers: Record<AsEntersChoiceId, Answer>;
    resume?: { stackItemId: string; step: number };
};
```

Being in no zone is what makes this correct, and it is stronger than gating any
single reader: SBA, the layer system, target legality, the trigger scan and
`projectPublicState` are all blind to it by construction, rather than each
needing its own guard.

`resolutionSuspendedOnChoice` is deleted. Every as-enters choice suspends the
resolution, the exemption included.

### 4. Resume is real, and the suspending Op memoises its entry

The park carries `resume`. When the last choice is submitted, the finalizer
completes the entry through `enterBattlefield` and — like the generic
mid-resolution submit already does (`pendingChoiceSubmit.ts:1105-1120`) — calls
`resolveTopOfStack` to resume.

The interpreter restarts execution **at** the suspending Op, so `moveZone` must
be memo-aware: the finalizer records the completed entry in the stack item's
`collectedChoices` under `${step}:${entryId}`, and on replay `moveZone` reads
"already entered, id X" and runs only its post-entry tail (the `bind` snapshot,
the `tapped` flag). No new field: this is the memoisation the `choice` Op has
used since #805.

This is what keeps "put it onto the battlefield, **then** do something to it"
working across a suspension.

### 5. The choice is entry-time on every path, cast included

CR 601.2b announces a mode only for a **modal** spell (CR 700.2, a bulleted
"choose one"). Voice of All is not modal — its clause is a CR 614.12
replacement, so the colour is chosen as it **enters**, even when it is cast.
Modelling it as `CardDefinition.modes` (`pls/white.ts:812-829`, and the same
idiom in Prismatic Ward, Quirion Elves, Jihad) is a timing divergence on the
cast path as well, and an observable one: today the opponent sees the chosen
colour before deciding whether to counter, and a countered Voice of All has
revealed it for nothing.

So the seam is the **only** source of as-enters choices. `modes` goes back to
meaning what it is for — the genuinely modal spell announced at CR 601.2b — and
the four cards piggybacking on it migrate.

### 6. Scope answers

- **Token copies (CR 707.6): in, by construction.** `createTokenPermanents`
  routes through the chokepoint, and CR 707.6 is explicit that copied choices
  are not copied and the copy's controller makes fresh ones. The chokepoint
  reads `asEnters` off the **copied** definition, which is CR 614.12's own
  worked example.
- **#1980 (a land played from EXILE skips the pay-choice): subsumed.** The
  `pay` kind is raised by the chokepoint, which all four land origins traverse,
  so no origin can bypass it. The stale scope note in `playLand.ts:161-164`
  goes with the fix.
- **CR 614.12b: in.** The batch path collects every answer for the set before
  completing any entry, so the affordability gate reads the combined cost
  instead of each in isolation. Reachable today only with two copies of the one
  shipped `entersTappedUnlessPay` land (`spm/colorless.ts:40`), but the batch
  shape is needed for CR 614.12a simultaneity regardless.
- **CR 614.12c (anchor words, CR 607.1 linked abilities): in, as an inert
  kind.** No shipped card uses anchor words; the union carries the kind and the
  registry row so the mechanic is whole, with no card exposing it.

## Considered Options

- **A shared `raiseAsEntersChoices()` helper called from each of the four
  funnels**, no chokepoint. Rejected: it reproduces the shape #2043, #1980 and
  #1693 all came out of — a fifth entry path is born incomplete and no guard
  sees it.
- **Provisional entry plus a global SBA gate on `pendingChoices`.** Tempting,
  and CR 704.3 does say state-based actions are checked when a player would
  receive priority — which a mid-resolution suspension is not, making today's
  sweep a divergence in its own right. Rejected as the mechanism: it closes one
  of the five windows through which a half-entered permanent is visible
  (layers, targeting, the trigger scan and the wire projection stay open), and
  it changes `legend-keep`, which depends on the post-submit re-sweep
  (CR 704.5j). Recorded as a separate finding, not adopted here.
- **Raising the choice before the object leaves its origin zone** (the
  `applyPlayLand` shape, which enqueues before `moveCard`). Rejected: a token
  has no origin zone, and the CR 400.7 batch has already spliced its cards out
  of the graveyard to keep the move atomic. Two mechanisms where the park is
  one.
- **An as-enters Effect Script (`entersEffects: EffectOp[]`).** The DSL-first
  default (ADR 0045) points here, but the five writers are typed field writes,
  not effect vocabulary; `becomeCopyOf` is deliberately absent from the
  Mechanics Registry (`m12/blue.ts:28`), so this is the new-Op tax five times
  over; and the interpreter checkpoints on `StackItem.resolutionStep`, while
  two of the four funnels (token, land play) have no stack item at all — which
  is the reason the park exists. `entersWith` is the governing precedent: an
  as-enters replacement is declared as data.

## Consequences

- `stagedAuraEntries` is absorbed into `stagedEntries` and the
  `land-entry-tapped` exemption disappears, so CR 614.12 has one mechanism
  instead of three. Shock lands change behaviour: the pay-choice now genuinely
  suspends the resolution instead of being answered in the next priority window.
- **Serialization is not a passthrough.** `stagedEntries` replaces
  `stagedAuraEntries` in `PERSISTED_OPTIONAL_KEYS` (`serialize.ts:1519`) with a
  round-trip smoke test at a non-empty value, but the card serializer expands
  cards **per zone** (`expandCard(c, { zone }, ctx)`, `serialize.ts:1063`) and a
  parked card is in none — the park needs its own branch there. The three
  single-purpose `PendingChoice` fields (`landInstanceId`, `auraInstanceId`,
  `subjectCardId`) collapse into `entryInstanceId` plus `subjectCardId`.
- **Owed-ness is free; bot visibility is not.** `computeExpectedInput` already
  reports `pendingChoices[0]` (`expectedInput.ts:47-56`), so ADR 0047 needs
  nothing, and `brain.ts:1081` is `assertNever`-exhaustive over choice kinds, so
  every new kind forces a bot branch at compile time. But `bot-view.ts` projects
  zones, so a parked subject is invisible to the bot — it needs the same park
  branch the serializer does, plus a search-side drain on the model of
  `autoFinalizeLandEntryChoices` (`applyMove.ts:93`).
- The prompt must render a card that is in no zone. The affordance exists:
  `PendingChoice.subjectCardId` was added for `choose-aura-host` precisely so
  the client can show which card a prompt is about.

## Findings surfaced, not fixed here

1. **#2478** — `checkStateBasedActions` runs with `pendingChoices` non-empty
   (`sba.ts:778`, called at `game.ts:11696`), against CR 704.3. Latent today
   because no half-entered permanent has ever been illegal.
2. **#2479** — none of the three stackless finalizers (`finalizeAuraHost`,
   `finalizeLegendKeep`, `finalizeLandEntry`) reaches the resume block that
   `pendingChoiceSubmit.ts:1105-1120` runs for a stack-coupled choice — each
   returns early and hands priority to the active player instead. For two of
   them that is harmless: `legend-keep` is raised from the SBA sweep, never
   mid-resolution, and `land-entry-tapped` is the one kind exempted from
   `resolutionSuspendedOnChoice`, so neither ever suspends a resolution.
   `choose-aura-host` is neither. An Aura with two or more legal hosts inside a
   CR 400.7 batch (`putReanimatedSetOnBattlefield`, reached from
   `state.ts:11991` / `:12035`) therefore suspends its stack item and strands
   it: the active player is handed a priority window in the middle of a
   resolution, which CR 608.2 gives to nobody, and the item resumes only on the
   next pass cycle.

## Slicing

This ADR re-slices #2043. Every intermediate state is an engine capability with
no card exposing it, per `.claude/rules/gre-development.md`.

| Slice | Content                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| 1b    | `enterBattlefield` chokepoint — pure refactor of the four funnels, no behaviour change                         |
| 1c    | entry park, `asEnters` union, absorption of `aura-host` and `pay` (closes #1980)                               |
| 2     | cast path moves to entry-time; `modes` / `chosenModeId` piggyback retired (was #2019)                          |
| 3     | `name`, `subtypes`, `body` legs — Meddling Mage, Illusionary Terrain, Primal Clay, Shapeshifter, Nameless Race |
| 4     | `copy` leg — Clone, Copy Artifact, Vesuvan Doppelganger, Phyrexian Metamorph, Phantasmal Image (was #2451)     |
