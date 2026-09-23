# Coin-flip series: a counting Op, not a loop construct

Squee's Revenge (issue #3813) is the first card that repeats one action a
bounded number of times and stops early: "Choose a number. Flip a coin that
many times or until you lose a flip, whichever comes first. If you win all the
flips, draw two cards for each flip." (CR 705.1–705.2). The Effect Script's
structural constructs (`bind`, `ref`, `if`, `forEach`) are frozen by ADR 0045,
so the loop has to go somewhere. We decided that it lives **inside one Op named
for the mechanic** — `coinFlipSeries` — which performs the whole series and
**binds its results as numbers**. The payoff is written with the grammar that
already exists (`if` over a comparison, a value that reads the binding).

```jsonc
[
    {
        "op": "chooseNumber",
        "player": "controller",
        "prompt": "…",
        "bind": "$n",
    },
    {
        "op": "coinFlipSeries",
        "count": { "ref": "$n" },
        "untilLoss": true,
        "bindFlips": "$flips",
        "bindLosses": "$losses",
    },
    {
        "op": "if",
        "predicate": { "left": { "ref": "$losses" }, "op": "lt", "right": 1 },
        "then": [
            {
                "op": "draw",
                "player": "controller",
                "count": {
                    "scaled": { "value": { "ref": "$flips" }, "times": 2 },
                },
            },
        ],
    },
]
```

The Op draws each bit from the same seeded `SpellContext.flipCoin` that
`coinFlipSync` uses, with no reveal suspension. It stops after `count` flips,
or at the first lost flip when `untilLoss` is set. It is a leaf Op, not a
construct, so re-walking a suspended resolution skips it by position and it
never flips again. Each bound name receives a tagged numeric
binding (`numberBinding.ts`), which is the same channel `chooseNumber` and
`moveZone.bindCount` write. The three names (`bindFlips`, `bindWins`,
`bindLosses`) are separate fields, like `bindCount` / `bindAll`, because every
generic walker reads `bind` as a single name.

## Considered options

- **A fifth structural construct `repeat { times, until, effects }`
  (rejected).** ADR 0045 bars exactly this: "no arbitrary loops … the pressure
  valve is a new Op, never a new construct". A general loop with an early-exit
  predicate over mutable state is the Forge failure mode that ADR exists to
  prevent, and neither the validator nor the Bot's valuers could read its
  termination statically.
- **The same Op with a nested `effects` body run once per flip (rejected).**
  No printed card applies its payoff per flip as the flip happens. Every
  corpus form ("if you win all the flips", "for each flip you won", "for each
  flip you lose") reads the results after the series ends, so a per-flip body
  is looping machinery with no consumer. Binding the counts keeps the Op a
  leaf, which the Bot values with a closed-form expectation instead of a
  subtree.
- **A `coinFlipSeries` that binds counts (chosen).** It covers the whole
  counted-series class in the corpus with one shape: Crazed Firecat and the
  "flip a coin until you lose a flip … for each flip you won" triggers (no
  `count`, `untilLoss`), "Flip X coins / three coins … for each flip you win"
  (a `count`, no `untilLoss`), and Yusri (`bindWins` and `bindLosses`).

## Consequences

- **The value grammar widens by one operand.** `EffectScaledOperand` admits a
  bare numeric-binding ref (`{ ref }`), because "two cards for each flip" is
  `2 × $flips`. It is still a terminal, so the depth-1 discipline of
  `scaled` / `difference` (issue #2366) is unchanged.
- **Deferred, each on its own axis:**
    - Fiery Gambit's "or choose to stop flipping" is a player decision between
      flips, which means a suspension per flip.
    - "Comes up heads" (Ral Zarek) is a flip with no call, and no one wins or
      loses it (CR 705.2).
    - Mana Clash has two players flipping at the same time.
    - A per-flip reveal overlay (the ADR 0023 UX `coinFlip` has) is not built;
      the series resolves inline like `coinFlipSync`.

    Each waits for its card to show the shape.

- The Oracle compiler emits the Op (ADR 0137): a "Choose a number." marker, the
  series sentence and its payoff sentence fold into one effect, the same way
  a library look folds with its routing.
