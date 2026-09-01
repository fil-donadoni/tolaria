# One-shot layer-4 card-type SET as a first-class effect

**Status:** accepted

## Context

The "Enduring" cycle (DSK — Innocence, Curiosity, Tenacity, Courage, Vitality)
reads:

> When ~ dies, if it was a creature, return it to the battlefield under its
> owner's control. **It's an enchantment.** (It's not a creature.)

Issue #792 specified this as "return it to the battlefield **transformed**".
That is wrong: every card in the cycle is `layout: normal` on Scryfall — a
single-faced card with no back face. Nothing transforms (CR 712). The
mechanic is a **continuous type-changing effect** created by the resolution of
a triggered ability (CR 611.2, layer 4 / CR 613.1d).

#792 also listed "a once-per-turn guard on a TRIGGERED ability" as a missing
capability. It is not missing: `TriggeredAbility.maxTriggersPerTurn`
(`cards/types.ts`) has shipped, enforced by `triggerCapReached` /
`noteTriggerFired` in `gre/triggers.ts` against `CardInstanceState.
triggersThisTurn`, reset at the turn boundary (`gre/phases.ts`) and on
departure (CR 400.7). Nadu, Winged Wisdom already uses it.

The engine could express one-shot type **additions** (`animate` →
`animateAsCreature`, which only ever pushes types) and source-bound type
**removal** (`StaticTypeRemove`, a `staticEffects[]` entry applied and
un-applied by walking a live permanent's own definition — Reconfigure, Lion
Sash). It could not express a one-shot, source-independent type **set**: there
is no source to unapply, and Titania's Song carries the resulting divergence as
a documented gap.

## Decision

Add a `setCardType` Effect Op — an indefinite-or-timed layer-4 **set** of a
permanent's card types, created by a resolving spell or ability.

**It sets, it does not remove.** CR 205.1a: _"Some effects set an object's card
type. In most such cases, the new card type(s) replaces any existing card
types."_ A narrow `remove: ["Creature"]` would be right for Enduring Innocence
alone (printed `["Enchantment", "Creature"]`, so removal coincides with the
set) and wrong for a copy carrying extra types — the Gatherer ruling is
explicit: _"It won't have any card types other than enchantment."_ Encoding the
card's own printed type-line into the primitive also violates the
name-the-mechanic-not-the-card rule.

**Correlated subtypes go with the type.** CR 205.1a: _"If an object's card type
is removed, the subtypes correlated with that card type will remain if they are
also the subtypes of a card type the object currently has; otherwise, they are
also removed."_ Sheep and Glimmer are creature types only, so both leave —
again exactly what the ruling says, falling out of the CR with no card-specific
logic. This is part of the set's own semantics (both halves are layer 4, CR
613.1d), not a second chained Op.

Answering "is this subtype correlated to Creature" needs a classifier the
engine did not have. It **inverts**: the non-creature subtype sets are closed
and small and the CR enumerates them exhaustively — artifact (205.3g, 17),
enchantment (205.3h, 12), land (205.3i, 17), planeswalker (205.3j, 79), spell
(205.3k, 5), battle (205.3q, 1) — while creature types (205.3m, ~300) grow every
set. So the table lists the closed sets and **everything else is a creature
type**. That fallback fails OPEN: an unlisted future artifact type would be
wrongly stripped when Creature is removed. A catalogue-wide CI guard closes it
— for every subtype on any shipped card, its classification must agree with the
card types those cards actually print, so a new unlisted type fails CI the
moment a card carrying it ships.

