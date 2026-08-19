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

The census is not an enumeration of card effects — it is the set of code paths
that put a `CardInstanceState` onto the battlefield. There are **four**: three
that pass through the CR 614 replacement chokepoint, and one that does not.

| #   | Site                                                                                                                                                                                                                                                                                                      | Covers                                                                                                                                                                                                                                                                                                                                                              | Chokepoint | Stack item                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- |
| A   | `finalizeSpellResolution` — `gre/state.ts:5634`, writes `zone` at `:5737`                                                                                                                                                                                                                                 | a permanent spell resolving off the stack                                                                                                                                                                                                                                                                                                                           | yes        | **yes**                               |
| B   | `stageReanimatedOnBattlefield` — `gre/state.ts:10068` (+ `finishReanimatedEntry` `:10191`)                                                                                                                                                                                                                | every non-cast entry: `moveZone` → battlefield (`:12055`, `:12070`), blink / return from exile (`:12231`), reanimated Aura + host bundle (`:8798`, `:8827`), the batch path `putReanimatedSetOnBattlefield` (`:10272`, #1094), and a land put onto the battlefield **by an effect** (`playLand.ts:562-567`, whose deferred entry `finalizeLandEntry` later commits) | yes        | no                                    |
| C   | `createTokenPermanents` — `gre/state.ts:18138`, writes `zone` at `:18461` (+ `SpellContext.createTokenCopyOf` `:14771`, which calls it with `copyOf` so the copy is stamped on BEFORE the chokepoint, CR 707.5 — issue #2558)                                                                             | token creation and token copies                                                                                                                                                                                                                                                                                                                                     | yes        | no                                    |
| D   | the **play-land family** — `applyPlayLand` (`gre/playLand.ts:117`), `applyPlayLandFromExile` (`:193`, `:194`), `applyPlayLandFromGraveyard` (`:238`), `applyPlayLandFromLibraryTop` (`:291`), `finalizeLandEntry`'s play branch (`:553`), every one of them settling through `settleEnteredLand` (`:369`) | a land **played** (CR 305) from hand, exile, graveyard or library top                                                                                                                                                                                                                                                                                               | **no**     | no — CR 305.1 requires an empty stack |

**Why rows A–C are closed, rather than merely long.** The CR 614
enters-the-battlefield **replacement** chokepoint, `enterBattlefieldDestinationFor`
(`gre/replacements.ts:794`), has exactly three callers: `state.ts:5930`,
`:10519`, `:18335` — one per row A/B/C. A spell/effect/token entry path that did
not pass through it would already be a live bug today (Containment Priest, #1148,
would miss it), so those three rows are guarded by an invariant the suite already
exercises rather than by this document's diligence.

**Row D is outside that chokepoint, and outside that invariant.** A played land
reaches the battlefield through the generic `moveCard` primitive (or
`moveCardAcrossPlayers`, `playLand.ts:130-152`, for a cross-player exile grant)
and then `settleEnteredLand`; **no play-land entry site calls
`enterBattlefieldDestinationFor`** — the name does not occur in `playLand.ts` at
all. Nor do `playLand.ts:383` / `:417` say otherwise: `:383` is about
`resetBattlefieldTransientState` and reads "the play-a-land entry is the one that
didn't" funnel through `stageReanimatedOnBattlefield`, and `:417` distinguishes
`finalizeLandEntry`'s **effect**-entry branch (which does go through row B) from
its play branch (which does not). The three-caller invariant therefore cannot
vouch for row D, and neither can the Containment Priest suite: that replacement
keys on nontoken **creatures**, so a played land skipping the chokepoint is
unobservable today. This is a standing gap, not a live bug — and it is exactly
what #1980 costs (D6).

Two sites are **deliberate carve-outs**, outside the chokepoint by design:

- `convex/manual.ts:1119` writes `zone: "battlefield"` on a
  `ManualCardInstance` in the paper-mode verb engine. Different state type, no
  rules engine behind it, out of scope here.
- `convex/gre/scenarioBuilder.ts:403` (and the land filler at `:414`/`:415`)
  pushes instances **straight onto `player.battlefield`**. Its local
  `makeInstance` does set `zone` from its parameter (`:173`) — what puts it
  outside the census is that it performs no **entry**: no
  `enterBattlefieldDestinationFor` call, no entry settlement, no event. Its own
  comment at `:238` calls it "a raw
  `battlefield.push` that emits nothing", because a seeded board must not fire
  every ETB trigger in the catalogue. **Consequence for slices 2–4: a preset
  debug scenario can never be the proof that the chokepoint works.** A seeded
  Clone or Primal Clay lands on the battlefield without passing
  `enterBattlefieldDestinationFor`, so it will show **no** as-enters prompt and
  will carry whatever body the spec gave it. That is the carve-out behaving as
  designed, not a bug in the slice; the scenario's job is to set up a
  _reanimation/blink/token_ that then re-enters through row B or C. The proof
  the chokepoint fires stays a vitest test through the real entry path.

Two further `battlefield.push(` sites are **not entries at all**, and are
excluded on the rules rather than on scope — sweeping `battlefield.push(` across
`convex/` accounts for every hit, so the census is closed by construction and not
by inspection:

- `phaseInBundle` (`gre/state.ts:8805`, push at `:8812`) — CR 702.26d: "The
  phasing event doesn't actually cause a permanent to change zones … Zone-change
  triggers don't trigger when a permanent phases in or out." A permanent phasing
  in does not enter the battlefield, so it owes no as-enters choice.
- the two control-change pushes (`gre/state.ts:7665`, `:7739`) — the object never
  leaves the battlefield; only its controller changes, so there is no entry to
  replace. (Contrast CR 110.2a, where an effect **putting** an object onto the
  battlefield does set an entry-time controller — that path is census row B.)

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
    /** Which census row is resuming it — selects WHICH entry tail to run. */
    origin: "spell" | "effect" | "token";
    /** The stack item whose resolution parked this entry, if there was one.
     *  This — not `origin` — is what D5's resume branches on: still on the
     *  stack ⇒ resume it; absent or already popped ⇒ finish here. */
    parkedStackItemId?: string;
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
        { kind: "aura-host" },              // CR 303.4f, absorbed by D2
        { kind: "pay", cost },              // shock lands / #1980, was ADR 0051
        { kind: "anchor", options },        // CR 614.12c, declared inert
    ]
}
```

Every answer is a write to a typed field that already exists — `chosenModeId`,
`chosenName`, `chosenSubtypes`, the `body` quadruple (`power`, `toughness`,
`subtypes`, `staticAbilities`), the attach in `finalizeAuraHost`, or
`becomeCopyOf`. The applier is **exhaustive over the union** (`assertNever`), so
a `kind` cannot be added without a writer — the same compile-time forcing
`brain.ts:1081` already applies to choice kinds on the bot side.

Three kinds are there because D2 and D6 put them there, not because a slice
wires a card to them:

- **`aura-host`** — D2 folds `stagedAuraEntries` into `stagedEntries`, so the
  CR 303.4f host pick stops being a parallel mechanism and becomes a kind.
- **`pay`** — the `entersTappedUnlessPay` choice ADR 0051 shipped, which D6
  scopes in with #1980; it is the same CR 614.12 family and must not owe its
  answer through a second park.
- **`anchor`** — CR 614.12c: _"Some replacement effects cause a permanent to
  enter the battlefield with its controller's choice of one of two abilities,
  each marked with an anchor word … The abilities preceded by anchor words are
  each linked to the ability that causes a player to choose between them."_ No
  shipped card uses anchor words. The kind and its registry row ship anyway, so
  the mechanic is whole with no card exposing it
  (`.claude/rules/gre-development.md` — a mechanic is implemented whole).

This is **not** an Effect Script and no `EffectOp` is added. A CR 614.1c
replacement is a declaration, not an effect that resolves — the same reason
`entersWith.counters` is data today (`cards/mechanicsRegistry.ts:2126`: "no
Effect Script involved"). The interpreter also has no coherent `$self` here:
the card is in no zone. `/new-op`'s seven registration sites are therefore not
walked by this work.

Nameless Race (`drk/black.ts:399`) is not a special case under this shape: it is
`payLife` with a board-derived cap, feeding `body`. Two kinds composing beats
one more bespoke kind.

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
ability resolves. The as-enters finalize reproduces the **generic tail** instead
(`gre/pendingChoiceSubmit.ts:1103-1119`) — shift the queue, and when both `owed`
and `state.pendingChoices` are empty run the tail's completion branch — **but the
tail's two branches are not interchangeable, and the predicate that picks between
them is `StagedEntry.parkedStackItemId` still being on the stack**:

- **A live parking stack item** (`state.stack.some(s => s.id === parkedStackItemId)`)
  takes the `resolveTopOfStack(state)` branch (`:1106-1107`). Resolution is
  peek-and-pop — the pop happens only after the resolution finishes — so the item
  that parked the entry is still there and the suspended resolution really does
  resume, in the same mutation, with priority restored only once it completes.
- **No live parking stack item** must **not** call `resolveTopOfStack`: there is
  nothing left to resume, so the finalize itself runs the remainder of the entry
  tail and takes the tail's **else** branch (`:1110-1115`) — priority back to the
  active player, `passCount = 0`, `drainAutoPasses`. Calling `resolveTopOfStack`
  here is wrong twice over: on an otherwise-empty stack it throws `Stack is empty`
  (`state.ts:4766`, reached unguarded through `resolveTopOfStack` at `:4441-4447`)
  and the player can never answer their own choice — a hard freeze; on a non-empty
  stack it resolves the **next**, unrelated item in the same mutation with no
  priority round, precisely the CR 117.3b violation this decision sets out to
  avoid, and it fails silently.

**The census row is the illustration, not the rule.** How each row lands under
that predicate _today_:

| Origin     | Live parking item today | Branch | Why                                                                                                                                                                                                      |
| ---------- | ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — spell  | **no**                  | else   | `resolveTopOfStackInner` already popped the item (`state.ts:4894`, `:5248`) before `finalizeSpellResolution` ran — a hard freeze on a **cast** Clone or Primal Clay, the primary case #2043 exists for   |
| B — effect | yes                     | resume | `enqueueAuraHostChoice` (`state.ts:10354`) has one caller, `putReanimatedSetOnBattlefield` (`:10314`), whose only callers are `SpellContext` methods (`:11991`, `:12035`) — every park is mid-resolution |
| C — token  | yes                     | resume | token-creation Ops likewise run inside a resolution                                                                                                                                                      |

Routing on `origin` would therefore be correct today and **fail open tomorrow**.
The moment D6's own #1980 promise is kept and the census row D play-land sites are
routed onto the chokepoint, `origin: "effect"` acquires an off-stack member: CR
305.1 — _"A player who has priority may play a land card from their hand during a
main phase of their turn **when the stack is empty**"_ — so every such park would
take the `resolveTopOfStack` branch onto an empty stack and throw. That is round
2's freeze relocated from row A into a row-B subpopulation. Branching on the
parking stack item makes a stackless park take the else branch **by construction**
rather than by census bookkeeping; `origin` stays, but only to select which entry
tail the finalize runs.

The predicate cannot be read off the choice record either, which is why D2 carries
`parkedStackItemId` on the staged entry: an as-enters park enqueues with
`stackItemId: ""` (as `enqueueAuraHostChoice` and `enqueueLandEntryChoice`,
`playLand.ts:494`, already do), so the `PendingChoice` says only that the park was
stackless, never which resolution — if any — is waiting on it.

That `stackItemId: ""` is also why the as-enters finalize must **reproduce** the
tail rather than fall into it: a stackless choice never reaches `:1103-1119`,
because the generic path throws `Stack item not found` at `:1019-1020` first
(`state.stack.find(s => s.id === "")` is undefined on any real stack). The
as-enters finalize is therefore a **fifth early-return finalize** beside the four
shipped ones (`:975` draw-look-keep, `:979` legend-keep, `:992` choose-aura-host,
`:1004` discard-hand), and it carries a copy of the tail's completion logic.
"Takes the generic tail" throughout this decision means "reproduces those lines",
never "reaches them".

Because D2 folds the Aura host pick into the shared finalize, it acquires this
behaviour rather than keeping its own: it is row B and its park always has a live
parking stack item, so it moves from "set priority and wait for a round-trip"
(`finalizeAuraHost`, `state.ts:10457-10462`) onto the `resolveTopOfStack` branch.
That is a **live behaviour change to a shipped path, and slice 1 owns it** — with
two obligations attached, each with a named guarding test, because a guard shipped
without one is invisible when it rots:

1. **The `gameOver` guard must survive the move.** `finalizeAuraHost` resumes
   only `if ((state.pendingChoices?.length ?? 0) === 0 && !state.gameOver)`
   (`state.ts:10460`); the generic tail has no `state.gameOver` check. Without
   it, an attach that kills a player through `checkStateBasedActions` would go on
   to resolve the next stack item in a finished game. The shared finalize carries
   the check, and the test that says so: _park an entry whose attach kills a
   player through `checkStateBasedActions`, put a second item on the stack behind
   it, answer the choice, and assert the game is over and that second item has
   NOT resolved._ Proof-of-failure: drop the `!state.gameOver` clause from the
   shared finalize and watch the second item resolve.
2. **It needs its own guarding test**, named here because nothing else
   distinguishes the new tail from the old shape: _park a non-cast Aura entry on
   the host pick, answer it, and assert the suspended resolution COMPLETES in the
   same mutation_ — the stack item is gone and priority is the active player's,
   with no intervening priority window. Its proof-of-failure is the old shape:
   restore the "set `priorityPlayerId` and return" behaviour and watch it go red.

**What replays.** Resume is a **re-entry, not a continuation** — and the Op that
parked the entry is the one that re-runs. This turns on the RESOLUTION SHAPE, an
axis orthogonal to the origin rows above: origin says which entry tail the
finalize runs, shape says what re-entering the resolution costs. There are
**three** shapes, and the first version of this decision priced only two of them
(corrected by issue #2570):

| Shape                        | Checkpoint                                                                                                                                 | On re-entry                                                                                                                                     | Suspends on an Entry Park? |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| stepped `resolveSteps`       | `top.resolutionStep = i` committed **before** step `i` runs (deliberate — a `requestChoice` inside the step must key under the right step) | `start = i`, so step `i` replays from its beginning and every earlier step is skipped                                                           | **yes**                    |
| Effect Script `effects[]`    | the interpreter's `resume` position (`gre/effects/interpreter.ts`, `runOpList`)                                                            | every Op whose pre-order position is `< resume` is skipped — an irreversible side effect never replays — but the Op **at** `resume` re-executes | **yes**                    |
| plain imperative `resolve()` | **none**                                                                                                                                   | the closure restarts **from its first statement** — but it has already RETURNED, so there is nothing left to resume                             | **no** (#2570)             |

Row three is the one D5 originally missed, and missing it is not a gap in the
table but a live bug: the suspension predicate treated a completed body exactly
like a checkpointed one, so a plain `resolve()` that parked an entry re-ran in
full and re-committed every side effect it had already made (measured: life
20 → 21 → 22, a second permanent staged and parked, and so on). The fix is
site-local and fails closed — `resolutionSuspendedOnChoice(state, shape)` takes
the shape as a **required argument** at all seventeen call sites, and only the
`"completed"` ones exempt a stackless Entry Park. Everything else still suspends
there: a stack-coupled `requestChoice` the body raised, any other kind, and the
park itself at every `"checkpointed"` site. The exemption is keyed on
`asEntersCardId`, the same explicit discriminator `finalizeAsEnters` routes on,
never on `kind` — every as-enters prompt deliberately reuses an existing
`PendingChoiceKind` shape, so a `kind ===` test would swallow the wrong choices.
Popping the item is what makes a completed body land in the no-live-parking-item
branch above; it is row A's mechanism, reached by a different route.

`getResolveFn` (`cards/effectRegistry.ts`) hides all three shapes behind one
returned closure — `def.resolve` and the `def.effect` shorthand are imperative,
`def.effects` is a compiled script, and the functions are indistinguishable — so
the spell site discriminates on the DEFINITION via `spellBodyShape`, which lives
in that same file precisely so the two cannot drift.

Replay-idempotence remains a per-row obligation for the two checkpointed shapes,
not a free property:

| Row        | Replays on resume?     | Why                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — spell  | **no**                 | `resolveTopOfStackInner` pops the item (`state.ts:4894`, and `:5248` on the non-stepped path) **before** calling `finalizeSpellResolution`. There is no stack item left to resume, so the as-enters finalize must itself run the remainder of the entry tail and the resolution is over. |
| B — effect | yes, harmlessly        | the re-run finds the card no longer in its source zone, so the Op's selector cannot be satisfied and it is skipped individually (CR 608.2b, `interpreter.ts:4802-4803`). This — not the mechanism — is why the Aura path survives its replay today.                                      |
| C — token  | yes, **destructively** | the `createToken` executor (`interpreter.ts:3898`) and its copy sibling `createTokenCopy` (`:4016`) each need a done-marker, or a bare re-run creates a **second** token. Both carry one as of #2558.                                                                                    |

Row C is load-bearing work for slice 4, not a detail: the token-entry Op must
guard its commit under its own checkpointed position via
`recallChoice`/`noteChoice` — the idempotent-commit idiom `castDuringResolution`
(`interpreter.ts:2080-2082`) and `coinFlipSync` already use — or the slice
duplicates the token. No test written for the _choice_ would catch it.

The marker must be **per token, not per Op**, because `createToken` resolves
`count` once and creates the whole batch in a single
`ctx.createToken(token, controllerId, count)` call (`interpreter.ts:3987`) —
`createTokenCopy` has its own `count`, spent in a LOOP of single-token
`ctx.createTokenCopyOf` calls (`:4132`), which runs to completion before
`runOpList` observes the rise in the parked count, so the same
"write the marker for the whole batch, after the loop" shape holds for it
(#2558). A plain done-marker written at the Op's checkpoint
short-circuits the **entire** Op on re-entry, so whatever part of a `count: N`
batch the park left unfinished is never created at all: the Op under-delivers by
an amount that depends on where the park landed, up to the whole batch. The
mirror of the duplicate bug, equally silent. Either record which tokens of the
batch were already created, or write
the marker for the whole batch at creation-and-staging time, before the first
park. The guarding test is therefore "park a token entry with `count: N`, answer
every owed choice, assert exactly N tokens" — run for `N = 1` **and** `N > 1`,
since the two values fail in opposite directions.

Those two Op-level markers stay: they guard the Effect Script shape, which still
suspends and still re-executes the Op at its resume position. The CARD-level
twin does not — `Sin, Spira's Punishment` carried a hand-written
run-to-completion marker in its plain `resolve()` body for exactly the replay
#2570 removed, and it was deleted with the general fix rather than left standing
as a second, silent authority on the same question (`cards/sets/fin/multicolor.ts`).

