// mh1 — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { levelBandStatics, levelUpAbility } from "../../abilities/levelUp";

// Force of Vigor — {2}{G}{G} Instant. "If it's not your turn, you may exile a
// green card from your hand rather than pay this spell's mana cost. Destroy up
// to two target artifacts and/or enchantments." (CR 118.9 alternative pitch
// cost — exile a green card from hand, gated on the not-your-turn condition;
// CR 701.8 destroy; CR 601.2c "up to two" targeting.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `handCost.action: "exile"` leg with `condition: not-your-turn`. The effect
// reuses the already-censused `destroy` Op on each of the up-to-two announced
// targets ({ target: 0 } / { target: 1 }); an unchosen second target resolves
// to nothing and its Op is skipped (CR 608.2b), so 0/1/2 targets all work
// (ADR 0045, DSL-first).
export const forceOfVigor: CardDefinition = {
    id: "017c415b-d635-43c6-92b8-8c95d1c4ff8d", // MH1 164
    rarity: "rare",
    name: "Force of Vigor",
    oracleText:
        "If it's not your turn, you may exile a green card from your hand rather than pay this spell's mana cost.\nDestroy up to two target artifacts and/or enchantments.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: ["Artifact", "Enchantment"],
        count: { min: 0, max: 2 },
    },
    alternativeCosts: [
        {
            id: "pitch-exile-green",
            description: "Exile a green card from your hand",
            condition: { kind: "not-your-turn" },
            hand: {
                action: "exile",
                requirements: [{ filter: { color: "G" }, count: 1 }],
            },
        },
    ],
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "destroy", target: { target: 1 } },
    ],
};

// Hexdrinker — {G} Creature — Snake 2/1. "Level up {1} ({1}: Put a level
// counter on this. Level up only as a sorcery.) LEVEL 3-7 4/4 Protection from
// instants. LEVEL 8+ 6/6 Protection from everything." The card that brings the
// Level Up mechanic (CR 702.87) and the leveler LEVEL symbols (CR 711.2) into
// the engine — both live in the shared `levelUpAbility` / `levelBandStatics`
// factory (`convex/cards/abilities/levelUp.ts`), so the next leveler card is a
// card-file edit and no engine change.
//
// CR 711.5 — below the first band (0-2 level counters) the creature has its
// uppermost printed P/T, which is the definition's own 2/1: the sub-band is
// expressed by OMISSION, not by a third static effect.
//
// "Protection from everything" (CR 702.16j) is the permanent-scoped variant of
// the protection keyword — new to `parseProtectionQuality` with this card, and
// reaching every CR 702.16 consult site through the one `isProtectedFrom`
// predicate the other four quality families already flow through. It is NOT
// the player-scoped variant The One Ring grants (CR 115.4), which stays a
// separate authority.
//
// compiler-gap: "Level up {1}" (#2693)
// compiler-gap: "LEVEL 3-7 4/4 Protection from instants" (#2693)
// compiler-gap: "LEVEL 8+ 6/6 Protection from everything" (#2693)
export const hexdrinker: CardDefinition = {
    id: "89f5cc05-5d9d-4709-b3c5-a6249c294acc", // MH1 168
    rarity: "mythic",
    name: "Hexdrinker",
    oracleText:
        "Level up {1} ({1}: Put a level counter on this. Level up only as a sorcery.)\nLEVEL 3-7\n4/4\nProtection from instants\nLEVEL 8+\n6/6\nProtection from everything",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 2,
    toughness: 1,
    activatedAbilities: [levelUpAbility({ cost: { X: 1 }, costLabel: "{1}" })],
    staticEffects: levelBandStatics([
        // CR 711.2a — {LEVEL 3-7}: 4/4, protection from instants.
        {
            min: 3,
            max: 7,
            power: 4,
            toughness: 4,
            abilities: ["protection from instants"],
        },
        // CR 711.2b — {LEVEL 8+}: 6/6, protection from everything.
        {
            min: 8,
            power: 6,
            toughness: 6,
            abilities: ["protection from everything"],
        },
    ]),
};
