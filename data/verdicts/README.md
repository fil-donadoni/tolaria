# The Verdict corpus

One JSON file per judged position (issue #3402, PRD #3397, ADR 0124 §1).

A **Verdict** is a position and an answer: the board as a `ScenarioSpec`, the
candidate list the Bot's own enumerator produced, and which of those candidates
was the right play. It is deliberately **not** a feature vector — the
evaluation's terms change, and a record made of numbers dies with them, while
"this board, and the right move was X" survives every refit. The shape and the
full derivation live in `convex/gre/ai/verdicts/types.ts`.

## Where the files come from

Two sources, read the same way (`convex/gre/ai/verdicts/fileSource.ts`):

- **`"source": "in-play"`** — written by `bun run verdicts:pull`, which exports
  the `verdicts` Convex table a tester fills in while playing. File name is the
  document id; the verdict id is `in-play:<document id>`. **Do not hand-edit
  these** — the exporter would overwrite the edit on its next run.
- **`"source": "authored"`** — written by hand: a counter-example somebody cut
  on purpose. The exporter never touches a file whose `source` is not
  `in-play`, and never deletes anything, so these are safe here.

The blade registry is a third source, but it is **derived at fit time** and
never written to disk (`registrySource.ts`); its ids are `registry:<label>`.

## Why git and not the database

A fit must be reproducible from a checkout — same verdicts, same weights, to
the bit (ADR 0124 §3). A corpus living in one developer's Convex deployment
would make every weight set impossible for anyone else to re-derive, so the
table is intake only and this directory is the corpus.

## Authoring one by hand

The candidate `key`s are `moveKey` strings from the Bot's own enumerator, so
they cannot be invented — build the position and read them off:
`buildVerdictState` + `candidateMoves` + `moveKey`
(`convex/gre/ai/verdicts/position.ts`, `convex/gre/search.ts`).
`authored-lethal-bolt-to-the-face.json` is a worked example.

Anything this directory holds that does not parse as a Verdict stops the run by
name — these files are repo state, not a best-effort feed.
