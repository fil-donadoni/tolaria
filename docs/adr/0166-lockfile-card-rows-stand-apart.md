# Lockfile card rows stand a blank line apart; row and fragment order stay

## Status

accepted (2026-11-07, issue #8536). Takes up what [ADR 0165][adr-0165] left to
its own measurement.

## Context

`data/oracle-compiled.json` conflicted in 10 of the 42 attributed conflict
dequeues of ADR 0165's window (8 as the only path) and in 102 of its 612
force-pushes. Its order was not replayed then.

### What depends on the order

- **Cards** sort by `oracleId`, a UUID: the rows are already in hash order.
  `lockfileStructureProblems` pins it. The packed corpus's binary search relies
  on the same id order, and takes it from its own sort.
- **Fragments** sort by content (`compareFragmentContent`), pinned the same way.
  Readers go through `indexFragments`, and a test shuffles the table and
  expects the same output.
- **Line readers:** the retirement scan (`changedRetiredRows`) reads a `-U0`
  diff and skips any line that is not a row. Everything else parses the JSON.
  Every regeneration goes through `serializeLockfile`. The merge driver's
  minified intermediate does not, and the regeneration rewrites it.

### The measurement

Same window and events as ADR 0165, 793 in all. Each candidate rewrote the three
sides and went through `git --attr-source=<empty tree> merge-tree`.

ADR 0165 replayed only events that had already conflicted, and that overstates
a new order: it re-rolls which rows neighbour each other and cannot show the
conflicts it creates. So this replay also ran the 160 events where both sides
changed the file and merged clean.

| Shape                              | Dequeues | Force-pushes | New conflicts, of 160 clean |
| ---------------------------------- | -------- | ------------ | --------------------------- |
| As committed                       | 11       | 102          | n/a                         |
| Fragments by key                   | 11       | 101          | 4                           |
| Cards by hash of id                | 3        | 92           | 3                           |
| Both by hash                       | 4        | 94           | not run                     |
| Blank line between card rows       | 2        | 88           | 0                           |
| Blank line between all rows        | 2        | 88           | not run                     |
| Fragments by key, card rows spaced | 3        | 91           | not run                     |
| No `cards` count on fragments      | 11       | 101          | not run                     |

Of the 8 attributed dequeues with this file as the only path, spacing the card
rows clears 7, which is 3.9 % of the window's 181 dequeues. One force-push
counted above conflicted only on non-canonical bytes, and clears under any
rewrite.

Three readings:

- **Most card conflicts are neighbours, not disagreements.** Card rows are edited
  in place, and git calls edits to adjacent lines a conflict. In the 113
  conflicted events, only 2 had a card row changed differently on both sides,
  each in its `gaps`. Card hunks fall from 33 to 3, and those 3 are that pair.
- **Hashing fragments is worse.** Fragment hunks go from 10 to 47: a grammar PR's
  fragments cluster in text order, and hashing scatters them across the table.
- **Most force-push conflicts are the header.** 85 of the 102 have a header hunk
  and 82 have nothing else; 63 move one hash differently on each side. That is
  the header ADR 0157 restores at hand-off, and it reached one dequeue, so it
  costs no place in the queue and no row shape reaches it.

The gain from hashing cards was not explained. UUID order is already random, so
a re-roll should gain little, yet the total falls from 28 events with a card
hunk to 13. Spacing beats it on every count, so nothing here rests on it.

## Decision

1. **`serializeLockfile` writes a blank line between `cards` rows.** Nothing else
   in the file changes shape.
2. **Row and fragment order stay as they are.**
3. **The header stays out of it.** A same-field change on both sides is a real
   conflict, and ADR 0157 already keeps it out of the queue.

## Consequences

- The file grows by 35,352 lines and as many bytes. No row changes, so a row's
  blame survives, and a PR's diff of the file does not grow.
- The saving is a queue place on about 4 % of dequeues, not lane time: ADR 0165
  found conflict dequeues spend no CI.
- **One-off wave.** A queued PR that changes a card row conflicts once with the
  rewrite. `pr-refresh` rebases it through the driver.
- **ADR 0165's hash-order figures were not re-measured.** They carry the bias
  above, and how much of it is unknown.

[adr-0165]: 0165-shared-files-spread-by-order-not-per-pr-sidecars.md
