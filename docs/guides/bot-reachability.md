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
cannot play the card at all, and **no suite goes red**: there is no
catalogue-wide census here, only per-mechanic `*.bot.test.ts` files.

Ask: does this card add an activation or cost shape the enumerator has not seen
before? A new cost leg, a new activation zone, a new timing restriction. If yes,
it owes a `*.bot.test.ts` proving the Move is enumerated — nothing else catches
it. Prior art: `activationCostsInSearch`, `castCostPicksInSearch`,
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

`convex/gre/ai/opValuers.ts`. A missing **valuer** reds
`opValuerCoverage.bot.test.ts`. A missing **beneficence** sign does not red
anything — it reads `?? "neutral"`, and the Bot loses the who-does-this-help
axis. That is the Wild Growth shape: the Bot hands a beneficial effect to its
opponent because it cannot tell the effect is a gift.

`/new-op` walks both sites (7 and 7b). Site 7b has no guard, so it is the one
to check by hand.

## Checklist

1. New activation or cost shape? → `*.bot.test.ts` proving the Move enumerates.
2. Raises a `PendingChoice`? → name the kind, say which of the three outcomes
   above applies.
3. Introduces an Op? → `/new-op`, and confirm **site 7b** (`OP_BENEFICENCE`),
   not just the guarded site 7.
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