The rejected alternative is exempting as-enters choices from
`resolutionSuspendedOnChoice` (`gre/state.ts`) the way `land-entry-tapped`
is, which would sidestep replay entirely. It is wrong here: that exemption is
safe only because the land has **already entered** and nothing observes the
tapped bit, whereas an as-enters park holds the permanent off every zone — the
rest of the resolution would run without it, and D2 already rejects the
provisional-entry shape that would make it safe.

**#2570's carve-out is not that rejection reversed**, and the shape table above
is why. What is rejected is a BLANKET exemption — one that applies wherever the
predicate is consulted. The clause it turns on is "the rest of the resolution
would run without" the permanent, and that clause is a statement about
checkpointed shapes: a stepped body has a step left, a script has Ops below its
resume position, and both would run them against a permanent that is in no zone.
A plain `resolve()` closure has no rest — it returned before the predicate was
consulted, and re-entering it re-runs work that is already done rather than
work that is still owed. So the carve-out is granted per SHAPE, at the sites
where that argument does not apply, and denied everywhere else. The
`"checkpointed"` sites keep the original behaviour verbatim.

What the plain shape still shares with the rejected version is that the
statements a body writes AFTER its entry primitive run while the permanent is
parked — CR 614.12a's "before the permanent enters" holds for the entry itself
but not for a closure's trailing lines, which no engine seam can suspend
mid-function. That is a separate defect of the shape (it exists identically
whether or not the body replays) and is out of #2570's scope; the DSL-first
default is the answer, since an Effect Script CAN suspend between Ops.

