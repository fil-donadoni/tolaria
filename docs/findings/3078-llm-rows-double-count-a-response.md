---
title: One API response writes several llm rows, so every cost figure over the store is inflated
discoveredBy: 3078
status: draft
confidence: high
---

**What is wrong.** `llm` is keyed by the transcript record's `uuid`, but the
transcript writes **one record per content block** and gives every record of a
multi-block response that response's **full usage payload**. A reply that says
something and then calls a tool lands as two rows with identical
`in_tok`/`cache_read`/`cache_write`/`out_tok`, and `costOf` is applied to both.
Every `SUM(cost)` over the store therefore counts such a response twice or more.

**Evidence.** `scripts/telemetry-ingest.ts:339` inserts on `e.uuid`;
`message.id` — the field that actually identifies a response — is never read.
On session `f8dc2dbc`, records `c0ddfe70` (`content: [text]`) and `52b83564`
(`content: [tool_use]`) both carry `message.id = msg_011CedGxmy1t9eEU` and both
report `output_tokens: 142`.

Over 2026-08-28 → 2026-09-05: 24895 main-thread rows collapse to 15325 distinct
responses, and `$3368` of main-thread cost collapses to `$1925` — a **42%**
inflation. Subagents: `$566` → `$356`. Reproduce with the query in
`scripts/lib/telemetry-context.ts` § "One response, several rows", or by
diffing `bun run telemetry:context --json`'s `deciles` against its
`perResponse`.

**Why it may not deserve its own issue.** Nothing downstream compares these
numbers to a bill — the dashboard, the scorecard and every cost figure quoted in
an issue are all read RELATIVELY (this role vs that one, this week vs last), and
a uniform 42% multiplier leaves every ratio intact. Issue #3078's own baseline
was taken from the inflated table and reproduces exactly against it, which is
why `summariseDeciles` reports the store as recorded rather than quietly
correcting it. Fixing the key is a one-line change in the ingest, but it
re-bases every historical figure anyone has quoted, so it wants a deliberate
decision rather than a drive-by.
