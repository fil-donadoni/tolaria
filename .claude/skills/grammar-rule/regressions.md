# /grammar-rule — a card the rule REGRESSED

Read from step 8 when Guard C lists a card `unparsed` with nothing said about
it: the rule made a hand-written card stop round-tripping.

It gets its marker written, never a baseline row (the baseline cannot grow,
issue #5942):

```bash
bun run oracle:mark-regressions --dry-run   # the plan
bun run oracle:mark-regressions             # write it
```

It writes `// compiler-gap: <fragment> (#issue)` into the card's doc
paragraph (issue #5988), the issue being the Grammar Gap the gap's key is filed
under: its `grammar` claim row in `data/grammar-gaps.json`, else a Cluster
Signature. Idempotent.

It refuses to invent — printed `NOT MARKED`, exit 1:

- a `mismatch`: the rule mis-reads the card — fix the rule or the card;
- a gap with no filed issue;
- a card without Oracle text.

Re-run Guard C after.

Wired here, not as a `pr-fixup` row: a grammar change is the one diff that
regresses a card, and step 8 is where its red is first read.
