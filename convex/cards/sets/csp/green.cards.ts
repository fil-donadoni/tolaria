// csp — green cards (ADR 0043 colour split).
import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";

// Allosaurus Rider — {5}{G}{G} Creature — Elf Warrior, 1+*/1+*. "You may
// exile two green cards from your hand rather than pay this spell's mana
// cost. Allosaurus Rider's power and toughness are each equal to 1 plus the
// number of lands you control."
// CR 118.9 alternative cost: a `hand.action: "exile"` leg asking for two
// distinct green cards; the mana cost itself is unchanged (CR 118.9c).
// CR 604.3 characteristic-defining ability: the `pt-cda` compute result is
// added on top of the printed base 1/1, counting the lands the creature's
// controller controls at every stat read.
// hand-tail: Allosaurus Rider's power and toughness are each equal to 1 plus the number of lands you control. (#10533)
export const allosaurusRider = defineCard(() => ({
    id: "e0f3ba39-5b4d-4a7c-9215-7e349aecbeb3", // CSP 101
    rarity: "rare",
    name: "Allosaurus Rider",
    oracleText:
        "You may exile two green cards from your hand rather than pay this spell's mana cost.\nAllosaurus Rider's power and toughness are each equal to 1 plus the number of lands you control.",
    manaCost: { X: 5, G: 2 },
    types: ["Creature"],
    subtypes: ["Elf", "Warrior"],
    // Base 1/1; the CDA adds the land count on top (the "*" part).
    power: 1,
    toughness: 1,
    alternativeCosts: [
        {
            id: "pitch-exile-two-green",
            description: "Exile two green cards from your hand",
            hand: {
                action: "exile",
                requirements: [{ filter: { color: "G" }, count: 2 }],
            },
        },
    ],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const card of player.battlefield) {
                        if (
                            card.controllerId === source.controllerId &&
                            card.types.includes("Land")
                        ) {
                            lands++;
                        }
                    }
                }
                return { power: lands, toughness: lands };
            },
        },
    ],
}));
