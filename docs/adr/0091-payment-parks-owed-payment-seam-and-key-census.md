# Payment parks: one owed-payment seam, guarded by a census over the state's own keys

## Status

proposed

## Context

A **payment park** (see `CONTEXT.md`) is a cost-payment decision suspended
inside the announcement window of a cast or an activated ability (CR 601.2 /
602.2): which permanent to sacrifice, which card to discard or exile, which
creatures to tap. The announcement is recorded on `pendingCast` /
`pendingActivation` and its commit is blocked until the payer submits the pick —
mana coverage alone is never enough. A park is NOT a `PendingChoice`: it happens
before the object is on the stack, it lives outside `pendingChoices[]`, and no
candidate generator (`gre/ai/choiceCandidates.ts`) can see it.

The authoritative list of parks is the chain of early returns in the two commit
gates, `tryAutoCommitPendingCast` and `tryAutoCommitPendingActivation`
(`convex/game.ts`). At the time of writing there are ten, seven of them with no
live-bot coverage at all:

| Container           | Park                        | Human mutation                  | Live bot |
| ------------------- | --------------------------- | ------------------------------- | -------- |
| `pendingActivation` | `sacrificeSelection`        | `selectActivationCost`          | —        |
| `pendingActivation` | `exileFromGraveyardChoice`  | `selectActivationExileCost`     | —        |
| `pendingActivation` | `tapOtherChoice`            | `selectActivationCost`          | —        |
| `pendingActivation` | `discardFilterChoice`       | `selectActivationDiscardCost`   | —        |
| `pendingCast`       | `sacrificeSelection`        | `selectSacrifice`               | —        |
| `pendingCast`       | `additionalCost`            | `selectAdditionalCost`          | —        |
| `pendingCast`       | `alternativeCostHandChoice` | `selectCastAlternativeHandCost` | —        |
| `pendingCast`       | `convokeCreatureChoice`     | `selectConvokeCreatures`        | #1338    |
| `pendingCast`       | `exileFromGraveyardChoice`  | `selectCastExileCost`           | #1336    |
| both                | `manaSpendChoice`           | `resolveManaSpendChoice`        | #1446    |

The live vs-AI bot covers three of ten. The move enumerator does not skip the
other seven — it emits the cast/activation whenever the cost is payable
(`moves.ts:947-1009`) and `applyMoveForSearch` pays it atomically
(`applyMove.ts:403-508`), so the search returns the move honestly. The executor
then announces it and stops: nothing submits the pick, the commit gate never
clears, and the bot hangs on a move it generated itself. Roughly 71 shipped
cards are affected, and #2088 (Saddle, CR 702.171 — the crew shape of
`tapOtherChoice`) would add more the day it lands.

This class has been fixed nine times, one park at a time: #161, #163, #164,
#1336, #1338, #1446, #1506, #1507, #1659. Issue #1209 filed the tenth, and its
first remediation item — "make the driver's dispatch compile-time exhaustive" —
was delivered by #1506 as an `assertNever` over `BotAction["kind"]`
(`src/lib/ai/brain.ts:425`). It did not help, and could not have: exhaustiveness
guards the **classification** of union members that already exist, while every
instance of this bug is a member that was never added. The guard was landed on
the wrong axis and the issue stayed open underneath it for three weeks.

## Decision

**1. One seam.** `nextOwedPayment(state, playerId)` returns the first unsatisfied
park in canonical gate order, or null. The two commit gates do not gain a call
to it — they _become_ it (`if (nextOwedPayment(...)) return null`). Order is
load-bearing and preserved: convoke before delve (the convoke pick is what
builds the delve picker, `game.ts:3076`), `manaSpendChoice` last (evaluated only
once mana coverage is reached).

**2. The guard is a census over the state's keys, not a switch over a union.**
`PARK_KEYS` / `NON_PARK_KEYS` partition `keyof PendingCast` and
`keyof PendingActivation` exhaustively, with a guard test that fails when a key
is in neither — the `PERSISTED_OPTIONAL_KEYS` / `TRANSIENT_KEYS` shape from
`serialize.ts`, adopted deliberately for the same reason (silent field loss) and
so a reader who has met one has met both. A new park field cannot compile
without being classified; classifying it as a park forces a bot branch.

**3. The bot answers a park with the same function the search used to pay it.**
The conservative picks currently inlined in `applyMove.ts` move to
`gre/paymentPicks.ts`, beside the already-extracted `pickTapOtherPayment`
(`gre/tapOtherCost.ts:91`), and both the search and the live bot call them. Live
and search agree by construction rather than by parallel maintenance.

**4. The payment travels on the Move, never as a search node.** Search branching
over payments is expressed as _variants of the same cast/activate move_ carrying
their picks — the shape `tapPlan`, `chosenX`, `chosenModeId`, `targets` and the
delve payment already use. K is per park kind: 1 where the pick is fungible
(`sacrificeFilter`'s lowest-mana-value victim, crew, Night Soil), 3 for
`discardFilter`, where the pick _is_ the card (Survival of the Fittest).

**5. The live bot submits through the human mutations, one pick per call**, even
where that costs N writes (only crew reaches 2-3; 68 of 71 cards need one).

**6. A realisation is atomic, and a stale payload falls back.** `inFlight` covers
the whole `executeMove` sequence, so the reactive gate cannot interleave a second
decision into a half-built announcement. Any park the carried payload did not
anticipate — Drought entering between search and execution, an opponent response
invalidating a pick — is answered reactively by the same exhaustive switch,
conservatively, rather than hung on.

## Consequences

- The commit gates stop being a hand-maintained chain that three other places
  mirror. `nextOwedPayment` is the single authority; the bot cannot drift from it
  without failing to compile.
- Adding a park costs one classification and one pick function. Adding one and
  forgetting the bot is no longer possible.
- `inFlight` covering the executor closes a latent race that predates this work:
  every mutation in a multi-step realisation bumps the state seq and re-fires the
  driver's effect, and today that only works because the decision that interleaves
  happens to be the right one. Two parks in one sequence (crew + mana spend) had
  no defined ordering.
- After the anti-stall slice the bot is honest and unstuck but not strong on the
  three `discardFilter` cards: it discards the first eligible creature. That is a
  tuning parameter (K), not an unimplemented rule — the intermediate state ships
  no half-built mechanic.
- #2081 (the enumerator never pays an **optional** additional cost) inherits this
  seam for its own acceptance criterion "the bot driver handles the new move shape
  without stalling", and extends the per-kind K table rather than inventing a
  second mechanism. Its HITL decision — the bound on enumerated variants — stays
  its own.

## Alternatives considered

**A park as a search node (`applyMoveForSearch` parks instead of paying).**
Rejected. It adds a ply per payment to model a decision with no adversarial
interleaving: the park lives inside the announcement window, where the opponent
never acts. Worst possible ratio of tree depth to information, and it would make
parks the only choice-like thing that exists in search states but not in the
shape the rest of the cast pipeline uses.

**A bot-side mirror of the park list.** Rejected: a fourth copy of the list whose
divergence is precisely the bug.

**Payment carried in the `activateAbility` / `announceCast` arguments** (one
write instead of N). Rejected for now: it opens a second entry point into cost
legality, the shape that has already produced divergence across the ~9 client and
server consumers of cost-payment rules. Batching stays available later — the
`*OnState` functions the mutations delegate to are already extracted (#1779).

**A better live heuristic than the search's.** Rejected outright: if the executed
payment differs from the simulated one, the evaluation that selected the move is
a lie. A worse pick that matches beats a better pick that diverges.
