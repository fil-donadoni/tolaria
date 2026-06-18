# ADR 0023 — Random Reveal: pause resolution to animate the outcome before applying it

**Status:** Accepted (2026-06-18)

## Context

Three ARN cards flip a coin (CR 705.2): **Bottle of Suleiman** (activated
ability), **Mijae Djinn** (attack trigger), **Ydwen Efreet** (block
trigger). Today `flipCoin()` (`convex/gre/state.ts`) consumes one bit from
the seeded PRNG (`rngSeed`/`rngCounter`, ADR-style deterministic replay) and
the resolving step applies the consequence **atomically in the same
transaction**. The player never sees the flip — the Djinn simply appears, or
the damage simply lands. No animation, no result reveal, no UI.

We want the player to **watch the coin spin, land on a clear WIN/LOSE face,
and read the consequence, before that consequence is applied to the board.**
This must hold for both clients in a 2-player game (a coin flip is public —
CR 705) and must not break determinism or replay.

Two facts constrain the design:

1. **The result is decided server-side, deterministically.** The animation
   is cosmetic — it lands on the bit the engine already drew. "Before
   applying" is therefore an *ordering* problem (reveal, then apply), not a
   "where does the result come from" problem.

2. **A suspended resolution step is replayed from the start on resume.** The
   `requestChoice`/`collectedChoices` mechanism re-invokes the resolve step
   when the player answers; stored answers short-circuit the re-run
   (`convex/gre/state.ts`, `convex/gre/pendingChoiceSubmit.ts`). A naive
   `if (ctx.flipCoin()) …` placed before a pause would **re-roll on resume**,
   advancing `rngCounter` and producing a different result than the one
   animated. The drawn bit must be generated **once** and persisted, then
   read back on replay — exactly as a player answer is.

Coin flips are also not the only forthcoming random reveal. Future cards roll
dice (planar die, d6, d20). The resume/acknowledge path is identical for a
die: generate an outcome, suspend, animate, acknowledge, apply. Only the
*widget* and the *number of sides* differ.

## Decision

**Introduce a `random-reveal` Pending Choice: the engine draws the outcome,
persists it, and suspends the resolving step before the consequence is
applied. Both clients animate the stored outcome; the chooser's client
auto-acknowledges when the animation ends; the engine then resumes and
applies the effect.**

### Engine

- A new **SpellContext primitive `requestCoinFlip`** modelled on
  `requestChoice`'s suspend pattern:
  - **First call:** draw the bit via the existing `flipCoin()` **exactly
    once**, build a `random-reveal` Pending Choice carrying the realized
    outcome, enqueue it, return `undefined` → the step suspends before
    applying.
  - **Resume:** the stored outcome short-circuits the re-run (returns the
    boolean, no re-roll), the step continues to the consequence.
- `requestCoinFlip` is a thin wrapper over a **generic `random-reveal`
  envelope** (`randomKind`, `sides`, `result` index, realized
  `{ face?, consequence }`). A future `requestDieRoll` reuses the same
  envelope, the same Pending Choice kind, and the same acknowledge mutation —
  no new resume machinery.
- Card-supplied outcome descriptors. Faces **default to `WIN` / `LOSE`**;
  `face` is overridable only for non-win/lose flips (e.g. a future Puppet's
  Verdict-style HEADS/TAILS with asymmetric effects):

  ```ts
  const won = ctx.requestCoinFlip({
    playerId: ctx.controller,
    choiceId: "bottle-flip",
    heads: { consequence: "Create a 5/5 Djinn" },                       // face → WIN
    tails: { consequence: "Bottle of Suleiman deals 5 damage to you" }, // face → LOSE
  });
  if (won === undefined) return;            // suspended after the flip, before applying
  if (won) ctx.createDjinn(); else ctx.dealDamage(ctx.controller, 5);
  ```

### Resume

