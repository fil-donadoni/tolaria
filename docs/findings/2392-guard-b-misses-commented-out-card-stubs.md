---
title: Guard B's marker regex is line-initial, so a commented-out card stub's `tracked-by:` ref is unenforced — 42 of 83 stub files are invisible to it
discoveredBy: 2392
status: draft
confidence: high
---

**What is wrong.** `divergenceMarkers.test.ts` (Guard B) only sees a marker word
that sits **immediately after** the `//`. The natural way to write a
blocked-card note — a prose paragraph explaining why the card is commented out —
puts words like "divergence" mid-sentence, where the regex never matches. The
`tracked-by: #NNN` ref such a stub carries is therefore decorative: nothing
fails if it is deleted, and nothing fails if the issue it names is closed,
renumbered, or was never real.

**Evidence.**

- The pattern is anchored to the comment opener:
  `convex/cards/__tests__/divergenceMarkers.test.ts:47-48` —
  `/\/\/\s*(Deferred|DEFERRED|divergence|DIVERGENCE|not implemented|TODO)\b/i`.
  The `\/\/\s*` prefix means only a line whose comment _starts_ with the word
  matches.
- Demonstrated on the card this issue was about. The Necromancy stub
  (`convex/cards/sets/vis/black.ts:45-111`) ends in `// tracked-by: #1975`.
  Deleting that line and running the guard leaves it **green**
  (`Test Files 1 passed (1) / Tests 9 passed (9)`) — the mutation was confirmed
  applied via `git diff --stat` before the run. Its note says "STILL BLOCKED"
  and "neither of which exist", never a line-initial marker word.
- Scale, measured at HEAD 890ebd61: 83 files under `convex/cards/sets/**`
  contain a commented-out `// export const` stub (120 stub lines total). Of
  those, **42 contain no line-initial Guard-B marker at all** — including
  `inv/blue.ts` and `inv/green.ts`, the two other cards blocked on the same
  missing primitive as Necromancy, and `spm/multicolor.ts`, cited in the
  Necromancy note as the sibling of its own gap.

**Why it may not deserve its own issue.** Two honest counter-arguments. First,
Guard B is scoped to _divergence markers_ by name and design — a commented-out
`export const` is a different artifact (a card that was never shipped) from a
shipped card that diverges from its Oracle text, and the guard's header says
the window is "the marker's own comment PARAGRAPH", not "every deferral note".
Widening it to all stubs is a scope change, not a bug fix. Second, the fix is
not obviously cheap: relaxing the anchor to match the marker word anywhere in a
comment line would fire on ordinary prose ("this does not diverge from Oracle",
"the TODO was resolved in #NNN") across the whole catalogue, so it likely needs
a _different_ rule keyed on `^// export const` rather than a looser regex.

The reason it is written up anyway: the failure is silent in exactly the way
the repo's own doctrine warns about. A stub reads as tracked, the ref makes it
findable, and nobody learns the ref is unchecked until — as here — someone
mutates it on purpose. If the intended invariant is "a commented-out card names
a live tracking issue", that invariant currently holds only by author
discipline on half the corpus.
