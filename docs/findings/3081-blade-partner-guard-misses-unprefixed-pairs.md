---
title: The blade partner-naming guard only sees labels prefixed "discriminating pair:", so most real pairs are unguarded
discoveredBy: 3081
status: draft
confidence: medium
---

**What is wrong.** `blade.spec.ts`'s "every discriminating-pair entry names its
partner (issue #1487)" test selects its population with

```ts
BLADE_SCENARIOS.filter((s) => s.label.startsWith("discriminating pair:"));
```

Every pair whose label reads naturally instead — the issue #3027 burst-mana pair
(`"burst mana: …"`), the issue #3081 self-tap pair (`"self-tap source: …"`) —
is invisible to it. The guard exists to make deleting one half of a pair obvious
in the diff; on an unprefixed pair, deleting a half goes through green.

**Evidence.** `convex/gre/ai/blade/__tests__/blade.spec.ts:157-175`. Both pairs
named above DO quote each other in their `note`, so the convention is being
followed by hand — the guard simply does not check it.

**Why it may not deserve its own issue.** The fix is a field, not an
investigation: give `BladeScenario` an explicit `pairedWith?: string` (or a
`pair: string` group key) and have the guard assert on that instead of parsing
the label, so a pair declares itself rather than being recognised by a prefix
nobody enforces. Could be a line on the blade tracker rather than a ticket.
