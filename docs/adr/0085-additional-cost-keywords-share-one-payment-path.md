# Additional-cost keywords share one payment path, and "kicked" is separated by splitting the payment record at the write

## Status

accepted — implemented by issue #2078 (the discriminator, the table and the
split); the Offspring mechanic itself is issue #2079.

## Context

Offspring (CR 702.175, issue #785) is the second keyword in the engine whose
cost half is, verbatim, Kicker's:

- **702.33a** "Kicker [cost]" means "You may pay an additional [cost] as you
  cast this spell."
- **702.175a** "Offspring [cost]" means "You may pay an additional [cost] as
  you cast this spell" **and** "When this permanent enters, if its offspring
  cost was paid, create a token that's a copy of it, except it's 1/1."

ADR 0079 already generalised that cost half into a reusable subsystem:
`CardDefinition.kickers[]` is an array of `CostLegs & { id, description, multi? }`,
so an additional cost may be mana / a permanent / life / cards from hand; the
per-id payment record is snapshotted on the stack item as
`StackItem.kickerPayments`; and `announceCast` validates it, folds the mana leg
into the pending cost, routes the non-mana legs into the cast's single
sacrifice/hand pickers, projects `kickers` to the client, and renders one
cast-dialog control per entry. Nine sites, all of them keyword-agnostic.

Declaring Offspring as a `kickers[]` entry therefore reuses all nine for free.
It is also, naively, **wrong** — because the CR puts one observable difference
in exactly one place:

> **702.33d** If a spell's controller declares the intention to pay any of that
> spell's **kicker** costs, that spell has been **"kicked."**

"Kicked" is defined over kicker costs only. A spell whose offspring cost was
paid is not kicked. That distinction is already observable in this engine, via
six readers that all derive from `totalKickerCount(payments)`:

| #   | Site                             | Drives                                                                                             |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `game.ts:5218`                   | the `kickedTargetRequirement` swap at cast (Bloodchief's Thirst)                                   |
| 2   | `gre/state.ts:5423`              | writes `StackItem.wasKicked`                                                                       |
| 3   | `gre/state.ts:5461`              | the `kickerCount` fed to `applyEntersWithCounters` (`count: "kicker"` — Duskwalker, Pouncing Kavu) |
| 4   | `gre/state.ts:12062`             | `SpellContext.getKickerCount()` → `{ kickerCount: true }`                                          |
| 5   | `gre/targetFilters.ts:1106`      | the `spellWasKicked` target filter (#1956 — "counter target spell if it was kicked")               |
| 6   | **`src/lib/card-utils.ts:1241`** | `matchesSpellWasKicked` — **client-side** clickability                                             |

`totalKickerCount` receives only the payment record, never the
`CardDefinition`, so as written it cannot tell an offspring entry from a kicker
one. Site 6 is on the client and receives a slim stack item with no definition
at all, while its own doc comment claims the server's single authority
(ADR 0079).

CR 702.33e/f additionally make the "if it was kicked" abilities **linked**
(CR 607) to the specific printed kicker, and 702.175a/b give offspring its own
separate linked trigger — so the rules want the two identities distinct even
where the payment machinery is identical.

## Decision

**One payment path, keyword-tagged identity, and the separation enforced by
where the record is written rather than by how it is read.**

1. A `kickers[]` entry carries a `keyword` discriminator drawn from a **closed
   union** with an **exhaustive table** over it:

    ```ts
    const ADDITIONAL_COST_KEYWORDS: Record<
        AdditionalCostKeyword,
        {
            countsAsKicked: boolean;
            requiresTrigger: boolean;
            allowsMulti: boolean;
        }
    >;
    ```

    A `Record` over a closed union makes adding a keyword a **compile error**
    until its kicked-ness is stated. No default is offered in either direction:
    a deny-list (`keyword === "offspring"` ⇒ skip) fails **open**, silently
    counting the next keyword in the family as kicked; an allow-list
    (`keyword === "kicker"` ⇒ count) fails closed but would silently get
    **Sticker kicker** wrong, which CR 702.33h defines as _meaning_ "Kicker
    [cost]" and which therefore genuinely is kicked. The table refuses to answer
    by default. A companion guard asserts every union member is a Mechanics
    Registry row with `kind: "keyword-ability"` and `status: "implemented"`.

2. **The payment record splits at the write, not at the six reads.** All the
   upstream plumbing stays single — one array, one `announceCast`, one
   validation, one fold, one dialog — but the snapshot onto the stack item is
   partitioned by keyword: `kickerPayments` receives only entries whose keyword
   `countsAsKicked`, the rest go to a sibling record. Per-id reads
   (`{ additionalCostPaid: id }`) are a pure function over both.

3. The DSL's per-cost reader is renamed `{ kickerPaid: id }` →
   **`{ additionalCostPaid: id }`** (84 sites, 14 files), and
   `kickerPaidCondition` with it. The internal plumbing names
   (`kickers`, `kickerPayments`, `totalKickerCount` — 121 references) are
   deliberately **left alone**: a name that lies costs little where nobody reads
   it and a lot on the surface every future card author reads. `kickerCount`
   keeps its name because after the split it keeps its exact CR 702.33d meaning.

4. A catalogue guard asserts the **two halves ship together**: a cost entry
   whose keyword `requiresTrigger` must have its twin trigger and vice versa,
   and `allowsMulti: false` rejects `multi: true`. Both read the table, so Gift
   (CR 702.174) and Casualty inherit the guard without new code.

### Considered and rejected

- **A first-class `CardDefinition.offspring` field with its own record.**
  Isolation from "kicked" for free, but it duplicates all nine plumbing sites to
  express a difference the CR locates in one sentence — and the next keyword in
  the family duplicates them again.
- **Renaming `kickers[]` → `additionalCosts[]` wholesale.** 121 references over
  17 files plus wire, dialog, serialize and bot, as pure churn on a subsystem
  ADR 0079 has just stabilised, for a naming gain confined to internals.
- **Narrowing the six readers instead of splitting the write.** Needs a
  definition lookup at six sites including one on the client that has none, and
  leaves a seventh reader added later silently wrong. Splitting at the write
  makes a new keyword fail closed **structurally**, which is the difference
  between a rule and a request to write careful code.

## Consequences

- `StackItem` and `CardInstanceState` grow a second payment record, owing
  serialization entries and round-trip coverage.
- `{ additionalCostPaid: id }` reads across two records; the merged view is the
  single authority for per-id questions, as `totalKickerCount` remains for
  kicked-ness.
- The bot's two cast sandboxes (`gre/search.ts`, `gre/applyMove.ts`) build
  their own `StackItem`s, so they partition too — otherwise the search would
  disagree with the mutation about whether a spell was kicked. (This bullet
  originally recorded that the enumerator emitted no `kickerPayments` at all;
  issue #2081 closed that gap first — `enumerateKickerVariants` now cross-
  products genuine payment records into `enumerateCastMoves`, which is exactly
  why the two sandbox writes are load-bearing here.)
