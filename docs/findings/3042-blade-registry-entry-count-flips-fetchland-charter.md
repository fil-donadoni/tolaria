---
title: Adding ANY `must` blade entry deterministically flips the fetchland charter entry to Island
discoveredBy: 3042
status: draft
confidence: high
---

**What is wrong.** Appending any entry to `BLADE_SCENARIOS` — including a
trivial "play your only Forest" entry that shares no card, no zone and no seat
with it — makes the charter entry `charter: fetches the land that makes its
removal castable` choose Island instead of Swamp on seeds 1, 2 and 3, and the
`must` tier goes red. The two entries never run in the same process under a
`-t` filter, so the channel is not test execution order.

The practical consequence is that the standing rule in
`.claude/rules/bot-development.md` — "Every behaviour change ships a `must`
blade entry in the same PR" — currently cannot be satisfied: any PR that obeys
it reddens `bun run test:blade` and therefore `bun run land`.

**Evidence.** Reproduced deterministically in a worktree at `9af13333a`
(`health:status` reports main GREEN at that commit):

| tree                                                                                                       | result                                 |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| base `registry.ts`                                                                                         | `Tests 2 passed` (×2 runs)             |
| base + one appended `must` entry (issue #3042's Entomb position)                                           | `Tests 1 failed \| 1 passed` (×6 runs) |
| base + one appended `must` entry (trivial `play-land` probe, no shared cards)                              | `Tests 1 failed \| 1 passed`           |
| base code with ONLY `registry.ts` carrying the extra entry (evaluator change reverted, new module removed) | `Tests 1 failed \| 1 passed`           |

```
BLADE_TIER=must bunx vitest run --config vitest.blade.config.ts \
  -t "fetches the land that makes its removal castable"
```

Failure text: `seed 1: chose [resolution-choice cards=[Island]] — expected one
of [resolution-choice card=Swamp]` (likewise seeds 2 and 3; seeds `0xb1ade` and
4 are unaffected).

Removing each of the appended entry's five cards one at a time does not change
the outcome, so it is not a card-registration side effect. `runner.ts`,
`setup.ts` and `matcher.ts` declare no module-level mutable state, the base deck
is fixed (`BASE_DECK_CARD`, `BASE_DECK_SIZE`), and the charter entry's seeds are
explicit rather than index-derived — so the mechanism was not identified here.
`vitest.blade.config.ts` sets `isolate: false`, which is the first thing to rule
out.

**Why it may not deserve its own issue.** It is possible the charter entry is
simply knife-edge — the note on it says the Island answer is exactly what
truncating the choice-node candidate set produces — and that the honest fix is
to harden or retire that one entry rather than to hunt a harness leak. That
would be a line on the blade-suite work rather than a ticket. Against that: the
sensitivity is to a change that provably cannot reach the position, which is a
property of the harness, not of the entry; and while it stands, the `must` tier
gates every bot PR on an unrelated coin-flip.
