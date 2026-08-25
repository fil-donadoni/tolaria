/** Card state rings (ADR 0103 §8, issue #2724).
 *
 *  Every ring drawn on a card surface — battlefield, hand, piles, zone-picker
 *  dialogs, deck tiles — resolves to ONE of the roles below and is painted by
 *  the `.card-ring*` recipes in `src/index.css` as an INSET pseudo-element:
 *  zero layout impact, clipped to the card's own printed corner, and out of
 *  the `--tw-ring-color` competition the battlefield card's hairline + outer
 *  glow already live in.
 *
 *  The roles are deliberately few. Before #2724 the board alone emitted ten
 *  ring branches across five palettes (`signal-self` for BOTH "selected" and
 *  "the attacker being aimed", `danger` for a declared attacker, `accent/40`
 *  and `accent/50` for two flavours of "you may click this"), and the pickers
 *  used a sixth pair (`signal-pending` candidate / `signal-self` selected).
 *  Three of those five said the same thing in different colours.
 *
 *  - `candidate` — you MAY click this: a legal target (CR 601.2c), a legal
 *    choice, an eligible cost/sacrifice pick, a defending planeswalker you may
 *    attack, an eligible card in a zone picker.
 *  - `selected`  — you HAVE clicked this: a chosen target, a committed choice,
 *    a paid cost pick, the planeswalker being attacked.
 *  - `attacking` — a creature declared as an attacker this combat.
 *  - `pending`   — a blocker whose attacker assignment is still being chosen.
 *    Same token as `attacking` on purpose (see `index.css`): the two cannot
 *    co-occur, but the source should not call a blocker an attacker.
 *  - `combat-1..4` — combat-group identity: WHICH attacker a blocker is paired
 *    with (`src/lib/combat-colors.ts`). Not a state, a pairing, and the one
 *    axis the three ADR roles do not cover — kept unchanged.
 *
 *  Two MODIFIERS compose with a role rather than being one, and both land on
 *  the attacker currently choosing its target during the attack-with-all
 *  sequence (`useBattlefieldVisualState`):
 *
 *  - `card-ring-current` — a heavier ring and a soft inner halo, in the role's
 *    own colour. STATIC.
 *  - `card-ring-pulse` — the same ring, breathing. Motion-gated in
 *    `index.css`, so it is ambient reinforcement only.
 *
 *  The static one is not decoration. `attacking` is one token for both the
 *  current attacker and the ones already declared, so with
 *  `prefers-reduced-motion: reduce` the pulse never runs and the two would be
 *  pixel-identical — a distinction carried by motion alone is a distinction a
 *  reduced-motion player never receives (issue #2724 review).
 */
export type CardRingRole =
    | "candidate"
    | "selected"
    | "attacking"
    | "pending"
    | "combat-1"
    | "combat-2"
    | "combat-3"
    | "combat-4";

/** The class string for one role. Always includes `card-ring`, which carries
 *  the pseudo-element machinery AND the proportional card corner, so a ring can
 *  never disagree with the corner of the surface it outlines. */
export function cardRingClass(role: CardRingRole): string {
    return `card-ring card-ring-${role}`;
}

/** Combat-group index (0-3) → role. Mirrors `COMBAT_GROUP_RING`'s ordering. */
export const COMBAT_GROUP_ROLE: readonly CardRingRole[] = [
    "combat-1",
    "combat-2",
    "combat-3",
    "combat-4",
] as const;
