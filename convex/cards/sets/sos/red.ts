// SOS (Secrets of Strixhaven) — red cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through
// sos/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.
import type { CardDefinition } from "../../types";

// Impractical Joke — {R} Sorcery (SOS). "Damage can't be prevented this turn.
// Impractical Joke deals 3 damage to up to one target creature or
// planeswalker."
//
// CR 615.12 — the first sentence is the GAME-scoped anti-prevention lock, the
// shape issue #3303 minted as the `suppressDamagePrevention` Op for Stomp's
// identical line. It names no source, no recipient and no duration but the
// turn, which is exactly what rules out both narrower shapes already shipped:
// `lockDamage` (Whippoorwill) binds the override to ONE RECIPIENT and also
// carries CR 614.9's unredirectable clause, and the
// `combat-damage-unpreventable` static (Questing Beast) binds it to ONE SOURCE
// and to combat only.
//
// ORDER IS THE CARD: the lock is armed FIRST, so it covers this spell's own
// damage in the same resolution (CR 608.2 — a spell's instructions are followed
// in the order written). It is symmetric and turn-scoped, so it equally
// unprevents damage dealt to its own caster for the rest of the turn — that is
// the printed card, not an approximation. Prevention ONLY: a redirect is not a
// prevention (CR 614.9), so a redirection effect still moves damage dealt under
// this lock.
//
// CR 601.2c — "up to one target creature or planeswalker" is an ANNOUNCED slot
// with `count: { min: 0, max: 1 }`, not a resolution-time choice: it is subject
// to hexproof / protection / ward and fires "becomes the target" triggers. With
// zero targets chosen the `dealDamage` Op skips (CR 608.2b) and the prevention
// clause still applies — the spell resolves and does its first half.
// `type: ["Creature", "Planeswalker"]` is the OR type filter; `["any"]` would
// wrongly admit a player (issue #3073).
export const impracticalJoke: CardDefinition = {
    id: "39a816b4-39b8-421c-b828-68db901d34b7", // SOS 12
    rarity: "uncommon",
    name: "Impractical Joke",
    oracleText:
        "Damage can't be prevented this turn. Impractical Joke deals 3 damage to up to one target creature or planeswalker.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: { min: 0, max: 1 },
    },
    effects: [
        { op: "suppressDamagePrevention" },
        { op: "dealDamage", amount: 3, to: { target: 0 } },
    ],
};
