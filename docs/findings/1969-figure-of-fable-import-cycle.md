---
title: Figure of Fable's protection grant is undefined under a different module-evaluation order (import cycle through gre/constants → cards)
discoveredBy: 1969
status: draft
confidence: high
---

**What is wrong.** `convex/cards/sets/ecl/multicolor.ts` reads a runtime constant
out of `convex/gre/protection.ts` at MODULE-EVALUATION time, and the two sit in
an import cycle. Whether the constant is defined by the time the card literal is
built depends purely on which module the bundler happens to start from. When it
resolves the wrong way, the shipped card definition silently loses a field —
`{ op: "grantAbility", target: { ref: "$source" } }` with **no `ability`** — and
Figure of Fable's final stage grants nothing at all.

**Evidence.**

- `convex/cards/sets/ecl/multicolor.ts:8` — `import { PROTECTION_FROM_EACH_OPPONENT } from "../../../gre/protection"`, used at `:271` inside the card's object literal (evaluated at import time, not lazily).
- The cycle: `cards/sets/ecl/multicolor` → `gre/protection` (`:83` `import { STATIC_EFFECT_CTX } from "./layers"`) → `gre/layers` → `gre/constants` (`:22` `import { getDefinition, tryGetDefinition } from "../cards"`) → the card registry → every set module → back to `cards/sets/ecl/multicolor`.
- Reproduced on a CLEAN checkout of `98a98a43` (no diff applied), with a two-line probe test that imports `gre/protection` before `cards/sets/ecl/multicolor`:

    ```
    CONST: "protection from each of your opponents"
    OPS:   [ …, {"op":"grantAbility","target":{"ref":"$source"}} ]   // no `ability`
    ```

- The catalogue sweep `convex/cards/__tests__/effectScripts.test.ts` DOES catch it (`Op "grantAbility" field "ability" has invalid value undefined`) — but only because that file's own import order happens to be the safe one. Adding an unrelated runtime import edge is enough to flip it: in this PR, a single `import { readPlayerCounters } from "../constants"` inside `convex/gre/effects/scenarioGenerator.ts` turned the sweep red, on a card the diff never touched. The fix taken here was to route the new helper through a dependency-free leaf (`convex/gre/playerCounters.ts`) so it adds no runtime edge — which sidesteps the cycle rather than removing it.
- This matches the recorded bug class "check:all misses duplicate imports — only vite's Babel catches it": the local gate does not model the Convex bundler's entry order, so the order that ships is not the order the gate proves.

**Why it may not deserve its own issue.** Today exactly one card reads a runtime
constant out of a cycle-participating engine module, the sweep does currently
catch the bad order, and the trivially local fix (inline the string literal in
`ecl/multicolor.ts`, or move `PROTECTION_FROM_EACH_OPPONENT` into a
dependency-free leaf beside `cards/snowReads.ts`) is a two-line change someone
could fold into any nearby PR. Against that: the failure mode is a SILENT
capability loss in a shipped card, the gate's ability to catch it is incidental
rather than designed, and nothing stops the next helper from re-arming it — a
`grep` for other card modules importing runtime values from `convex/gre/**`
would size whether this is one card or a class.
