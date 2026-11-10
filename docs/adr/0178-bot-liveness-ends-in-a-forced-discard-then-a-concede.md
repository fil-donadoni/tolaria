# Bot liveness ends in a forced discard, then a concede — never in a waiting game

## Status

accepted (2026-11-09, issue #9002; owner ruling of 2026-11-09 recorded in PRD
issue #8998). Amends the issue #2283 / issue #2284 liveness design, which has
no ADR of its own: its rule "a way out is always the LEGAL decline the CR
defines" now holds for every rung except the terminal one.

## Context

The issue #2284 escalation ladder (`src/lib/ai/owed-input.ts`) answers a
window the Bot owes with legal rungs only — the minimal-legal answer, the
engine's own decline, a pass — and when they run out, rung 5 shows a notice
and waits for the human. That wait is a freeze by design. Two reported freezes
(PRD issue #8998) also showed the ladder lives only in the browser tab: a dead
driver leaves the game waiting forever.

## Decision

- **The last line of defence is a pure engine function**,
  `forceAdvanceOwedInput(state, botPlayerId)` (`convex/gre/forceAdvance.ts`).
  It is exhaustive over `ExpectedInputKind` and never throws. A server-side
  caller with no `ctx.auth` can run it.
- **Per window it tries, in order:**
    1. **the legal rung** (`forceAdvanceLegal.ts`): pass priority (a pre-game
       declaration keeps), declare no blockers, decline the attack mana tax,
       cancel the target, give the most conservative legal choice answer, or
       sacrifice the first legal land. Each one runs the auth-free core the
       public mutation runs. A core that changes nothing counts as a failure.
    2. **the forced discard** (`forceAdvanceDiscard.ts`), when the legal rung
       throws, changes nothing, or leaves the Bot owed on the SAME container.
       It removes the owed container (the pending choice, the pending target,
       the block declaration, the attack cost, or a half-paid announcement or
       open attack declaration in a priority window). It also takes the stack
       item whose resolution raised it off the stack, as if it had fizzled.
       **This is an explicit CR deviation.** It ignores attack and block
       requirements (CR 508.1d / 509.1c), a mandatory choice's answer, and an
       unpaid cost to attack.
    3. **the Bot concedes** (CR 104.3a, `gameOver.reason: "bot-fault"`) when
       nothing is left to discard (a discard throws), or the post-state fails
       the `compactState` round-trip. The concede starts from the INPUT state,
       so a state that cannot be saved is never the one saved.
    - **A discard never strands a companion container.** A choice raised by no
      stack item (the mulligan bottoming, a held trigger batch, an entry staged
      on an as-enters choice) shares a sentinel id and is closed only by its own
      continuation: it is not discardable, and the Bot concedes. A discarded
      target runs the continuation the legal decline runs (the next trigger of
      the batch, the retarget offer).
- **The deviation is acceptable only because it is reported.** The step log
  marks every rung `legal` / `discarded`. The PRD issue #8998 system report
  files each discard and each concede as a P0 bug. A discard is never a
  substitute for a missing legal rung: when a window's discard fires on
  healthy states, the fix is a legal rung for it.
- **Containers, not windows.** "Same container" is the owed window's
  identity: a choice's `stackItemId:choiceId`, a target's kind and object, a
  combat declaration's turn, or a priority window's step, stack and parked
  announcements. The function stops as soon as the Bot owes a DIFFERENT
  container. The next window belongs to the driver again, so one call never
  plays the Bot's turn for it.

## Consequences

- A priority window with nothing parked has no discard. A Bot that cannot
  pass there (a combat-damage assignment) concedes. That window needs an
  auth-free `confirmDamage` core to get a legal rung.
- `selectSacrificeOnState`, `findActiveSacrificeSelection` and
  `finalizeConfirmAttackers` moved from `convex/game.ts` to GRE level
  (`gre/sacrificePick.ts`, `gre/attackDeclaration.ts`). `game.ts` re-exports
  them.
- The client ladder's rung 5 no longer waits for the human (issue #9003).
  It calls `botLiveness.reportStall` with the driver's diagnostics. The
  server checks the caller is the human of that vs-AI game, the `seq` is
  current and the Bot is owed. It then runs this function, saves the result
  and files a `client-handoff` system report. The board shows a short notice
  instead of a button.
- `GameOver.reason` gains `"bot-fault"`. The self-play harness counts it as a
  freeze (`scripts/lib/tier1-smoke.ts`), never as a result.
