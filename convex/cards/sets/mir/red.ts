// mir — red cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Goblin Tinkerer — {1}{R} 1/2 Goblin Artificer. "{R}, {T}: Destroy target
// artifact. That artifact deals damage equal to its mana value to this
// creature." (CR 602.1 activation; CR 701.8 destroy; CR 202.3 mana value.)
//
// Two Ops, and the second one is the interesting half. "THAT ARTIFACT deals
// damage" makes the destroyed artifact the CR 120.1 source — not the ability
// — so protection from the artifact's colour, damage prevention keyed on the
// source, and "whenever a source deals damage" watchers all read the
// artifact's identity. `dealDamage.source` is exactly that field (Backlash,
// `inv/multicolor.ts`, is its shipped precedent), pointed at the `destroy`
// Op's own `bind` snapshot. The snapshot is also what makes the mana-value
// read correct: by the time the damage is dealt the artifact is in a
// graveyard, and CR 608.2h says an object that has left the zone it was
// expected in contributes its LAST KNOWN INFORMATION — the snapshot IS that
// LKI (Divine Offering, `leg/white.ts`, reads `manaValue` off a destroy bind
// the same way). The damage lands on `{ ref: "$source" }`, the Tinkerer
// itself, which is why a big artifact kills it.
//
// compiler-gap: {R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature. (#2693)
export const goblinTinkerer: CardDefinition = {
    id: "e6529852-8b3e-4a70-a4a1-029e012231c6", // MIR 180
    rarity: "common",
    name: "Goblin Tinkerer",
    oracleText:
        "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Artificer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "goblin-tinkerer-destroy-artifact",
            oracleText:
                "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.",
            cost: { mana: { R: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$artifact" },
                {
                    op: "dealDamage",
                    amount: { ref: "$artifact.manaValue" },
                    to: { ref: "$source" },
                    source: { ref: "$artifact" },
                },
            ],
        },
    ],
};
