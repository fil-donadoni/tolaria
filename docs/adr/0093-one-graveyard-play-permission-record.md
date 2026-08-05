# One graveyard play permission record, sources differ only by duration

**Status:** accepted

## Context

"You may play lands and cast spells from your graveyard" is one rules concept
(CR 305.1-analog / 601 — a permission to take a normal action with a card that
is in the graveyard rather than the hand). The engine has grown **three
independent declarations** of it, each cut to the exact shape of the card that
needed it, plus **three readers that do not share a resolver**:

| declaration                                           | shape                                | semantics                                    | reader                                                            |
| ----------------------------------------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| `CardDefinition.playsLandsFromGraveyard` (#1190)      | `boolean`                            | lands, unlimited, indefinite                 | `canPlayLandsFromGraveyard`                                       |
| `CardDefinition.castsPermanentsFromGraveyard` (#1392) | `{ maxManaValue }`                   | permanent types, MV cap, once/turn, own turn | `canCastPermanentFromGraveyardByPermission`                       |
| `state.graveyardPlayPermissionThisTurn` (#1149)       | `{ playerId, zones, maxManaValue? }` | land + spell, unlimited, this turn           | `getGraveyardPlayPermission` / `canCastFromGraveyardByPermission` |

The three are samples of ONE space along four axes — which action is licensed,
which card types, a mana-value ceiling, and how often it may be used — but no
axis is shared between them, and the two battlefield-derived ones are booleans
in disguise: adding an axis to a card means adding a field.

Yawgmoth's Agenda (INV, #1238) is the fourth sample: land **and** spell,
uncapped, unlimited, indefinite, battlefield-derived. Under the existing shape
it is a fourth field with a fourth reader, and the drift stops being arguable.

Two properties of the current split are actively dangerous rather than merely
untidy:

1. **Restrictions live inside a reader, not in the data.** Lurrus's
   "once during each of YOUR turns" is enforced by
   `canCastPermanentFromGraveyardByPermission` checking `state.activePlayerId`
   and `state.graveyardPermanentCastUsedThisTurn` itself. Its own docstring
   records why: an earlier version omitted the own-turn gate, and a FLASH
   permanent in the graveyard was castable on the opponent's turn. Any new call
   site that reaches for the wrong one of the three readers inherits none of
   those gates and **fails open** — the permissive direction, which is a rules
   break rather than a missing feature.
2. **The use counter is keyed by player.** `graveyardPermanentCastUsedThisTurn`
   is a list of player ids, so one use per player per turn regardless of how
   many permissions granted it. That is indistinguishable from correct while
   Lurrus (Legendary) is the only holder, and silently wrong the moment a
   second, non-legendary once-per-turn source ships — every test still passes.

## Decision

**One record describes every graveyard play permission; sources differ only in
duration.**

```ts
interface GraveyardPlayPermission {
    actions: ("play-land" | "cast")[];
    cardTypes?: CardType[]; // absent = any castable type
    maxManaValue?: number; // absent = uncapped
    oncePerTurn?: boolean;
    yourTurnOnly?: boolean; // CR 702.139a "during each of your turns"
}
```

`CardDefinition.graveyardPlayPermission` declares the **continuous** form (live
while the permanent is on the battlefield, reverting the instant it leaves);
`state.graveyardPlayPermissionThisTurn` carries the **turn-scoped** form granted
by the `grantGraveyardPlay` Op. Same grammar, two lifetimes. Both shipped
narrow fields are deleted and their cards re-declared:

| card                     | declaration                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Icetill Explorer (#1190) | `{ actions: ["play-land"] }`                                                                                         |
| Lurrus (#1392)           | `{ actions: ["cast"], cardTypes: CASTABLE_PERMANENT_TYPES, maxManaValue: 2, oncePerTurn: true, yourTurnOnly: true }` |
| Yawgmoth's Will (#1149)  | Op grant: `{ actions: ["play-land", "cast"] }`                                                                       |
| Yawgmoth's Agenda        | `{ actions: ["play-land", "cast"] }`                                                                                 |

**One resolver, not three predicates.**
`getGraveyardPlayPermissions(state, player)` returns the union of every live
source — battlefield scan plus the turn-scoped grant — with spent once-per-turn
and off-turn permissions already filtered out. The three existing predicates
become thin queries over its result. A new call site cannot pick the wrong
reader, because there is one; and every gate a permission carries is applied in
one place instead of once per predicate.

**`actions`, not `zones`.** The graveyard IS the zone; `"land" | "spell"` names
the ACTION the permission licenses — playing a land is a special action that
uses no stack and consumes the land drop, casting uses the stack. `CONTEXT.md`
already forbids the overloaded reading ("_Avoid_: Play (for spells — 'play' is
reserved for lands)"), so the shipped `zones` field on `grantGraveyardPlay` is
renamed with it.

**A card-type LIST, not a card filter.** `cardTypes?: CardType[]` rather than
the general `EffectCardFilter`. That filter fails **open** on a dimension a
selector does not recognise; a permission that fails open lets a player cast
anything out of their graveyard. No card in the class needs more than a type
list.

**The use counter is keyed by source.**
`{ playerId, sourceId }` — the granting permanent's instance id (or the granting
card's instance for the Op form). Each permission spends its own use, which is
what CR gives (each ability functions independently) and what makes the record
safe for a non-legendary holder.

**No graveyard-owner axis.** Every reader keeps assuming the caster's OWN
graveyard. Cards that cast from an opponent's graveyard exist in Magic but none
is in this catalogue, and unifying is exactly what makes adding the axis later a
one-signature change instead of a fourth field.

## Consequences

- A new card in this class declares data on ONE field, and the axes it does not
  use are absent rather than implied by which field it picked.
- The fail-open risk is structurally removed: the gates live in the resolver, so
  reaching the permission at all means passing them.
- Cost is a migration: two shipped cards re-declared, two fields deleted, three
  predicates reshaped, one shipped Op field renamed (its Mechanics Registry row
  with it), and the wire affordance in `gameProjections.ts` re-pointed at the
  resolver.
- `sourceId` on the use record is more state than any shipped card can observe
  today. It is accepted deliberately: the player-keyed version's wrongness is
  invisible — no test, review or card behaviour distinguishes it from correct
  until a second once-per-turn source ships and silently eats the first one's
  use.
- The permission stays a licence to take an action at its normal cost. A grant
  that carries its own cost and its own resolution destination (Flashback,
  Escape, Madness) remains a different mechanism and keeps deferring to those
  keywords when both apply.
