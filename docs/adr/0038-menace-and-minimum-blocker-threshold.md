# Menace via a generic minimum-blocker threshold

## Status

accepted

## Context

Goblin War Drums (FEM) reads "Creatures you control have **menace**" — and
menace (CR 702.111a) means "a creature with menace can't be blocked except by
two or more creatures." It is the first evasion keyword in the engine that does
not _forbid_ a blocker outright but instead imposes a **minimum** on the number
of creatures that must block the attacker together.

The existing blocker-eligibility pipeline (`validateBlockerEligibility` in
`convex/gre/combat.ts`) is **pairwise**: it answers "may THIS blocker block THAT
attacker?" one assignment at a time, at the `assignBlockerTarget` mutation. That
shape fits flying, landwalk, fear, protection, and card-level block restrictions
(all of which judge a single blocker against a single attacker). It cannot
express a minimum, because a menace attacker blocked by exactly one creature is a
perfectly legal _intermediate_ state while the defender is still assigning the
second blocker — the violation only exists once the defender declares the block
set complete. Forcing the check into the pairwise gate would either reject the
legal first blocker or never reject the illegal lone blocker.

Menace is also a **combat-engine change** (it adds a new validity rule at
DECLARE_BLOCKERS that both the human mutation path and the bot move enumerator
must honour identically), and it is the first of a family — future cards read
"can't be blocked except by **three or more** creatures." A menace-specific hack
would have to be rewritten for the next variant.

## Decision

Enforce menace as a **generic minimum-blocker threshold**, evaluated against the
**complete** declared block set at confirm time (CR 509.1b/c), not pairwise at
assignment time.

Two small pure functions live in `convex/gre/combat.ts`:

- **`getMinimumBlockers(attacker)`** — returns the per-attacker minimum number
  of blockers. It reads the attacker instance's effective `staticAbilities` and
  returns `2` for menace, else `1` (no constraint). A future "three or more"
  keyword raises the number here and nothing else changes. Granted keywords are
  already spliced into `staticAbilities` imperatively when the granting source
  resolves (`applySourceStaticEffects`), so anthems like Goblin War Drums and
  until-end-of-turn grants are observed automatically — and because the keyword
  lives on the instance array, it **survives the GameState → PublicGameState
  projection** unchanged.

- **`validateMinimumBlockers(state)`** — counts the distinct blockers assigned to
  each attacker from `combat.blockerAssignments` and returns the first violation
  (`blockedBy > 0 && blockedBy < getMinimumBlockers(attacker)`). An unblocked
  attacker (`blockedBy === 0`) is always legal.

It is called at exactly the two sites that finalise a block declaration:

1. **`confirmBlockers`** (`convex/game.ts`) — after must-block auto-assignment
   (Lure) is merged into the assignment map, so forced blocks count toward the
   minimum. A violation throws and rejects the declaration.
2. **`enumerateBlockerMoves`** (`convex/gre/moves.ts`) — the bot's candidate
   block combinations are filtered to drop any combo that blocks a menace
   attacker with too few creatures, mirroring the existing Caverns-of-Despair cap
   filter. The server stays the sole authority; this only keeps the bot from
   proposing a move the server would reject.

Goblin War Drums grants the keyword with an anthem-style `keyword-grant`
`staticEffect` (the Kobold-lord pattern): `applies` matches every creature its
controller controls, pushing `"menace"` into their `staticAbilities`; the grant
reverses when the enchantment leaves play.

## Consequences

- Menace is grantable, anthem-able, and granular-keyword-able for free — any code
  path that reads `staticAbilities.includes("menace")` (or
  `getStaticAbilities`) sees it, including the projected client state.
- The "except by N or more" family is now a single number, not N hacks.
- The check is confirm-time, matching CR 509.1c — partial assignments during the
  defender's declaration are never spuriously rejected.
- Limitation (acceptable for current scope): menace is enforced as a minimum
  COUNT of blockers; it does not interact with hypothetical "a single creature
  that counts as two blockers" effects (none exist in the pool). If such a card
  ever ships, `getMinimumBlockers` / the counting in `validateMinimumBlockers`
  are the single place to extend.
