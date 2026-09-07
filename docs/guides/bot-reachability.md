# Bot reachability — can the Bot actually play what you just shipped?

Rule: `.claude/rules/gre-development.md` § Bot reachability analysis (resident).
This guide is the procedure and the failure gallery; it is read on demand and
costs nothing when it is not.

## Why this exists

A card can be correct three times over — the GRE resolves it per the CR, the
projection carries it, the client renders an affordance — and still never be
played, because the **Bot** cannot reach it. The bug shows up weeks later, in a
real game, as "the AI never uses that card" or "the AI got stuck".

It is not covered by the guards that look like they cover it:

| Guard                          | Censuses                                                             | Blind to                                                     |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `opValuerCoverage.bot.test.ts` | every implemented Op has an `OP_VALUERS` entry                       | whether the Bot can ever REACH the Op                        |
| `aiEffectsGuard.bot.test.ts`   | every `resolve()` card/ability has an `aiEffects` shadow             | the same — valuation, not reachability                       |
| receipt `blade` field (#2688)  | a PR whose `targetFiles` touch `BOT_GLOBS` declared a blade decision | a new card in `cards/sets/**`, which touches **no** bot path |

The last row is the whole point. The declaration gate fires on _"you edited the
Bot"_; the recurring defect is _"you shipped a mechanic and never thought about
the Bot"_. Inverted trigger, so it never fires when it matters most.

## The three seams

### 1. `enumerateMoves` — is the action REACHABLE?

`convex/gre/moves.ts`. If the enumerator does not build a Move for it, the Bot
cannot play the card at all, and for most shapes **no suite goes red**: there is
no catalogue-wide reachability census, only per-mechanic `*.bot.test.ts` files.

One narrow slice is now guarded. `COST_LEG_CLAIMS` (`convex/gre/costLegClaims.ts`,
issue #3007) is a total `Record<keyof ActivatedAbility["cost"], CostLegClaim>`
naming, per activation-cost leg, the enumerator branch or shared helper that
pays it, plus a one-line reason. Because it is total, **`tsc` reds the moment a
new cost leg is added to the type** — a new leg cannot land unadjudicated. A
runtime companion (`costLegClaims.bot.test.ts`) catches a claim naming a symbol
that has since moved, and `NEVER_AUTO_PAYABLE_COST_LEGS` is derived from the
table's `autoPayable` field rather than hand-maintained beside it.

**Be precise about what that buys you**, because the name flatters it. The table
is a completeness property over the TYPE: it proves a human adjudicated every
leg. It proves **nothing about board-state reachability** — that
`enumerateMoves` yields a legal, payable Move for that leg on a real position.
Two of the twenty-one rows are `hole`s for exactly that reason, both found by a
human reading the claim rather than by any check: `xFromTargetSpellMv` prices at
zero in the enumerator while the mutation charges 2x the targeted spell's mana
value (issue #3117), and the search-side cycling discard drops its
`cause: "cycling"` so cycling triggers never fire in the tree (issue #3118).

So the question to ask is unchanged: does this card add an activation or cost
shape the enumerator has not seen before? A new cost leg, a new activation zone,
a new timing restriction. If yes, it owes a `*.bot.test.ts` proving the Move is
enumerated ON A BOARD — the claim table will make you write a row, not a test.
Prior art: `activationCostsInSearch`, `castCostPicksInSearch`,
`grantedAbilityEnumeration`.

### 2. The choice surface — can the Bot ANSWER it?

`convex/gre/ai/choiceCandidates.ts` (`CHOICE_CANDIDATE_GENERATORS`) plus the
minimal-legal fallback in `src/lib/ai/brain.ts`.

Three outcomes, and only the third is a bug:

- **A candidate generator exists** → the choice is a real in-tree search
  decision. Best case.
- **No generator, but a minimal-legal fallback** → legal and live, never a
  search decision (ADR 0016). Acceptable, and worth a finding if the default is
  meaningfully wrong — that is how #2996 (the `order-top` family: the Bot never
  bottoms or bins) was filed.
- **Neither** → `decideBotAction` returns `{ kind: "unanswered" }`, the driver
  records it and escalates to the watchdog. Stop and open an issue.

Name the kind your card raises and say which of the three it is.

### 3. `OP_VALUERS` / `OP_BENEFICENCE` — does it know it WANTS to?

`convex/gre/ai/opValuers.ts`. Both sites are now guarded, in the BOT suite: a
missing **valuer** reds `opValuerCoverage.bot.test.ts`, and since issue #3006 a
missing **beneficence** sign reds `opBeneficenceCensus.bot.test.ts`. The reader
still falls back to `?? "neutral"`, but an implemented Op can no longer reach
it — which matters because a silent neutral is the Wild Growth shape: the Bot
hands a beneficial effect to its opponent because nothing told it the effect is
a gift.

What the guard cannot decide for you is WHICH answer is right. Three are
accepted and there is no fourth: a static `OP_BENEFICENCE` row, a `case` in
`opBeneficence` plus the name in `PARAMETRIZED_BENEFICENCE_OPS` when the sign is
a function of the Op's own fields (`pump`, `counters`, `addPlayerCounter`,
`tapUntap`, `scryReorder`), or a `"neutral"` row whose comment says why the Op
moves no stake — bind-only Ops (`mayPay`, `nameCard`) and self-directed ones
(`exileSelf`, `rangedTopdeck`) are the honest neutrals. There is no allowlist to
park one in. Note what the guard can and cannot do: it enforces that a reason is
PRESENT, never that it is a reason — `// deferred, see #N` would satisfy it, and
is precisely what a row must not say.

`/new-op` walks both sites (7 and 7b), and a green `bun run test:app` proves
nothing about either — run `bun run check:guards`.

## Checklist

1. New activation or cost shape? → `*.bot.test.ts` proving the Move enumerates
   **on a board**. A new `ActivatedAbility["cost"]` leg additionally reds `tsc`
   until it has a row in `COST_LEG_CLAIMS` (`convex/gre/costLegClaims.ts`) —
   that row is an adjudication, not a substitute for the test.
2. Raises a `PendingChoice`? → name the kind, say which of the three outcomes
   above applies.
3. Introduces an Op? → `/new-op`, and answer **site 7b** (`OP_BENEFICENCE`)
   as deliberately as site 7: a sign, a parametrized case, or a `"neutral"` row
   whose comment says why. Both censuses live in the bot suite.
4. A `resolve()` card? → it owes `aiEffects` (guarded — but the guard only
   checks the shadow EXISTS, not that it is faithful).
5. Declare the outcome in the PR, the way a preset scenario is declared.

## What to declare in the PR

One of two lines. Either a blade entry:

```
Blade: `must` entry "sentinel-explores-to-bin-a-dead-card" — bot bins the
revealed nonland it cannot cast.
```

or an explicit no-entry-owed, naming the seam that already covers it:

```
Blade: none — DSL card on already-exercised Ops (`createToken`), no new cost
shape, raises no new PendingChoice kind; valuation covered by
opValuerCoverage.bot.test.ts.
```

A blade entry is a deterministic scenario in `convex/gre/ai/blade/` with fixed
`iterations` (never `timeMs`). A _preference_ change owes a **discriminating
pair** — two positions whose right answers differ — not a single position that
a coin-flip would also pass.

## What this rule is NOT

- Not a demand for a blade entry per card. Most DSL cards on exercised Ops owe
  the one-line "none — …" and nothing else.
- Not a self-play run. Self-play is not how you debug a decision
  (`/bot-slice` § Verification doctrine); the ladder is for strength claims.
- Not a substitute for the existing censuses — it is the layer above them, for
  the reachability they structurally cannot see.