**Provenance is per-`(source, type)`, not a snapshot.** The set writes entries
onto the existing `grantedTypes` / `suppressedTypes` arrays, each carrying an
optional `duration`, under a source id unique to that application. Expiry
removes only that effect's entries. The rejected alternative — one
`typeChange: { restoreTypes, restoreSubtypes, duration }` record mirroring
`temporarySubtypeChange` — is simpler to tick and revert, but restores a
**snapshot**: a static type-remove applied after the set gets clobbered on
expiry, resurrecting a type that should still be suppressed. The existing
arrays are keyed per-`(source, type)` for exactly this reason ("unapplying one
source only restores a type when no other source still suppresses it, and a
NON-printed type is never restored"), and a third type-mutation provenance is
what ADR 0082 exists to unwind.

**`resetBattlefieldTransientState` must clear one-shot entries.** Today's
`suppressedTypes` survives a zone change only because it is source-keyed and
`unapplySourceStaticEffects` reverses it when the source leaves — for
Reconfigure the source _is_ the permanent. A one-shot entry has no source, so
without an explicit clear a bounced-and-recast permanent returns permanently
non-creature: a CR 400.7 violation of the same class as issue #1746 (_"a bounced
Figure of Destiny comes back an 8/8 Kithkin Spirit Warrior Avatar"_), which is
why that function already reverts `revertAnimation` and `indefiniteSubtypeSet`.

"Under its owner's control" needs an owner selector `EffectPlayerRef` lacks, so
`{ ownerOf: EffectObjectSelector }` joins the shipped `{ controllerOf }`. The
clause is load-bearing: a stolen permanent dies to its **owner's** graveyard
(CR 404.1) while its leaves-the-battlefield trigger is controlled by its last
controller, and the default is the effect's controller (CR 110.2).

## Consequences

The effect is **materialized**, not recomputed — written onto the instance once,
like every other layer-4 effect in this engine (`type-add`, `type-remove`,
`subtype-set`), and unlike CR 613.1, which wants layer 4 evaluated at every
read in timestamp order. Making this one primitive recompute would add a third
model to the two ADR 0082 already has to reconcile. This is the same call
ADR 0084 recorded for Bestow: build in today's `layers.ts` and migrate wholesale
at ADR 0082 / PRD #2064 S4, because the CR-faithfulness at stake is the
mechanism, and the registry is about where the one authority lives.

`animate` is, in retrospect, `setCardType` + `setBasePT` with a creature-shaped
API (`savedPower` / `savedToughness` / `addedCreatureType`). It is left alone
here — folding it in would enlarge the blast radius across Xenic Poltergeist,
Thelonite Druid and the duration-tick path for no gain — and should collapse
into this Op at the ADR 0082 migration.

The Op's `duration` is deliberately present from the start even though the
Enduring cycle only needs the indefinite form; it is nearly free alongside the
per-entry revert the composition-safety argument already requires. Note the
resulting vocabulary asymmetry: `setSubtype` requires a duration and has no
indefinite form, `animate` accepts both, `setCardType` accepts both.

## Amendment: what actually shipped (#2361 / #2084)

The Op landed in #2361 (Oko, Thief of Crowns) ahead of the cycle it was
designed for, and diverged from the decision above on three points. Recorded
here rather than left to be rediscovered — the `mechanicsRegistry.ts` row is
the authority on the shipped shape; this section is why it differs.

- **The Op is `setCardTypes`, not `setCardType`,** and it has **no
  `duration`.** "Becomes an artifact creature until end of turn" is `animate`'s
  template and already carries a revert path; the indefinite form is the only
  one any shipped card needs. The predicted vocabulary asymmetry therefore came
  out the other way round: `setSubtype` accepts both, `setCardTypes` is
  indefinite-only.
- **Correlated-subtype removal is composed at the call site, not folded into
  the Op.** CR 205.1a's clause is still honoured in full — every "becomes a
  [subtype] [type]" line sets both halves — but through the paired
  `setSubtype`, whose non-land arm already replaces the subtype line wholesale,
  rather than one Op reaching into the other's storage. Enduring Innocence
  (#2084) is `setCardTypes ["Enchantment"]` followed by `setSubtype []`.
- **Consequently there is no subtype → card-type classifier and no catalogue
  guard for one.** The closed-set table this ADR proposed (artifact 205.3g,
  enchantment 205.3h, land 205.3i, planeswalker 205.3j, spell 205.3k, battle
  205.3q, everything else a creature type) was needed only to answer "is this
  subtype correlated to the type I am removing" _inside_ the Op. With the
  subtype line replaced explicitly by the author, nothing asks that question,
  so the fail-open fallback the guard existed to close never exists either. The
  table becomes worth building the day an Op has to _derive_ the surviving
  subtypes — most likely at the ADR 0082 / PRD #2064 layer-registry migration,
  where `animate` folds in too.

**`{ ownerOf: EffectObjectSelector }` was not needed and was not added.** The
premise — "the default is the effect's controller (CR 110.2)" — is true of
`EffectPlayerRef` generally but false at the one site the cycle uses:
`moveZone`'s graveyard → battlefield branch already defaults the new
controller to the source pile's owner (CR 400.7 / 108.3 — the card was put into
_its owner's_ graveyard), and an explicit `controller` is what _redirects_ it
under "**under your** control" (Reanimate). So "under its owner's control" is
spelled by **omitting** the field; naming `controller: "controller"` there is
the bug, since a leaves-the-battlefield trigger is controlled by the
permanent's _last controller_ (CR 603.6d) — precisely the player a stolen
Enduring Innocence must not go back to. `{ ref: "$x.owner" }` (#1106) remains
the way to name a bound object's owner where a genuine player ref is wanted.

**What #2084 did add** is unrelated to layer 4 and small: `PermanentFilter.
powerAtMost` (the upper-bound twin of `powerAtLeast`, same fail-closed
treatment of an absent power), and three passthroughs on `enteredTrigger` —
the entering permanent's effective P/T into the filter subject (CR 613.4,
mirroring `diedTrigger`, which has carried its own death-event P/T since it
shipped), plus `oncePerEventBatch` (CR 603.3b) and `maxTriggersPerTurn`
(CR 603.2), both long-shipped `TriggeredAbility` fields the factory simply did
not forward.

## Amendment 2: entering AS the new type (#2993)

The composition recorded above — `moveZone`, then `setCardTypes`, then
`setSubtype` — is the right shape for a type set applied to a permanent already
on the battlefield (Oko's `+1`). It is the wrong shape for the Enduring cycle's
own sentence, and shipped a bug: the type line landed **after**
`emitPermanentEntered`, so the `PERMANENT_ENTERED` event announced
`types: ["Enchantment", "Creature"]` with a `power`, and every "whenever a
creature enters" watcher fired off a permanent that is not a creature (CR
603.6a). Enduring Innocence's own sibling drew a card off it.

Reordering the Ops was never available: a graveyard → battlefield entry funnels
through `resetBattlefieldTransientState`, whose `revertTypeLine` reverts the
whole layer-4 provenance, so a line set BEFORE the move is wiped by the entry.
That is exactly why the shipped order was move-then-set. The type has to be
applied **as** the permanent enters — after the entry-side reset, before the
ETB notification.

**The Op grows a field; it does not grow a second Op.** `moveZone` takes
`entersAs: { types, subtypes }`, valid only with `to: "battlefield"` on the
`target` shape. That keeps the whole Oracle sentence in one Op, matching how it
reads, and leaves `setCardTypes` as the after-the-fact form it was designed to
be.

**Both halves are required, which is where this amendment revisits Amendment 1.**
That amendment recorded that CR 205.1a's correlated-subtype clause is composed
at the call site rather than folded into the Op, so no subtype → card-type
classifier was needed. `entersAs` cannot compose at the call site — both halves
must be in place at the same instant — so it carries both. What it does **not**
do is derive the second from the first: the author still states the surviving
subtype line explicitly, so the closed-set classifier this ADR originally
proposed is still not built and still fails open if it ever is. An OPTIONAL
`subtypes` would have been the fail-open shape (a permanent that is no longer a
creature keeping Sheep and Glimmer), so the validator rejects it.

**The mechanism is an entry stamp, mirroring the transform seam.**
`CardInstanceState.entersAsTypeLine` is written by
`SpellContext.returnToBattlefield`'s new `opts.entersAs` while the card sits in
the graveyard/exile, and consumed by `applyEntryTypeLine` inside
`stageReanimatedOnBattlefield`. This is deliberately the same "mutate the object
between the departure and the entry" seam `stampBackFaceForEntry` uses for
"exile it, then return it transformed" (#2380) — a second entry-mutation model
is what this project already has too many of. A stamp rather than a threaded
call argument because the funnel can PARK the card across a real save point (CR
614.12a as-enters choices, ADR 0100) and re-enter it on a later mutation, so the
line has to ride the instance; it is therefore persisted, not transient.

**It leaves no storage of its own behind.** The stamp writes through
`applyCardTypeSet` / `applyIndefiniteSubtypeSet` — the extracted card-level
bodies of the two SpellContext primitives — so the records are the ones
`revertTypeLine` already reverts, and CR 400.7 needs no knowledge of the entry
path. A permanent returned as an enchantment and later destroyed still sits in
the graveyard as the Enchantment Creature — Sheep Glimmer card it prints.

**Known boundary.** The CR 614 entry-REPLACEMENT check
(`enterBattlefieldDestinationFor` — Containment Priest) runs earlier in the same
function and still reads the printed type line. No shipped card pair reaches it;
drafted in
`docs/findings/2993-entry-type-line-is-invisible-to-the-cr-614-check.md` and a
line on the ADR 0082 / PRD #2064 migration, where "the characteristics an object
would have as it enters" gets one authority.
