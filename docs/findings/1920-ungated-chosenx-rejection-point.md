---
title: The bot enumerates X-cost activated abilities it cannot announce — chosenX is never chosen, and the mutation throws
discoveredBy: 1920
status: draft
confidence: high
---

**What is wrong.** `activateAbilityOnState` rejects an activation whose ability
has a string `X` in its mana cost when no `chosenX` rides on the request
(`convex/game.ts`, `This ability requires a chosen X value`). `enumerateAbilityMoves`
has no gate for it and never picks a value, so the bot emits
`activate-ability` moves with `chosenX: undefined` for every such ability, and
`src/lib/ai/executor.ts` sends them to a mutation that throws.

The mechanism is that `normalizeManaCost` folds a string `X` to 0, so the
ability reads as free to the enumerator's mana planner: `planManaPayment`
returns a tap plan and the move is emitted.

**Evidence.** Verified independently on `fix/issue-1920`: Aladdin's Lamp
(`convex/cards/sets/arn/colorless.ts`, `cost: { mana: { X: "X" }, tap: true }`)
with five Islands, turn 5 `PRECOMBAT_MAIN` — `enumerateMoves` returns one
activation whose `chosenX` is `undefined`, and `activateAbilityOnState` on that
same move throws `This ability requires a chosen X value`.

Five shipped cards reach it: **Aladdin's Lamp**, **Illusionary Mask**,
**Candelabra of Tawnos**, **Runed Arch**, **Metathran Aerostat**.

This is row 12 of the rejection-point table in PR #2454, the one row that ends
in neither "gated" nor an unreachability reason. It is **identical on `main`**
and untouched by #1920: the PR's reviewer measured the root choosing `pass`
18/18 across its fixtures, so unlike the `removeCounter` / `discardAtRandom`
rows there is no preference flip — the illegal move is offered but not
preferred. That is why it was left open rather than fixed in that PR.

**Why it may not deserve its own issue.** The fix is not a gate, which is what
makes it different in kind from the four legs #1920 closed: skipping these
abilities would make the bot permanently blind to every X-cost activation
(Candelabra untapping N lands is a real play), so the correct fix is to _choose_
an X — enumerate a small set of affordable values the way `cast-spell` already
does for X spells, which is a feature with its own valuation question (how many
X variants are worth branching on). A pure gate would be a one-line stopgap that
trades a thrown mutation for a permanent capability gap, and might be worth
doing first if bot-vs-human games are hitting the throw in practice.

Against ticketing it: nothing currently prefers these moves, so the observable
damage is bounded by whether the executor's failed mutation is handled
gracefully — worth checking before sizing this, because if it is, the whole
thing is latent rather than live. The counter-argument: "the bot proposes moves
the server rejects" is upstream of the standing rule that the bot never freezes
a game, and this is the last known instance of it in the activation path.
