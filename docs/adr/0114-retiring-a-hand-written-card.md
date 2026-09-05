# Retiring a hand-written card: the test moves to the registry seam, the collision is resolved at BUILD, and a divergence is a RED — never a silent precedence

## Status

accepted (amends ADR 0108 §4, whose "hand-written always wins" is replaced by
"the two must agree"; builds on ADR 0113; shapes issue #2703)

## Context

ADR 0113 settled where compiled definitions live. It left one question open in
its own closing section: retiring a hand-written card in favour of its
proven-equal compiled twin (issue #2703) deletes the very artifact ADR 0108 §4
makes permanently authoritative.

### git is already the log; recovery was never the hard part

A deleted `convex/cards/sets/**` module is recoverable forever
(`git show <sha>:<path>`). A parallel "log of originally hand-written cards"
would duplicate git with weaker guarantees. What retirement actually destroys
is not the text but the **signal that something regressed** — nobody reads a
file that no longer exists.

### The tests cannot survive retirement as written

Measured on the tree at the time of this decision:

|                                                      |           |
| ---------------------------------------------------- | --------- |
| per-card test files (colour-split per set, ADR 0043) | **319**   |
| distinct card symbols imported from set modules      | **1,890** |

Every reference is a module import, not a registry lookup:

```ts
import { pathToExile } from "../white";
import { forest, tundra } from "../../lea/colorless";
```

Delete the module and its own test stops compiling. Issue #2703's acceptance
criteria describe how to _prove_ equivalence (swap the definition by id in a
harness) but never say what guards the card **afterwards**. Retirement as
specified would delete the card and its only permanent evidence in one step.

### Two migrations, not one

| population                          | count           | what moving it means                       |
| ----------------------------------- | --------------- | ------------------------------------------ |
| hand-written definitions            | 2,051           |                                            |
| — carrying a function somewhere     | 1,166 (56.9%)   | behavioural migration; needs #2703's proof |
| — pure data, serializable **today** | **885** (43.1%) | relocation; verifiable by deep equality    |

Of the 885, only 95 are vanilla — **790 carry real abilities** and are already
fully declarative. They serialize to 531,335 B raw / 67,320 B Brotli.

Crucially, only **180 of the 885 have a `ready` compiled twin at all**. For the
other 705 the compiler has nothing to offer, so _relocating the hand-written
data verbatim_ is the only path that removes them from the bundle — and it
covers the larger share of the immediate win.

### What the twins actually say

The 180 twins, normalised progressively:

| after normalising                                                         | identical | differing  |
| ------------------------------------------------------------------------- | --------- | ---------- |
| nothing                                                                   | 55        | 125        |
| nested ability ids                                                        | 101       | 79         |
| + `oracleText`, key order, keyword order, `X:0` ≡ omitted, scalar ≡ array | **157**   | **23 → 8** |

Field distribution of the 79: `oracleText` 47, `activatedAbilities` 27,
`manaCost` 6, `subtypes` 1, `staticAbilities` 1. Every `manaCost` case was
`{X:0}` against an omitted field or key ordering — no real disagreement.

**In none of the 180 was the hand-written definition the more correct one.**
Sampling the residue found the opposite twice, and both were verified against
the vendored corpus and the CR:

- **Ashnod's Altar.** Hand-written: `useStack: true` with an `addMana` Effect
  Script. Compiled: `useStack: false` with `manaProduced`. "Sacrifice a
  creature: Add {C}{C}" takes no target, could add mana, is not a loyalty
  ability, and neither cost nor effect moves a card to or from a library — a
  mana ability by CR 605.1a. CR 605.3b: an activated mana ability doesn't go
  on the stack. The shipped card puts one there.
- **Northern Paladin.** Hand-written: "Destroy target black **creature**",
  `targetRequirement.type: "Creature"`. The corpus
  (`data/oracle-corpus.json.gz`) gives `{W}{W}, {T}: Destroy target black
**permanent**.` We ship a strictly weaker card than the one that is printed.

Neither is a compiler gap. Both are defects in hand-written cards that the
round-trip comparison found.

### Guard C landed mid-grill, and it already answers part of this

Issue #2701 (PR #3043) shipped `convex/cards/__tests__/compilerRoundTrip.test.ts`
plus the comparator in `convex/oracle/gold.ts`. That comparator already
implements exactly the discipline this decision would otherwise have had to
invent: an **enumerated** list of normalisation axes (`SHORTHAND_ARRAY_KEYS`,
`MANA_COST_KEYS`, `sortKeys`, and one narrow behavioural elision,
`isDeadManaAbilityClosure`), each justified by the doc comment in
`cards/types.ts` that declares the equivalence, applied symmetrically to both
sides — and it explicitly refuses the general rule that would have been the
trap:

> It is deliberately not "lift every bare string into an array" — that would
> also erase a difference between `name: "Wall"` and `name: ["Wall"]`, which is
> not a shorthand and not equivalent.

What Guard C does **not** do is distinguish _why_ a card fails to round-trip.
Both cards above sit in `compilerRoundTrip.baseline.ts` among 1,719 entries, a
list whose only stated property is that it shrinks. A baseline entry today
conflates two opposite defects:

- the compiler cannot yet read the card (a grammar gap → the backlog PRD #2693
  user story 9 ranks), and
- the compiler reads it correctly and disagrees, **and is right** (a card bug →
  fix the card).

The second class is invisible inside the first.

## Decision

### 1. Retirement's durable guard is the retained test, plus a marked lockfile row

Split by population, because the two have different evidence available:

- **A card that had a per-card test** (310 of the classifier's 319 FREE
  closures are "AFK-ready", i.e. already have one): the test is **rewritten
  onto the registry seam** — `getDefinition(id)` / `getCardByName(name)`
  instead of a module import — and kept. That test becomes the permanent
  behavioural guard; a later compiler regression on that card is red, not
  silent. Deleting a test written for a card whose behaviour was imperative is
  deleting the only proof that the compilation was ever correct.
- **A card that never had one** (the bulk of the 885 already-declarative
  cards, covered by CLAUDE.md's per-Op regime rather than by hand-written
  tests): the guard is the **lockfile row**, which is already a committed
  golden snapshot diffed on every regeneration (ADR 0105). What is added is a
  **retirement marker** on the row — "this is the only copy; no hand-written
  twin remains" — plus a gate check that demands human review of a diff
  touching a marked row. That is the log, inside the artifact rather than
  beside it.

### 2. The collision is resolved at BUILD; the served artifact is the catalogue, not the pool

The generator merges hand-written and compiled into **one** asset, writing a
single row where both exist. The runtime resolves nothing, because nothing is
left to resolve.

This deletes a class rather than managing it: `excludeHandWritten` and ADR 0108
§4's "runtime backstop for a hand-written card added since the pool was last
regenerated" exist only because resolution happens late. Resolved at build, the
case cannot arise — and a hand-written card added without regenerating is
caught by ADR 0113's server/client identity guard rather than filtered away in
silence.

**Provenance stays on the lockfile, not on the asset.** The asset is a resolved
catalogue; provenance is needed where the retirement marker and the review of a
diff live, which is the lockfile.

Consequence to absorb deliberately: the artifact stops being "the compiled
pool" and becomes "the catalogue". Its name, its size budget and
`scripts/__tests__/oracle-pool-size.test.ts` all change subject — they no
longer measure compiled cards but all cards.

### 3. A divergence is a RED, not a precedence — this amends ADR 0108 §4

Where a hand-written and a compiled definition both exist and differ after the
enumerated normalisation, **the build fails** and a human decides, recording
which side held the defect. There is no silent winner.

ADR 0108 §4 said the hand-written definition is always authoritative. Applied at
merge time that rule would have discarded the correct copy of Ashnod's Altar
and of Northern Paladin, and cemented both defects permanently — the correct
version is thrown away before anyone sees it. The inverse rule (compiled wins)
is worse in the other direction: a compiler regression on a working card would
become the new truth unobserved.

So the rule becomes: **hand-written and compiled must AGREE; disagreement is a
defect on one side, and it must be named.** This is the same fail-closed
doctrine ADR 0105 already applies to the compiler itself — a clause with no
grammar stops the card rather than being approximated; two authorities that
disagree stop the build rather than one being guessed.

The measurement says this is affordable rather than a wall: 8 residual cases
across 180 twins. Where a whole class turns out to be normalisation noise, the
axis is added to the comparator under §4's rule; where it is a defect, it is
fixed on the side that holds it.

### 4. The comparator's axes are enumerated and justified — never inferred

Already shipped in `convex/oracle/gold.ts`; this ADR adopts it as the standing
rule rather than proposing anything new. Two constraints are made explicit:

- **Every axis names the doc comment that declares the equivalence**, and is
  applied symmetrically to both sides. A general rule ("lift every string to an
  array") is forbidden — it erases differences that are not shorthand.
- **The comparator never folds a field the engine reads to decide**:
  `useStack`, `cost`, `effects`, `targetRequirement`, `manaProduced`. Those
  diverge and the build stops. A comparator permissive on those fields is
  precisely phase.rs's failure mode, where `is_card_supported` counts a
  misparse as supported and ~4,700 wrong cards report green.

An earlier draft of this decision proposed tightening `CardDefinition` so
scalar-vs-array could not arise at the source. That is **rejected**: the dual
encoding is documented authoring shorthand, and the catalogue writes both forms
for the same phrase on different cards (Nemata `subtypes: "Saproling"`, Elvish
Farmer `["Saproling"]`). While hand-written cards exist the ergonomics stand;
the comparator is the right place to absorb it.

### 5. The Guard C baseline is triaged by direction of defect

The baseline entries are split into "compiler gap" (feeds the grammar backlog)
and "card defect" (feeds a fix). Shrinking the baseline is not enough if the two
classes stay merged: a card bug parked in a list labelled "the compiler can't
read this yet" is a bug nobody is looking for.

**Realised by issue #3050 with a THIRD class.** Implementing the split showed
that two classes cannot cover the rows honestly: a row where the compiler
produced a definition and the two disagree is neither, until somebody rules on
which side is wrong, and pretending otherwise would have put a ruling nobody
made into the file. So the shipped shape is `COMPILER_GAP_ROWS` /
`CARD_DEFECT_ROWS` / `UNDETERMINED_ROWS` (1,688 / 29 / 2 at the time of
writing) — the third being a queue, not a resting place.

The direction is CHECKED against the card's live `roundTripCard` verdict
(`DIRECTION_ALLOWED_KINDS`, `scripts/lib/baseline-triage.ts`), and the check
has force exactly where no ruling is possible: `unparsed` can only ever mean
the compiler, `no-oracle-text` can only ever mean the card. On a `mismatch` all
three directions are legal, because a compiler MISREAD, a card defect and an
open question are all real outcomes of one — what forces that ruling into prose
is `KNOWN_DIVERGENCES` in `convex/oracle/__tests__/gold.test.ts`, which no
mismatching card can reach `main` without joining. Report:
`bun run oracle:triage`.

## Consequences

- **Issue #2703 gains work it did not scope**: rewriting each retired card's
  test onto the registry seam, and the retirement marker plus its gate check.
  Its stated mechanism (prove, then retire) is unchanged.
- **The round-trip comparison is a defect detector for the existing catalogue,
  not only a migration tool.** Two confirmed defects came out of sampling three
  cards from a residue of eight, on the 20% of the 885 that have twins today.
  The full pass is owed a count.
- **705 of the 885 leave the bundle without the compiler being involved at
  all** — relocation of already-declarative data, verifiable by deep equality
  against the live definition. This is the cheapest available share of ADR
  0113's bundle win and it carries no behavioural claim.
- **A hybrid client is permanent.** ADR 0045 keeps `resolve()` as the escape
  hatch for protocol-like cards, so a code-shaped residue never disappears. But
  it converges toward the **80** definitions with a top-level
  `resolve`/`resolveSteps`/`effect`, not the 1,166 that carry any function: the
  other 1,069 carry only nested predicates
  (`triggeredAbilities[].matches` 560, `staticEffects[].applies` 215,
  `triggeredAbilities[].resolve` 219, `activatedAbilities[].effect` 162), which
  is exactly what the compiler's declarative slots replace.
- **The migration is a repeatable sweep, not an event.** `oracle:compile`
  regenerates the lockfile on every compiler change and
  `scripts/migration-classifier.mjs` re-runs on demand (474 closures, 319 FREE,
  140 Op-blocked with a named backlog: `moveZone` 8, `revealHand` 7,
  `removeStaticAbilities` 6, …). Each new Op releases more cards. What degrades
  after a retirement is the _reference_: the first pass compares against a
  hand-written gold, later passes have only the lockfile diff — which is
  precisely why §1 keeps the test.
- **`.claude/rules/gre-development.md` cites the wrong subrule** for the mana
  ability invariant: CR 605.3a is about _when_ a mana ability may be activated;
  the "doesn't go on the stack" rule is **CR 605.3b**. A resolvable but wrong
  id is the one class `cr:lint` cannot catch.
