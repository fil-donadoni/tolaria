---
title: Monarch code cites CR 720 (Omen) where the vendored CR numbers the monarch 725
discoveredBy: 2948
status: draft
confidence: high
---

**What is wrong.** The vendored Comprehensive Rules number the monarch
designation CR 725 (`bun run cr 725.1`, "The monarch is a designation a player
can have"); CR 720 is now Omen cards (`bun run cr 720.2`, "The text that
appears in the inset frame…"). About 30 monarch comments still cite `CR 720` /
`CR 720.1`–`720.4` — `becomeMonarch` and `exileUntilMonarchChanges` in
`convex/gre/state.ts`, `GameState.monarchId` / `monarchReturnWatch` in
`convex/gre/state/declarations.ts`, the combat-damage steal in
`convex/gre/phases.ts`, Palace Jailer in `convex/cards/sets/cn2/white.cards.ts`,
`convex/gre/__tests__/monarch.test.ts` titles. A reader who prints the cited
rule gets Omen text.

**Evidence.** `grep -rnE "CR 720" convex --include=*.ts | grep -i monarch`
(30 hits at the base this pass was cut from). `cr:lint` stays green because
it checks that an id resolves and, for 701/702 only, that the section title
matches — 720.x resolves, just to the wrong rule. Issue #2948's new lines cite
CR 725.3 and left the old ones alone (out of its scope).

**Why it may not deserve its own issue.** Comment-only: no behaviour depends
on the numbers. Every touched line owes a `cr:ledger confirm`, so it is a
mechanical but ledger-heavy sweep, and could ride the next monarch change
rather than stand alone. The broader question — whether `cr:lint` should
extend its title check beyond 701/702 to catch renumbered sections like this —
is the part worth a ticket.