- A new **generic `submitRandomRevealAck(stackItemId, choiceId)` mutation**:
  carries **no choice data** — only "the animation finished, resume". The
  same mutation serves coins and dice.
- The **chooser's client auto-fires** the ack when the animation completes
  (after a client-side `FLIP_ANIM_MS`); there is no button (a coin flip has
  no decision — ADR 0003, auto-resolve trivial choices). Animation duration
  lives **client-side**, not in the engine.
- The **opponent's client** renders the same animation off the same stored
  outcome but does **not** submit (`isChooser` gate, already present). Resume
  is replay-safe regardless of who acks; the gate also avoids a double-submit.

### Wire / UI

- The `random-reveal` Pending Choice and its outcome fields survive
  `projectPublicState` / `FullGameState` so both clients can render. The
  result is public (CR 705) — no information-leak concern.
- `RandomRevealOverlay` routes on `randomKind`: `CoinFlipAnimation` built now,
  `DieRollAnimation` deferred. Center-screen overlay, dimmed board,
  viewer-relative label ("You win the flip" / "{Name} wins the flip"), the
  realized `consequence` shown as a preview line, `motion/react` spin.
  `prefers-reduced-motion`: the landed face is shown statically for the same
  duration, then auto-ack.

### Scope

- Coin is built **end-to-end now** (the 3 ARN cards). The **generic envelope,
  ack mutation, and `random-reveal` kind ship now** (cheap, and they are the
  shared substrate). The **die primitive and `DieRollAnimation` are deferred**
  until a die card exists — added by reusing the envelope, no engine rework.

## Consequences

- **Reveal precedes application.** The consequence is a separate resolve
  segment gated behind the ack; the board never shows the Djinn / the damage
  until the coin has landed.
- **Determinism preserved.** `flipCoin()` runs once; the outcome is persisted
  on the Pending Choice (in `pendingChoices`, already in
  `PERSISTED_OPTIONAL_KEYS`) and read back on replay. Loading a saved game
  mid-reveal does not re-roll.
- **One resume path for all randomness.** Coins and future dice share
  `random-reveal` + `submitRandomRevealAck`. Adding a die is a new primitive
  wrapper + a new animation component, nothing else.
- **Animation timing is a client concern.** The engine carries no wall-clock;
  the chooser's client owns `FLIP_ANIM_MS`. Tunable without touching the GRE.
- **Disconnect during a reveal hangs the flip** exactly like any other
  Pending Choice today (the chooser must ack). The flip always occurs during
  the chooser's own activation/combat trigger, so the chooser is present;
  risk is no worse than the status quo.
- **A new primitive on SpellContext.** Justified per the primitive-reuse rule:
  it is an orthogonal "suspend with an engine-generated, persisted random
  outcome" interaction. It cannot be composed from `requestChoice` (which
  persists a *player* answer, not an engine draw) or from `flipCoin` (which
  neither suspends nor persists across the resume boundary).

## Alternatives

- **Atomic + client replay** (keep flip+apply in one transaction; emit the
  result; client animates an overlay, then reveals the already-applied
  consequence). Rejected: the consequence is already in the projected state,
  so "reveal then apply" becomes "hide then un-hide" — the client must
  suppress board state it already received, which is fragile and card-specific.
- **Server-scheduled resume** (`ctx.scheduler.runAfter(FLIP_ANIM_MS)`).
  Rejected: no such scheduler exists in the GRE today, and it hard-codes
  animation duration server-side and couples the engine to wall-clock.
- **Synthetic two-step stack item** (a reveal item, then a consequence item).
  Rejected: bloats the stack with engine-internal items that players could
  mistake for responses windows, and complicates trigger/priority bookkeeping.
- **Coin-specific kind + `submitCoinFlipAck`.** Rejected: the resume path is
  identical for dice; a coin-only kind would be re-derived the moment a die
  card lands (ADR principle: generalize the shared envelope, specialize the
  widget).
