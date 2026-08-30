---
title: CR 603.3c is cited across the repo for "no legal target, trigger removed from the stack", which is CR 603.3d
discoveredBy: 1324
status: draft
confidence: medium
---

**What is wrong.** `CR 603.3c` covers exactly one thing — a **modal** triggered
ability announcing its mode: _"If a triggered ability is modal, its controller
announces the mode choice when putting the ability on the stack. If one of the
modes would be illegal … that mode can't be chosen. If no mode is chosen, the
ability is removed from the stack."_ It says nothing about a non-modal trigger
whose required target has no legal candidate. That is `CR 603.3d`: _"If a choice
is required when the triggered ability goes on the stack but no legal choices can
be made for it, or if a rule or a continuous effect otherwise makes the ability
illegal, the ability is simply removed from the stack."_

Dozens of comments and test names attribute the second rule to the first id.

**Evidence.** After the reflexive-trigger correction in the same PR, ~136
`CR 603.3c` citations remain. Spot-checked examples where the subject is a
non-modal trigger dropped for want of a legal target, so the id should be
`603.3d`:

- `convex/cards/sets/bro/__tests__/colorless.test.ts:214` — _"removes the trigger with no legal target when both graveyards are empty (CR 603.3c)"_
- `convex/cards/sets/inv/__tests__/black.test.ts:506` — _"removes the trigger with no life loss when your graveyard has no creature to return (CR 603.3c)"_
- `convex/cards/sets/isd/__tests__/blue.test.ts:150`, `convex/cards/sets/mh3/__tests__/white.test.ts:240`, `convex/cards/sets/tla/__tests__/green.test.ts:134`, `convex/cards/sets/arn/__tests__/green.test.ts:270`, `convex/cards/sets/mh2/__tests__/red.test.ts:171`, `convex/cards/sets/leg/__tests__/multicolor.test.ts:1493`, `convex/cards/sets/ice/__tests__/colorless.test.ts:1582`
- `convex/gre/rules.ts:3619` — _"required target(s), none legal: remove from the stack"_
- `convex/gre/__tests__/protectionQuality.test.ts:687`, `convex/cards/sets/j25/green.ts:55`, `convex/cards/sets/m3c/red.ts:122`

A second, smaller sub-class cites `CR 603.3c` for a **delayed** trigger's inline
body, where the rule is `CR 603.7`: `src/lib/__tests__/stack-ability-oracle-text.test.ts:8`,
`src/components/board/trigger-order-prompt.tsx:355`.

Several sites already write the compound `CR 603.3c/603.3d`, which is defensible
and should be left alone — the miscited ones are those naming `603.3c` alone for
a target-legality outcome.

**Why this is invisible to the gate.** `bun run cr:lint` and
`scripts/__tests__/cr-citations.test.ts` only ask whether an id _resolves_; the
keyword cross-check is scoped to the `701`/`702` blocks. The test's own docstring
says so: _"What it does NOT prove: that a resolvable citation says what the
surrounding comment claims … The scan catches the ones that resolve to nothing;
the reviewer catches the ones that resolve to the wrong thing."_ This is that
class, at scale.

**Why it may not deserve its own issue.** It is comments and test names only — no
runtime behaviour is wrong, and no card is affected. The cost is future readers
being taught the wrong rule id, and a `/mtg-rules-check` pass anchoring on it.
Against that: a correct fix needs a per-site judgement call across ~136
occurrences (modal vs target-legality vs the compound form), which is a real
review pass, not a `sed`. It may be better as a line on a docs-hygiene tracker,
or deliberately declined.