### D6 — Scope

| Question                       | Answer               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token copies (CR 707.6)        | **in**               | Census row C is already a chokepoint caller, so covering them costs nothing and excluding them would cost a deliberate branch. CR 614.12's own worked example is a **token copy of Voice of All** — the exact card #2019 is about.                                                                                                                                                                                                                |
| #1980 (land played from exile) | **in, and not free** | Same CR 614.12 family (pay 2 life as it enters), but it is census row **D**, outside the chokepoint: `applyPlayLandFromExile` (`playLand.ts:169-213`) moves the card with `moveCard`/`moveCardAcrossPlayers` and settles through `settleEnteredLand`, never reaching `enterBattlefieldDestinationFor`, and carries no `entersTappedUnlessPay` branch at all — the gap is marked in-tree at `playLand.ts:533` (`tracked-by: #1980`). Priced below. |
| CR 614.12b (simultaneous)      | **in**               | Against this ADR's own initial recommendation, by maintainer decision. Shipped as an **engine capability with no card exercising it** (`.claude/rules/gre-development.md` — intermediate slices are capabilities, not partial mechanics).                                                                                                                                                                                                         |

**What #1980 costs.** Two pieces of real work, neither of them bookkeeping.
(1) **Route the row-D entry sites onto the chokepoint** — `applyPlayLand`
(`playLand.ts:117`), `applyPlayLandFromExile` (`:193`/`:194`),
`applyPlayLandFromGraveyard` (`:238`), `applyPlayLandFromLibraryTop` (`:291`) and
`finalizeLandEntry`'s play branch (`:553`) — so a played land is subject to the
CR 614 replacement pass at all. That closes the census under one invariant instead
of three-plus-an-exception, and it is what makes Containment Priest-shaped
replacements observable on played permanents. (2) **Reconcile with ADR 0051's
pre-move park.** The shipped `entersTappedUnlessPay` choice is enqueued
_before_ the zone move (`playLand.ts:102` from hand, `:276` from library top,
via `enqueueLandEntryChoice` `:483-506`) and leaves the land **in its source
zone** for the choice window, with `finalizeLandEntry` sourcing from hand or
library-top by position. That is the opposite shape from D2's staged entry, which
holds the permanent off **every** zone; the two parks must be unified, or #1980's
land owes its choice through one mechanism while the shock land owes it through
another. The exile and graveyard origins have no such branch today at all, which
is the bug #1980 names. Scoped in on that understanding — the slice that lands it
closes #1980, and it is the slice that also brings row D under the chokepoint.

