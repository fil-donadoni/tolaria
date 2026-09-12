---
title: "{ opponentOf } in a valued player position grounds as SELF — the bot reads an opponent-side draw as its own card advantage"
discoveredBy: 2709
status: draft
confidence: high
---

**What is wrong.** Both grounding contexts answer `isSelf` for an
`{ opponentOf: … }` player ref by falling through to their self default, so
every `OP_VALUERS` valuer that signs on `ctx.isSelf` (`draw`, `gainLife`,
`loseLife`, …) prices an explicitly opponent-side effect as if it landed on the
bot itself.

- `contextFreeGrounding` (`convex/gre/ai/grounding.ts:230`) tests
  `"ref" in ref` and then returns `cfAssumption === "self"`. `{ opponentOf }`
  has neither key, so it takes the `cfAssumption` branch — `"self"` for `draw`.
- `contextAwareGroundingForChoice` (`convex/gre/ai/candidateValue.ts:778`)
  handles only the two string refs and returns `true` for everything else.

Neither is a lookup failure that degrades to neutral: it degrades to a
confident WRONG SIGN.

**Evidence.** Standstill's trigger script, valued through the shipped path:

```
$ bun scratchpad/probe2.ts
opponentOf($event.caster) — as shipped {"points":74.08810399999999,"tags":["boardRemoval","self-cost","cardAdvantage"]}
controller                             {"points":74.08810399999999,"tags":["boardRemoval","self-cost","cardAdvantage"]}
opponent                               {"points":-154.088104,"tags":["boardRemoval","self-cost","cardAdvantage"]}
```

The shipped ref values BYTE-IDENTICALLY to `"controller"`, 228 points away from
`"opponent"`. `dslAbilityScriptOpValue(standstill)` returns the same `+74.09`
with a `cardAdvantage` tag — the bot rates Standstill as a discounted
"draw three cards", which is the opposite of what the card does to whoever cast
into it.

Standstill (issue #2709) is the first shipped card to put `{ opponentOf }` in a
VALUED player position, which is why nothing caught this earlier: the only other
catalogue use (`convex/cards/sets/c17/multicolor.ts:54`) is a `gainControl`
`controller:` field, which no valuer signs on.

**Why it is not a one-line sign flip.** Complementing the inner ref is right for
`{ opponentOf: "controller" }` and for a bound `{ ref }`, but Standstill's inner
ref is `$event.caster` — the caster of a spell that has not been cast yet.
Context-free, the honest answer is that the recipient is UNKNOWN (either seat),
so neither `+74` nor `−154` is correct, and the fix has to decide whether an
unresolvable `opponentOf` should complement the assumption or drop the term to
neutral. That is a design call in `convex/gre/ai/**`, under `/bot-slice`
discipline with its own `must` blade entry — not something to smuggle into a
card slice.

**Scope check.** Defensible without the card that surfaced it: the defect is in
the grounding contract, and every future `{ opponentOf }` valuer consumer
inherits it.
