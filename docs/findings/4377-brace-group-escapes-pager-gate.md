---
title: A brace group escapes deny-guard § 3 entirely — `{ bun run test; } | tail`
discoveredBy: 4377
status: draft
confidence: high
---

**What is wrong.** § 3 of `.claude/hooks/deny-guard.sh` never sees a gate that
is wrapped in a brace group, because the top-level segmenter treats a bare `;`
as a SEGMENT boundary. `{ bun run test; } | tail -20` splits into
`{ bun run test` — which carries no `|`, so the § 3 pager loop skips it — and
` } | tail -20`, which carries the pipe but no gate text. The gate runs and its
exit code becomes `tail`'s: the precise failure § 3 exists to prevent, past the
`bun run <script>` clause and the bare-gate clause alike.

**Evidence.** Verified against `origin/staging` (before issue #4377's anchoring
work) and against the fix branch: `{ sh scripts/gate-run.sh check:lane; } |
tail` exits 0, ALLOWED, in both. The segmenting is deliberate and has its own
test — `scripts/__tests__/hook-policy.test.ts`: "`;` must not join a gate into
a pager segment" — so this is not a regression; it is a hole that the `;` rule
opens as a side effect. Issue #4377 documents the limit in § 3's comment rather
than closing it, and keeps `{` in the head-extraction boundary set for the
shape that DOES reach the predicate (`{ bun scripts/gate.ts heavy | tail ; }`,
where the pipe precedes the `;`), which is denied.

**Why it may not deserve its own issue.** Closing it means teaching the
top-level splitter about `{…}` / `(…)` nesting before it splits on `;` — which
is exactly the "parse shell far enough to know the difference" that this file's
own header rules out as how a guard starts denying legitimate work at random.
It may be better as a line on the § 3 tradeoff comment (where it now is) than
as a ticket. Against that: this is not a false-DENIAL tradeoff like the quoted-
pattern class already accepted there — it is a false-ALLOW on the one invariant
the file protects, and the shape is short enough to be typed by accident.
