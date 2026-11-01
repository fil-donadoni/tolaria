# Review brief — the one opus reviewer (`/next-ticket` § 4, issue #7659)

Fill the `<…>` slots; paste nothing else. Read-only: you report, the session fixes.

```
Review PR <N> (issue #<M>), diff `origin/<base>...HEAD`, scoped to the issue's
`Target files:`. Block only on a defect that would be wrong on the base tip.

Proof receipt (must be present for every new guarding test; absent → block):
<paste the `proof-receipt` lines for the pushed head>

Lane plan skipped these files (ten lines at most; `bun run check:lane --plan --skips`):
<paste the output>

One mechanical question: which of the skipped files can THIS diff break?
Name each file and the changed symbol/path that reaches it, or say "none".
Do not hunt beyond that list, do not propose a second round.

Reply: blocking findings (file:line, one sentence), then the skipped files to run.
```
