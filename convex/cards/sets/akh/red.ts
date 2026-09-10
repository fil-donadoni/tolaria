// AKH — red cards, split by colour per ADR 0043. The registry's
// `import * as akh from "./sets/akh"` resolves through akh/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Glorybringer — {3}{R}{R} Creature — Dragon 4/4.
// "Flying, haste
//  You may exert this creature as it attacks. When you do, it deals 4 damage to
//  target non-Dragon creature an opponent controls."
//
// CR 701.43d — "You may exert [this creature] as it attacks" is an OPTIONAL
// COST TO ATTACK (CR 508.1g), not a triggered ability: the choice is made as
// attackers are declared, so a Glorybringer removed from combat before damage
// still misses its next untap step. The `may-exert-as-attacks` static effect
// below is that offer; the engine surfaces it per declared attacker
// (`exertableAttackerIds`, `gre/exert.ts`) and pays it at
// `finalizeConfirmAttackers`.
//
// CR 701.43d / 607.2h — the "When you do" half is LINKED to that static
// ability: it "refers only to actions taken as a result of the static
// ability". Modelled as a `PERMANENT_EXERTED` trigger matching this permanent's
// own id, which is exactly that scope — no other permanent's exert, and no
// exert paid as an activation cost elsewhere on the board, can fire it.
//
// compiler-gap: "You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls." (#3214)
export const glorybringer: CardDefinition = {
    id: "3277ad99-5682-4baa-b106-de15721876a6",
    name: "Glorybringer",
    rarity: "rare",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 4,
    toughness: 4,
    oracleText:
        "Flying, haste\nYou may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls. (An exerted creature won't untap during your next untap step.)",
    staticAbilities: ["flying", "haste"],
    staticEffects: [
        {
            kind: "may-exert-as-attacks",
            id: "glorybringer-exert-offer",
            oracleText: "You may exert this creature as it attacks.",
        },
    ],
    triggeredAbilities: [
        {
            id: "glorybringer-exert-damage",
            oracleText:
                "When you do, it deals 4 damage to target non-Dragon creature an opponent controls.",
            // CR 607.2h — linked to the static ability above: matching on this
            // permanent's OWN exert is what makes the link, so a second copy of
            // the ability would carry its own separately-linked trigger.
            event: "PERMANENT_EXERTED",
            matches: (event, self) =>
                event.type === "PERMANENT_EXERTED" &&
                event.permanentId === self.id,
            // CR 603.3d — a triggered ability chooses its targets as it is put
            // on the stack, which for this one is the same moment the exert was
            // paid (CR 508.1g).
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
                excludeSubtypes: "Dragon",
            },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        },
    ],
};
