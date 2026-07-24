// NEC — blue cards, split by colour per ADR 0043. The registry's
// `import * as nec from "./sets/nec"` resolves through nec/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { wardAbility } from "../../abilities/ward";

// Kappa Cannoneer — {5}{U} Artifact Creature — Turtle Warrior, 4/4 (NEC 14,
// Vintage Cube FREE wave 3: keyword-residue creatures, issue #1527, closes
// #1321/#917 residue). Un-stubbed now that both blocking keywords are
// `implemented`: Improvise (CR 702.126, issue #1313) and Ward (CR 702.21,
// issue #1312). "Improvise\nWard {4}\nWhenever this creature or another
// artifact you control enters, put a +1/+1 counter on this creature. It
// can't be blocked this turn."
//
// DSL-first (ADR 0045). The self-ETB anthem is `enteredTrigger({ scope:
// "yours", filter: { types: "Artifact" } })` — "yours" already matches
// Kappa's OWN ETB (same controller as itself), and the Artifact filter
// matches both Kappa itself (an Artifact Creature) and any other artifact,
// so ONE trigger covers "this creature or another artifact you control
// enters" with no self-exclusion needed (CR 109.2 doesn't apply — Kappa DOES
// want to see its own ETB, unlike the `another-yours`/`any-other` scopes).
// Effects: `counters` (CR 122, add a +1/+1 on `$source`) then `restrictCombat`
// (`restriction: "cant-be-blocked"`, CR 509.1b, the Creeping Tar Pit
// precedent, `wwk/colorless.ts`) on `$source`. Ward is
// `wardAbility({ cost: { mana: {X:4} }, costLabel: "{4}" })` (CR 702.21a) —
// the shared "counter unless pay" DSL shape (Miscalculation/Force Spike);
// Kappa Cannoneer is the first catalogue card to prove the keyword.
export const kappaCannoneer: CardDefinition = {
    id: "85a89077-b384-4fca-9d26-7297962c1541", // NEC 14
    name: "Kappa Cannoneer",
    rarity: "rare",
    oracleText:
        "Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)\nWard {4}\nWhenever this creature or another artifact you control enters, put a +1/+1 counter on this creature. It can't be blocked this turn.",
    manaCost: { X: 5, U: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Turtle", "Warrior"],
    power: 4,
    toughness: 4,
    staticAbilities: ["improvise", "ward {4}"],
    triggeredAbilities: [
        wardAbility({ cost: { mana: { X: 4 } }, costLabel: "{4}" }),
        enteredTrigger({
            id: "kappa-cannoneer-artifact-etb",
            oracleText:
                "Whenever this creature or another artifact you control enters, put a +1/+1 counter on this creature. It can't be blocked this turn.",
            scope: "yours",
            filter: { types: "Artifact" },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
                {
                    op: "restrictCombat",
                    restriction: "cant-be-blocked",
                    target: { ref: "$source" },
                },
            ],
        }),
    ],
};
