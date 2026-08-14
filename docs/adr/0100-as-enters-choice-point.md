# The as-enters choice point extends the CR 614 entry chokepoint, and the entering permanent is staged off every zone until it answers

## Status

proposed

## Context

CR 614.12a: _"If a replacement effect that modifies how a permanent enters the
battlefield requires a choice, that choice is made before the permanent enters
the battlefield."_ CR 614.1c makes every "As [this] enters …" / "[This] enters
as …" clause such a replacement effect.

This engine can only raise such a choice while a permanent **spell** is on the
stack. `resolveSteps` runs behind `if (isSpell && cardDef?.resolveSteps …)`
(`convex/gre/state.ts:4876`), and `chosenModeId` is written only from
`castSpell`'s announcement args (`convex/game.ts:2478`, `:2863`,
`convex/gre/state.ts:15731`). Ten shipped cards therefore lose their as-enters
choice on every non-cast entry — reanimation, put-onto-battlefield, blink from
exile, token copy. Three of the ten are card-destroying rather than merely
inert: a Primal Clay or a reanimated Clone enters as its printed 0/0 and the
next sweep puts it in the graveyard (CR 704.5f). That is the shape of the
originating user bug report on #2451 ("Reanimate on phantasmal image doesn't
work").

PRD #2043 collects them; this ADR is its slice 1 (#2466) and unblocks slices 2
(#2019, modal), 3 (#2467, non-modal storage fields) and 4 (#2451, copy).

### 1. Entry-path census

The census is not an enumeration of card effects — it is the set of code sites
that write `zone = "battlefield"` for a `CardInstanceState`. There are **three**:

| #   | Site                                                                                             | Covers                                                                                                                                                                                                                                                                                       | Stack item |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A   | `finalizeSpellResolution` — `gre/state.ts:5634`, writes `zone` at `:5737`                        | a permanent spell resolving off the stack                                                                                                                                                                                                                                                    | **yes**    |
| B   | `stageReanimatedOnBattlefield` — `gre/state.ts:10068` (+ `finishReanimatedEntry` `:10191`)       | every non-cast entry: `moveZone` → battlefield (`:12055`, `:12070`), blink / return from exile (`:12231`), reanimated Aura + host bundle (`:8798`, `:8827`), the batch path `putReanimatedSetOnBattlefield` (`:10272`, #1094), **and land play** (`gre/playLand.ts:383`, `:417` funnel here) | no         |
| C   | `createTokenPermanents` — `gre/state.ts:~16763` (+ `createTokenCopyOf` `:13455`, which calls it) | token creation and token copies                                                                                                                                                                                                                                                              | no         |

**Why the list is closed, rather than merely long.** The CR 614
enters-the-battlefield **replacement** chokepoint, `enterBattlefieldDestinationFor`
(`gre/replacements.ts:692`), has exactly three callers: `state.ts:5669`,
`:10091`, `:16827` — one per row above. An entry path that did not pass through
it would already be a live bug today (Containment Priest, #1148, would miss it),
so the census is guarded by an invariant the suite already exercises rather than
by this document's diligence.

`convex/manual.ts:1119` also writes `zone: "battlefield"`, on a
`ManualCardInstance` in the paper-mode verb engine. That is a different state
type with no rules engine behind it and is out of scope here.

### 2. What already exists

The hard part #2466 posed — suspend and resume an entry with no stack item to
key `collectedChoices` against — is already solved twice in this engine:

- **Aura host pick (CR 303.4f).** `enqueueAuraHostChoice` (`state.ts:10354`)
  holds the Aura in `state.stagedAuraEntries` — **off every zone**, so no SBA
  (CR 704.5m) and no wire projection observes an unattached Aura mid-choice —
  and enqueues a `PendingChoice` with `stackItemId: ""`. `finalizeAuraHost`
  (`state.ts:10421`) pulls the entry, attaches, and only **then** calls
  `stageReanimatedOnBattlefield`. The state key is persisted
  (`serialize.ts:1519`).
- **Entry-tapped pay choice.** A shock land put onto the battlefield by an
  effect enters provisionally tapped, enqueues a stackless
  `land-entry-tapped` choice and **defers** `PERMANENT_ENTERED` to
  `finalizeLandEntry` (`playLand.ts:515`), so no ETB trigger observes the
  intermediate state.

`resolutionSuspendedOnChoice` (`state.ts:4759`) is already the gate that stops
a resolution from proceeding past a stackless choice, and
`computeExpectedInput` (`gre/expectedInput.ts:44-56`) already reports owed-ness
off `pendingChoices[0]` regardless of `stackItemId`, so a staged entry cannot
freeze the game (ADR 0047).

So the seam is not invented here. It is **generalised**.

## Decision

### D1 — The choice point extends the CR 614 chokepoint

`enterBattlefieldDestinationFor` stops answering "which zone" and answers "what
happens next": `"enter"` | `"exile"` | `{ asEnters: AsEntersChoice[] }`. It
keeps its three existing callers and gains no new ones. The alternative — a new
unified `enterBattlefield()` that A and C are refactored to call — was rejected
for this slice: it rewrites two hot paths (spell resolution, token creation)
for a benefit the three-caller invariant above already delivers.

The rejected non-option is attaching the choice to each site independently, the
`applyEntersWithCounters` shape (four call sites, `state.ts:5816`, `:10142`,
`:13481`, `playLand.ts:420`). That is the anti-pattern the fourth future entry
path silently forgets.

### D2 — The entering permanent is staged off every zone

`StagedAuraEntry` generalises to `StagedEntry`, and `stagedAuraEntries` to
`state.stagedEntries`. The Aura host pick becomes **one kind of as-enters
choice**, not a parallel mechanism:

```ts
interface StagedEntry {
    /** The permanent, off every zone until every owed choice is answered. */
    card: CardInstanceState;
    controllerId: string;
    /** Which census row is resuming it. */
    origin: "spell" | "effect" | "token";
    /** Answered head-first; may GROW mid-flight (see D4). */
    owed: AsEntersChoice[];
}
```

Provisional entry — the shock-land model, permanent on the battlefield with the
choice pending — is explicitly rejected for as-enters choices in general: a
Clone parked on the battlefield as a printed 0/0 dies to the CR 704.5f sweep,
which is the reported bug, and CR 707.5 forbids the shape outright ("It doesn't
enter the battlefield, and then become a copy of that permanent"). The existing
`land-entry-tapped` park keeps its provisional-entry form (it is safe there:
nothing observes the tapped bit, and the event is deferred), but no new choice
kind may use it.

`stagedEntries` replaces `stagedAuraEntries` in `PERSISTED_OPTIONAL_KEYS`
(`serialize.ts`): it is transiently non-empty exactly while a matching choice is
pending, which is itself a stable save point, so it must survive the DB
round-trip. It carries a fat `CardInstanceState`, so it needs the same
per-field compaction the Aura entry has today, not the generic optional-key
loop.

### D3 — The declarative surface is data, in the `entersWith` family

Slices 2–4 declare, they do not each roll a prompt:

```ts
entersWith: {
    counters: [...],                        // unchanged, already shipped
    asEnters: [
        { kind: "mode" },                   // → chosenModeId          (#2019)
        { kind: "name", filter },           // → chosenName            (#2467)
        { kind: "subtypes", from, count },  // → chosenSubtypes        (#2467)
        { kind: "body", options },          // → power / toughness     (#2467)
        { kind: "payLife", cap },           // → feeds `body`          (#2467)
        { kind: "copy", filter, opts },     // → becomeCopyOf          (#2451)
    ]
}
```

This is **not** an Effect Script and no `EffectOp` is added. A CR 614.1c
replacement is a declaration, not an effect that resolves — the same reason
`entersWith.counters` is data today (`cards/mechanicsRegistry.ts:2126`: "no
Effect Script involved"). The interpreter also has no coherent `$self` here:
the card is in no zone. `/new-op`'s seven registration sites are therefore not
walked by this work.

Nameless Race (`drk/black.ts:399`) is not a special case under this shape: it is
`payLife` with a board-derived cap, feeding `body`. Two kinds composing beats a
sixth bespoke one.

### D4 — The owed list is discovered, not fixed (CR 707.6)

CR 707.6: _"if an object enters the battlefield as a copy of another permanent,
the object's controller will get to make any 'as [this] enters the battlefield'
choices for it."_ CR 707.5 adds that the copied text's own "enters with" /
"as enters" abilities take effect.

So the owed list is **sequential and dynamic**, and this is the constraint that
shapes the implementation:

1. `{ kind: "copy" }` is answered first.
2. The copy is applied to the staged card.
3. The **copied** definition's `entersWith` is then read off the staged card:
   its `asEnters` entries are appended to `owed`, and its `counters` are applied
   by the existing `applyEntersWithCounters`.
4. Only when `owed` is empty does the entry resume.

A reanimated Clone copying Meddling Mage therefore owes two choices in order —
which permanent to copy, then which card name — and the name is a **fresh**
pick, never the original's (CR 707.6). An `asEnters` list read once, up front,
off the printed definition, is wrong for every copy card in slice 4; a
fixed-length list is the bug this clause pre-empts.

### D5 — Scope

| Question                       | Answer | Why                                                                                                                                                                                                                                       |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token copies (CR 707.6)        | **in** | Census row C is already a chokepoint caller, so covering them costs nothing and excluding them would cost a deliberate branch. CR 614.12's own worked example is a **token copy of Voice of All** — the exact card #2019 is about.        |
| #1980 (land played from exile) | **in** | Same CR 614.12 family (pay 2 life as it enters) on census row B, which land play already funnels through. Subsumed by construction; the slice that lands it closes #1980.                                                                 |
| CR 614.12b (simultaneous)      | **in** | Against this ADR's own initial recommendation, by maintainer decision. Shipped as an **engine capability with no card exercising it** (`.claude/rules/gre-development.md` — intermediate slices are capabilities, not partial mechanics). |

CR 614.12b — _"that player may not make choices for those effects that would
cause the combined costs of those effects to not be payable"_ — binds only the
batch path `putReanimatedSetOnBattlefield` (#1094), the one site that stages
several entries at once. Concretely: when two staged entries owe cost-bearing
choices (today only `payLife`, tomorrow the #1980 pay-2-life) to the same
player, the candidate set offered for the second is constrained by what the
first committed. None of #2043's ten cards reaches this — no shipped card pairs
a cost-bearing as-enters choice with a simultaneous entry — so it ships with
engine tests only and no card wired to it.

## Consequences

- **One place to forget.** A fourth entry path added later cannot skip the
  as-enters choice without also skipping the CR 614 replacement check, which
  the Containment Priest suite already fails on.
- **`stagedAuraEntries` is renamed, not duplicated.** Slice 1 carries a
  mechanical rename plus the serializer key swap; the CR 303.4f/g behaviour
  (illegal host → Aura to graveyard) moves under the shared finalize unchanged
  and keeps its tests.
- **Every new choice `kind` owes the bot a `botActionRealisation` arm.** Owed-ness
  is reported for free by `computeExpectedInput`, but a `kind` the bot's
  exhaustive dispatch does not realise is a freeze, not a bad play (ADR 0047,
  #2283/#2284). This is a per-slice obligation, and it is why slices 2–4 each
  ship their kinds' bot arms rather than slice 1 stubbing all six.
- **Slice 1 wires no card.** It lands this ADR, the `StagedEntry` generalisation,
  the chokepoint verdict, and the CR 614.12b batch constraint, with the
  `asEnters` union declared and no `CardDefinition` populating it. The ten cards
  arrive in slices 2–4.
- **Client surface.** The staged permanent is in no zone, so the choice dialog
  must render it from `subjectCardId` — the pattern `choose-aura-host` already
  uses (`state.ts:2515`). No new projection field.

## References

- CR 614.1c, 614.12, 614.12a, 614.12b, 614.12c, 704.5f, 707.5, 707.6
  (printed from `data/cr/comprehensive-rules.txt`, ADR 0098)
- PRD #2043; slices #2466 (this), #2019, #2467, #2451; subsumed #1980
- ADR 0047 (Expected Input), ADR 0051 (land entry pay-choice — the stackless
  `PendingChoice` prototype), ADR 0078 §7 (deferred entry-counter events)
