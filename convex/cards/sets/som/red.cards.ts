// som — red cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Galvanic Blast — {R} Instant. "Galvanic Blast deals 2 damage to any target.
// Metalcraft — Galvanic Blast deals 4 damage instead if you control three or
// more artifacts." Metalcraft is an ability word (CR 207.2c, no rules meaning
// of its own — Mechanics Registry `metalcraft`), so the clause is a plain
// `if` over the resolving controller's battlefield artifact count, the same
// threshold `hasMetalcraft` reads (`METALCRAFT_ARTIFACTS`, cards/types.ts).
// Shape mirrors Unholy Heat (`mh2/red.cards.ts`); the clause rewrites the
// first sentence's damage (CR 608.2c), so one `if` picks 4 or 2.
// hand-tail: Metalcraft — {self} deals 4 damage instead if you control three or more artifacts. (#8618)
export const galvanicBlast = defineCard(() => ({
    id: "f5881bbc-8600-464d-9dcd-5a7780918d1d",
    rarity: "uncommon",
    name: "Galvanic Blast",
    oracleText:
        "Galvanic Blast deals 2 damage to any target.\nMetalcraft — Galvanic Blast deals 4 damage instead if you control three or more artifacts.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Artifact" },
                    },
                },
                op: "ge",
                right: 3,
            },
            then: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
            else: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
}));
