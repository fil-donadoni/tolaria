# A wholly vacuous Verdict is counted in the census's `stale` column

Noticed reviewing PR #3599 (issue #3593). Not fixed there — zero verdicts in
the corpus reach it, and the fix changes a census column.

`evalPairsOf` now drops a pair whose two sides resolve to the same move, and a
verdict whose EVERY disallowed candidate is interchangeable with the allowed one
therefore yields no pairs at all. That is reported through `VerdictPairs.error`
("every disallowed candidate is interchangeable with the allowed one"), and
`coverage.ts` turns every `error` into the **stale** column — documented as "the
verdict has gone stale against the engine".

It has not. It was always vacuous: the judge distinguished two copies of one
card, and nothing about the engine moved under the verdict. The row also loses
its `features`, which are perfectly computable.

What it wants is its own classification — a `vacuous` column beside `stale`, or
a `VerdictPairs.vacuous` flag that `collectVerdictReport` keeps out of `errors`.
Either touches the census table, its formatter and the doc that quotes the
table, which is why it is written down rather than done.

Reachable and asserted today by `interchangeable.bot.test.ts` ("drops the
vacuous copy-beats-copy pair instead of asserting it"), so the branch is live —
it is only the corpus that has no instance of it.