CR 614.12b — _"that player may not make choices for those effects that would
cause the combined costs of those effects to not be payable"_ — binds only the
batch path `putReanimatedSetOnBattlefield` (#1094), the one site that stages
several entries at once. Concretely: when two staged entries owe cost-bearing
choices (today only `payLife`, tomorrow the #1980 pay-2-life) to the same
player, the candidate set offered for the second is constrained by what the
first committed. None of #2043's ten cards reaches this — no shipped card pairs
a cost-bearing as-enters choice with a simultaneous entry — so it ships with
engine tests only and no card wired to it.

## Considered Options

- **A new unified `enterBattlefield(state, card, controllerId, { origin,
wasCast })` that all four census rows are refactored onto**, owning the whole
  entry contract (redirect check → as-enters choices → `entersWith` counters →
  `shouldEnterTapped` → push + CR 611.2 grants → `emitPermanentEntered`).
  Rejected for this slice by D1: rows A–C already share a chokepoint with a
  three-caller invariant the suite exercises, so the refactor rewrites two hot
  paths (spell resolution, token creation) for a guarantee that is already
  there. What it would genuinely add — row D — is bought directly by D6's #1980
  work, without touching A or C. Revisit only if row D proves it cannot be
  routed onto `enterBattlefieldDestinationFor`.
- **A shared `raiseAsEntersChoices()` helper called from each entry site**, no
  chokepoint. Rejected in D1: it is the `applyEntersWithCounters` shape (four
  independent call sites), and the fifth entry path is born incomplete with no
  guard seeing it.
- **Provisional entry plus a global SBA gate on `pendingChoices`.** Tempting,
  and CR 704.3 does check state-based actions when a player _would receive
  priority_, which a mid-resolution suspension is not — making today's sweep a
  divergence in its own right. Rejected as the **mechanism**: it closes one of
  the windows through which a half-entered permanent is visible and leaves the
  others (layers, target legality, the trigger scan, the wire projection) open,
  where D2's off-every-zone park closes all of them by construction. It also
  changes `legend-keep`, which depends on the post-submit re-sweep (CR 704.5j).
  Recorded as a finding below, not adopted here.
- **Raising the choice before the object leaves its origin zone** — the
  `applyPlayLand` / ADR 0051 shape, which enqueues before `moveCard`. Rejected
  as the general mechanism: a token has no origin zone, and the CR 400.7 batch
  has already spliced its cards out of the graveyard to keep the move atomic.
  That is two mechanisms where the park is one, and D6 makes reconciling the
  shipped instance part of #1980's price.
- **An as-enters Effect Script (`asEnters: EffectOp[]`).** The DSL-first default
  (ADR 0045) points here, but D3 rejects it: the writers are typed field writes,
  not effect vocabulary; `becomeCopyOf` is deliberately absent from the Mechanics
  Registry (`m12/blue.ts:28`), so this is the new-Op tax several times over; and
  the interpreter checkpoints on `StackItem.resolutionStep`, while two of the
  four rows have no stack item at all — which is the reason the park exists.
  `entersWith.counters` is the governing precedent: a CR 614.1c replacement is
  declared as data.

## Consequences

- **One place to forget — for three of the four rows.** A new spell/effect/token
  entry path cannot skip the as-enters choice without also skipping the CR 614
  replacement check, which the Containment Priest suite already fails on. Census
  row D (played lands) is the standing exception until #1980 routes it in: it
  reaches the battlefield without touching the chokepoint, and no shipped
  replacement can currently observe that it does.
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
  the chokepoint verdict, D5's parking-stack-item resume tail — **including the one
  live behaviour change in the slice**: moving the Aura host pick onto that tail,
  carrying its `gameOver` guard and shipping the same-mutation-completion test
  D5 names — and the CR 614.12b batch constraint, with the `asEnters` union
  declared and no `CardDefinition` populating it. The ten cards arrive in
  slices 2–4.
- **Client surface.** The staged permanent is in no zone, so the choice dialog
  must render it from `subjectCardId` — the pattern `choose-aura-host` already
  uses (`state.ts:2515`). No new projection field.

## Findings surfaced

1. **#2478 — not fixed here.** `checkStateBasedActions` (`gre/sba.ts`) has no
   gate on `pendingChoices` and runs right after `resolveTopOfStack` in
   `convex/game.ts` **including when the resolution suspended on a choice**,
   against CR 704.3. Latent today only because no half-entered permanent has
   ever been illegal — and it stays latent under this ADR precisely because D2
   parks the entry off every zone rather than provisionally on the battlefield.
   It is the reason the provisional-entry option above cannot be the mechanism.
2. **#2479 — the Aura leg is fixed here, by D5.** None of the shipped stackless
   finalizers reaches the resume block `gre/pendingChoiceSubmit.ts` runs for a
   stack-coupled choice; each returns early and hands priority to the active
   player instead. For two of them that is harmless — `legend-keep` is raised
   from the SBA sweep, never mid-resolution, and `land-entry-tapped` is the one
   kind exempted from `resolutionSuspendedOnChoice`, so neither ever suspends a
   resolution. `choose-aura-host` is neither, and it strands its stack item: an
   Aura with two or more legal hosts inside a CR 400.7 batch
   (`putReanimatedSetOnBattlefield`) opens a priority window in the middle of a
   resolution, which CR 608.2 gives to nobody. D2 folds that finalize into the
   shared one and D5 puts it on the parking-stack-item resume tail, with the
   two named guarding tests — so slice 1 closes this leg. The other two
   finalizers keep their early return.

## Slicing

This ADR re-slices PRD #2043. Every intermediate state is an engine capability
with no card exposing it, per `.claude/rules/gre-development.md`.

| Slice | Issue        | Content                                                                                                                                                                           |
| ----- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #2466 (this) | `StagedEntry` generalisation, chokepoint verdict (D1), D5's resume tail incl. moving the Aura host pick onto it, CR 614.12b batch constraint, `asEnters` declared — no card wired |
| 2     | #2019        | `mode` leg: cast path moves to entry-time, the `modes` / `chosenModeId` piggyback retired (Voice of All, Prismatic Ward, Quirion Elves, Jihad)                                    |
| 3     | #2467        | `name`, `subtypes`, `body`, `payLife` legs — Meddling Mage, Illusionary Terrain, Primal Clay, Shapeshifter, Nameless Race                                                         |
| 4     | #2451        | `copy` leg — Clone, Copy Artifact, Vesuvan Doppelganger, Phyrexian Metamorph, Phantasmal Image; carries D5's per-token replay marker for row C                                    |
| —     | #1980        | Census row D onto the chokepoint + the ADR 0051 pre-move park reconciled into `stagedEntries` (D6); orderable against slices 2–4, but it owns the `pay` kind                      |

## References

- CR 614.1c, 614.12, 614.12a, 614.12b, 614.12c, 704.3, 704.5f, 704.5j, 704.5m,
  707.5, 707.6
- CR 110.2a, 117.3b, 303.4f, 303.4g, 305.1, 400.7, 608.2, 608.2b, 702.26d (all
  printed from `data/cr/comprehensive-rules.txt`, ADR 0098)
- PRD #2043; slices #2466 (this), #2019, #2467, #2451; scoped-in #1980
- Findings #2478 (SBA sweep with a Pending Choice outstanding), #2479
  (`choose-aura-host` strands its suspended stack item — Aura leg closed by D5)
- ADR 0047 (Expected Input), ADR 0051 (land entry pay-choice — the stackless
  `PendingChoice` prototype), ADR 0078 §7 (deferred entry-counter events)
