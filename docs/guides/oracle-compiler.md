# Oracle compiler — reading the backlog

How to see what the Oracle grammar still lacks. Everything here reads the
committed `data/oracle-compiled.json`: offline, reproducible, no corpus cache.

## The frame backlog

```bash
bun run oracle:report --frames [--format premodern] [--tail 3]
bun run oracle:report --frames --delta [<ref>]
bun run oracle:report --frames --write docs/reports/frame-backlog-<date>.md
```

ONE table, a `class` column, so "how many issues unlock N cards" ranks across
classes: `frame` (a Verb Frame, keyed by its Effect Script Op; a verb whose Op
is not in the Mechanics Registry is a `no Op` row for the Op-gap umbrella),
`composition head` (trigger, condition and static-clause openers), `argument
class` (a leaf sub-grammar shared by every frame), `cost`, `keyword`, `layout`,
`card-level`, `other` (no head the classifier reads).

- `touches` — cards with a gap in the row; `alone` — cards EVERY gap of which
  is in the row: the honest "unlocked by this one issue" figure. Shown for the
  `--format` pool (default `premodern`) then the corpus; rows sort by the
  format's `touches`, rows under `--tail` corpus cards (default 3) are cut.
- Per row: distinct `forms` (gap keys) and its top 3 forms as openings.
- `--delta` compares against `<ref>`'s lockfile (default the base branch):
  per-row movement, negative = cards the construct no longer blocks — the
  per-pilot extension numbers.
- `--write` is a hand-triggered dated snapshot for a strategy review, never a
  derived artefact in a PR (it would collide in the queue, ADR 0157).

The only declared authority is `FRAME_HEADS` in
`convex/oracle/grammar/shared/frameHeads.ts` (verb → Op, with the companion
word a verb needs: "remove … counter", "gain … life"); the classifier is
`scripts/lib/frame-backlog.ts`. Compare `--families`, which groups by the raw
opening words of the unconsumed span.
