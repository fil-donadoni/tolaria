# The Combo Corpus is a measure first; Bot knowledge only behind the Executable gate (amends ADR 0102)

## Status

accepted (2026-11-06, owner decision in a design interview; amends
[ADR 0102][adr-0102] § "two sources and only two": a third source is admitted,
on the terms below; ADR 0102's deletion of the per-combo boost layer stands).

## Context

ADR 0102 fixed the play Bot's knowledge at two sources — the ISMCTS search over
the real engine and the DSL semantic layer — and rejected per-card knowledge
because it does not scale to the catalogue target and because a fix that names
a card moves one card. It measured the one per-combo layer that had been built
(`comboAnnotations.ts`, a state-based boost in the evaluation) converging AWAY
from the combo with more search, and deleted it. The combo answer it gave is a
horizon primitive, the CR 732 loop shortcut (PRD issue #2687), still open.

Three facts changed the question, not the answer:

1. **The draft Bot already has a per-card combo seam.** `comboEdgeTerm`
   (`convex/limited/botDrafter.ts`) reads `comboEdges` from a Card Profile,
   capped at two pairs per candidate (ADR 0072/0073, glossary **Combo Edge**).
   No profile file carries one. The hand-authored escape hatch was never used.
2. **An external, curated corpus exists and joins on our key.** Commander
   Spellbook publishes a daily bulk export (~120k variants, ~720 MB) keyed by
   Scryfall oracle id — the key `data/card-index.json` carries. CubeCobra's
   combo tab reads the same source. Projected onto the catalogue on
   2026-11-06: 1,394 combos with every piece in the catalogue (210 two-card),
   each with the zone every piece must be in, what it produces (a closed
   feature vocabulary), the mana it needs and a popularity count. Run-time
   fetches are out (offline gates, 80 req/min, deterministic Bot); a vendored
   projection is in, the pattern the CR already follows (ADR 0098).
3. **The Bot cannot execute most of what the corpus names.** Of the two-card
   combos in the catalogue, none produces a terminal outcome on its own: they
   are loops (Intruder Alarm + Shrieking Drake, Staff of Domination + Priest of
   Titania) — ADR 0102's horizon case — or locks (Glacial Chasm + Crucible of
   Worlds), which the evaluation has no term for. The terminal kills (Hermit
   Druid + Thassa's Oracle) are three or four pieces. Feeding the drafter a
   combo the play Bot cannot finish loses value in Bot-vs-Bot.

So the pressure is real on two sides: a draft seam standing empty, and a
knowledge source whose contents the Bot mostly cannot use yet.

## Decision

1. **The Combo Corpus is vendored data, never authored and never fetched at
   run time.** `data/combos/corpus.json` is the projection of the Spellbook
   export onto the catalogue — pieces with their zones and oracle ids, the
   `produces` features, mana needed, popularity, and the human text (steps,
   prerequisites) — produced by an explicit import script, regenerated with
   the card index, credited to Commander Spellbook. Variants with a template
   piece ("a creature with haste") and variants above four pieces are left
   out. Nothing under `convex/` or `src/` imports this file (seam test).

2. **It is a measure first.** The **Combo Census** assembles every entry's
   position (each piece in its zone, the mana needed, a passive opponent who
   passes throughout — the CR 732.2a shape), lets the Bot play it out at a
   fixed budget and fixed seeds, and records **Executable** (the Bot wins
   within the ply cap), **Initiated** (the root Move uses a piece, no win
   follows) or **Untouched** (no piece is ever played). A non-terminal
   `produces` is **unmeasurable** until the loop detector (issue #3139) emits
   a certificate the census can read. The census is a health-tier report, like
   the audit census and the greedy report; it is not a Ladder game and makes no
   strength claim. `must` blade entries are promoted from it by hand, few, each
   naming its corpus id.

3. **Knowledge sits behind the Executable gate.** The census derives
   `data/combos/executable.json` — pieces, zones, `produces`, mana, Executable
   entries only — and that derived file is the ONLY combo data a Bot seam
   reads. Three seams, all **ordering**, none valuation:
    - the draft **Combo Edge** term, through the existing `GetCardProfile`
      seam (edges derived from the corpus replace hand authoring; the
      per-candidate cap stays);
    - a deck-build term in `autoBuild` keeping an Executable entry's pieces
      together;
    - a leg of the `search-library` prior: the candidate rises into the top
      band when the entry's other pieces are already in their zones AND the
      mana the player can produce covers `manaNeeded`; otherwise today's
      `libraryTargetWorth` scoring, unchanged. Issue #2800's loop-detector
      probe becomes the second leg of the same prior, the fallback for a combo
      the corpus does not name.
      **Nothing from the corpus ever enters the leaf evaluation or the reward.**
      That is the line ADR 0102 measured, and it holds.

4. **Weight is a constant per class of `produces`** — a terminal outcome above
   a lock above a non-terminal infinite — refined by the census reading once
   it has data (a combo Executable at a low budget outranks one Executable
   only at a high budget). Popularity is never a weight: it measures Commander
   play, not a two-player draft.

5. **The derived slice reaches a client only by dynamic `import()`**, a
   chunk loaded at the first Draft Lab pick or the first client-Brain tutor,
   never statically from `botDrafter.ts` or `choiceCandidates.ts` — the
   `brain.worker` and main-chunk budgets (`check:bundle`) guard exactly that
   re-entry of data into code. Server side the resolver module imports it
   statically; the Convex bundle carries only what the Bot can use, so the
   gate is also the weight bound as the catalogue grows.

## Consequences

- ADR 0102's two-source sentence becomes three, with the third admitted only
  as ordering, only Executable, only derived. Its deletion of per-combo
  evaluation boosts is reaffirmed, and its horizon diagnosis is now measured
  over hundreds of combos instead of two Twin entries: the census is the
  acceptance instrument for the repeat-loop Move (issue #3141).
- Today the knowledge seams are nearly empty — the Executable set is the few
  terminal kills — and they fill on their own the day the loop shortcut
  lands. No card name enters an identifier; a new combo card needs no Bot
  work; a new Spellbook variant needs a re-import.
- Locks are a named gap the census exposes (**Untouched** with a `Lock`
  feature) and this ADR does not close.
- The human text in the corpus serves a future "combos in this deck" surface
  from a generated asset, never from a bundle; no UI ships under this ADR.

[adr-0102]: 0102-combos-via-cr-732-loop-shortcut-not-combo-registry.md
