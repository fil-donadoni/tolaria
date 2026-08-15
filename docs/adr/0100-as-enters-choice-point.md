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
(`convex/gre/state.ts:4876`), and **no path sets `chosenModeId` as a permanent
enters**. It is written at cast announcement (`convex/game.ts:6812` validator,
`:6982-6995` modal validation, the writes at `:7194` / `:7297` / `:7354`) and
onto the stack item (`convex/gre/state.ts:16501`); an activated ability carries
its own (`convex/game.ts:12611`, `:12772`). The one non-cast write —
`SpellContext.setChosenMode` (`convex/gre/state.ts:11663`) — rewrites the field
on a permanent **already on the battlefield**, post-ETB (Chromatic Armor / the
shipped Prismatic-Ward shield): a re-choice, not an entry choice. So the gap is
specifically the entry moment, and slice 2 (#2019) must not assume the field has
a single writer. Ten shipped cards therefore lose their as-enters
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

| #   | Site                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                       | Stack item |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A   | `finalizeSpellResolution` — `gre/state.ts:5634`, writes `zone` at `:5737`                                                               | a permanent spell resolving off the stack                                                                                                                                                                                                                                                    | **yes**    |
| B   | `stageReanimatedOnBattlefield` — `gre/state.ts:10068` (+ `finishReanimatedEntry` `:10191`)                                              | every non-cast entry: `moveZone` → battlefield (`:12055`, `:12070`), blink / return from exile (`:12231`), reanimated Aura + host bundle (`:8798`, `:8827`), the batch path `putReanimatedSetOnBattlefield` (`:10272`, #1094), **and land play** (`gre/playLand.ts:383`, `:417` funnel here) | no         |
| C   | `createTokenPermanents` — `gre/state.ts:16683`, writes `zone` at `:16772` (+ `SpellContext.createTokenCopyOf` `:13391`, which calls it) | token creation and token copies                                                                                                                                                                                                                                                              | no         |

**Why the list is closed, rather than merely long.** The CR 614
enters-the-battlefield **replacement** chokepoint, `enterBattlefieldDestinationFor`
(`gre/replacements.ts:692`), has exactly three callers: `state.ts:5669`,
`:10091`, `:16827` — one per row above. An entry path that did not pass through
it would already be a live bug today (Containment Priest, #1148, would miss it),
so the census is guarded by an invariant the suite already exercises rather than
by this document's diligence.

Two sites are **deliberate carve-outs**, outside the chokepoint by design:

- `convex/manual.ts:1119` writes `zone: "battlefield"` on a
  `ManualCardInstance` in the paper-mode verb engine. Different state type, no
  rules engine behind it, out of scope here.
- `convex/gre/scenarioBuilder.ts:403` (and the land filler at `:414`/`:415`)
  pushes instances **straight onto `player.battlefield`**. Its local
  `makeInstance` does set `zone` from its parameter (`:173`) — what keeps the
  census closed under its own grep-based definition is that there is **no literal
  `zone = "battlefield"` assignment site and no `enterBattlefieldDestinationFor`
  call** on this path. Its own comment at `:238` calls it "a raw
  `battlefield.push` that emits nothing", because a seeded board must not fire
  every ETB trigger in the catalogue. **Consequence for slices 2–4: a preset
  debug scenario can never be the proof that the chokepoint works.** A seeded
  Clone or Primal Clay lands on the battlefield without passing
  `enterBattlefieldDestinationFor`, so it will show **no** as-enters prompt and
  will carry whatever body the spec gave it. That is the carve-out behaving as
  designed, not a bug in the slice; the scenario's job is to set up a
  _reanimation/blink/token_ that then re-enters through row B or C. The proof
  the chokepoint fires stays a vitest test through the real entry path.

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

So the seam is not invented here. It is **generalised** — but only the **park**
half is precedent. Neither existing path resumes an outer resolution the way an
as-enters entry must, which is what D5 decides.

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

**Serialization — the Aura entry is NOT the precedent.** `stagedEntries`
replaces `stagedAuraEntries` in `PERSISTED_OPTIONAL_KEYS`
(`gre/serialize.ts:1519`): it is transiently non-empty exactly while a matching
choice is pending, which is itself a stable save point, so it must survive the
DB round-trip, and `TRANSIENT_KEYS` is an empty `Set` (`:1548`) that would red
the drift guard otherwise.

But `stagedAuraEntries` has **no per-field compaction anywhere** — line 1519 is
its only occurrence in `serialize.ts`; it rides the generic optional-key loops
at `:1569` (compact) and `:1632` (expand), which store and restore the value
raw. Its fat `card` therefore never goes through `compactCard`/`expandCard`
today. The real precedent is **`phasedOut`**, the one key with per-field card
compaction, and it has **both halves**:

1. a **compact** half — `compactState` overwrites the generically-stored value
   with the slimmed form (`serialize.ts:1579-1590`), carrying `ownerId`
   explicitly because a bundle card has no surrounding player to default from;
2. a **rehydrate** half — `expandState` maps the slim cards back through
   `expandCard` with an explicit `{ ownerId, zone }` (`:1643-1657`).

Both are mandatory for `stagedEntries`, plus its `PERSISTED_OPTIONAL_KEYS` row
and a **round-trip smoke test with a non-empty value** (`.claude/rules/gre-development.md`
§ Serialization requirement). Adding only the compact half yields a
`StagedEntry` whose `card` never rehydrates its definition — silently, at
exactly the save point this key exists for. Note the staged card is in **no**
zone, so the expand side must choose the `zone` it hydrates with deliberately
(`phasedOut` hardcodes `"battlefield"` because a phased permanent logically
still is one; a staged entry is not yet, and `stageReanimatedOnBattlefield`
resets `.zone` on entry anyway — see `state.ts:10360-10362`).

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

### D5 — Resume: the finalize drives it, and the parking Op must be replay-safe

Issue #2466 §3 asks how a resolution suspended on a stackless choice **resumes**.
The Aura precedent answers the park but not the resume, and copying its resume
half would ship a bug. Both halves are decided here because slices 2–4 cannot be
written without them.

**Who resumes it.** `finalizeAuraHost` (`state.ts:10421`) never calls
`resolveTopOfStack`: it re-runs SBAs and sets `priorityPlayerId` to the active
player (`:10457-10462`) and returns, and the `choose-aura-host` branch of
`applyPendingChoiceSubmit` returns early before the generic tail
(`gre/pendingChoiceSubmit.ts:992-1002`). So a resolution suspended on the Aura
pick is left on the stack with its checkpoint set and resumes only after a full
**priority round-trip** — a window in which either player may act mid-resolution,
whereas CR 117.3b gives the active player priority only _after_ the spell or
ability resolves. The as-enters finalize takes the **generic tail** instead
(`gre/pendingChoiceSubmit.ts:1103-1119`) — shift the queue, and when both `owed`
and `state.pendingChoices` are empty run the tail's completion branch — **but it
routes on `StagedEntry.origin`, because the tail's two branches are not
interchangeable**:

- **`origin: "effect"` (row B) and `origin: "token"` (row C)** take the
  `resolveTopOfStack(state)` branch (`:1106-1107`). The stack item that parked
  the entry is still on the stack (peek-and-pop: the pop happens only after the
  resolution finishes), so the suspended resolution really does resume, in the
  same mutation, and priority is restored only once it completes.
- **`origin: "spell"` (row A)** must **not** call `resolveTopOfStack`.
  `resolveTopOfStackInner` already popped the item (`state.ts:4894`, `:5248`)
  before `finalizeSpellResolution` ran, so there is nothing left to resume — the
  finalize itself runs the remainder of the entry tail and the resolution is
  over. Calling it here is wrong twice over: on an otherwise-empty stack it
  throws `Stack is empty` (`state.ts:4766`) and the player can never answer their
  own choice — a hard freeze on a **cast** Clone or Primal Clay, the primary case
  #2043 exists for; on a non-empty stack it resolves the **next** item in the
  same mutation with no priority round, which is precisely the CR 117.3b
  violation this decision sets out to avoid, and it fails silently. Row A takes
  the tail's **else** branch instead (`:1110-1115`) — priority back to the
  active player, `passCount = 0`, `drainAutoPasses`.

The routing cannot be recovered from the choice record, which is why D2 carries
an explicit discriminator: `stackItemId === ""` never reaches the tail at all —
the generic path throws `Stack item not found` at `:1019-1020` first, and that is
exactly why all four shipped stackless finalizes return early (`:975` draw-look-keep,
`:979` legend-keep, `:992` choose-aura-host, `:1004` discard-hand).

Because D2 folds the Aura host pick into the shared finalize, it acquires this
behaviour rather than keeping its own: it is row B, so it moves from "set
priority and wait for a round-trip" (`finalizeAuraHost`, `state.ts:10457-10462`)
onto the `resolveTopOfStack` branch. That is a **live behaviour change to a
shipped path, and slice 1 owns it** — with two obligations attached:

1. **The `gameOver` guard must survive the move.** `finalizeAuraHost` resumes
   only `if ((state.pendingChoices?.length ?? 0) === 0 && !state.gameOver)`
   (`state.ts:10460`); the generic tail has no `state.gameOver` check. Without
   it, an attach that kills a player through `checkStateBasedActions` would go on
   to resolve the next stack item in a finished game. The shared finalize carries
   the check.
2. **It needs its own guarding test**, named here because nothing else
   distinguishes the new tail from the old shape: _park a non-cast Aura entry on
   the host pick, answer it, and assert the suspended resolution COMPLETES in the
   same mutation_ — the stack item is gone and priority is the active player's,
   with no intervening priority window. Its proof-of-failure is the old shape:
   restore the "set `priorityPlayerId` and return" behaviour and watch it go red.

**What replays.** Resume is a **re-entry, not a continuation** — and the Op that
parked the entry is the one that re-runs:

- stepped resolve: `top.resolutionStep = i` is committed **before** step `i`
  runs (`state.ts:4877-4890`, deliberate — a `requestChoice` inside the step
  must key under the right step), so `start = i` on resume and step `i` replays
  from its beginning;
- Effect Script: `runOpList` skips every Op whose pre-order position is
  `< resume` — an already-completed, possibly irreversible side effect never
  replays — but **re-executes the Op at exactly `resume`**
  (`gre/effects/interpreter.ts:4809-4852`).

Replay-idempotence is therefore a per-row obligation, not a free property:

| Row        | Replays on resume?     | Why                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — spell  | **no**                 | `resolveTopOfStackInner` pops the item (`state.ts:4894`, and `:5248` on the non-stepped path) **before** calling `finalizeSpellResolution`. There is no stack item left to resume, so the as-enters finalize must itself run the remainder of the entry tail and the resolution is over. |
| B — effect | yes, harmlessly        | the re-run finds the card no longer in its source zone, so the Op's selector cannot be satisfied and it is skipped individually (CR 608.2b, `interpreter.ts:4802-4803`). This — not the mechanism — is why the Aura path survives its replay today.                                      |
| C — token  | yes, **destructively** | the `createToken` executor (`interpreter.ts:3801`) has no done-marker, so a bare re-run creates a **second** token.                                                                                                                                                                      |

Row C is load-bearing work for slice 4, not a detail: the token-entry Op must
guard its commit under its own checkpointed position via
`recallChoice`/`noteChoice` — the idempotent-commit idiom `castDuringResolution`
(`interpreter.ts:2080-2082`) and `coinFlipSync` already use — or the slice
duplicates the token. No test written for the _choice_ would catch it.

The marker must be **per token, not per Op**, because `createToken` takes a
resolved `count` and creates the whole batch in one call
(`interpreter.ts:3804`, `:3855`), and `createTokenCopy` has its own `count`
(`:3883`). A plain done-marker written at the Op's checkpoint short-circuits the
**entire** Op on re-entry, so a `count: 3` Op parked on the second token's choice
yields **one** token instead of three — the mirror of the duplicate bug, equally
silent. Either record which tokens of the batch were already created, or write
the marker for the whole batch at creation-and-staging time, before the first
park. The guarding test is therefore "park a token entry with `count: N`, answer
every owed choice, assert exactly N tokens" — run for `N = 1` **and** `N > 1`,
since the two values fail in opposite directions.

The rejected alternative is exempting as-enters choices from
`resolutionSuspendedOnChoice` (`state.ts:4759`) the way `land-entry-tapped`
is, which would sidestep replay entirely. It is wrong here: that exemption is
safe only because the land has **already entered** and nothing observes the
tapped bit, whereas an as-enters park holds the permanent off every zone — the
rest of the resolution would run without it, and D2 already rejects the
provisional-entry shape that would make it safe.

### D6 — Scope

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
  moves under the shared finalize unchanged and keeps its tests. Read the rule
  before generalising it — CR 303.4g is _"the Aura remains in its current zone,
  unless that zone is the stack. In that case, the Aura is put into its owner's
  graveyard instead of entering the battlefield. If the Aura is a token, it
  isn't created."_ It is **not** "illegal host → graveyard". The shipped
  no-legal-host path does move the Aura to its owner's graveyard
  (`state.ts:10449-10453`), and that is right only because every non-cast entry
  it serves today originates in the graveyard, so "remains in its current zone"
  and "owner's graveyard" name the same destination. An entry park reached from
  **exile** (blink) or from **token** creation needs the other two branches; do
  not carry the graveyard move forward as if it were the rule.
- **Every new choice `kind` owes the bot a `botActionRealisation` arm.** Owed-ness
  is reported for free by `computeExpectedInput`, but a `kind` the bot's
  exhaustive dispatch does not realise is a freeze, not a bad play (ADR 0047,
  #2283/#2284). This is a per-slice obligation, and it is why slices 2–4 each
  ship their kinds' bot arms rather than slice 1 stubbing all six.
- **Slice 1 wires no card.** It lands this ADR, the `StagedEntry` generalisation,
  the chokepoint verdict, D5's per-`origin` resume tail — **including the one
  live behaviour change in the slice**: moving the Aura host pick onto that tail,
  carrying its `gameOver` guard and shipping the same-mutation-completion test
  D5 names — and the CR 614.12b batch constraint, with the `asEnters` union
  declared and no `CardDefinition` populating it. The ten cards arrive in
  slices 2–4.
- **Client surface.** The staged permanent is in no zone, so the choice dialog
  must render it from `subjectCardId` — the pattern `choose-aura-host` already
  uses (`state.ts:2515`). No new projection field.

## References

- CR 614.1c, 614.12, 614.12a, 614.12b, 614.12c, 704.5f, 704.5m, 707.5, 707.6
- CR 117.3b, 303.4f, 303.4g, 608.2b (all printed from
  `data/cr/comprehensive-rules.txt`, ADR 0098)
- PRD #2043; slices #2466 (this), #2019, #2467, #2451; subsumed #1980
- ADR 0047 (Expected Input), ADR 0051 (land entry pay-choice — the stackless
  `PendingChoice` prototype), ADR 0078 §7 (deferred entry-counter events)
