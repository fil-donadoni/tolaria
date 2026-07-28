// LTR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// TODO(needs-triage): implement — needs a new engine capability.
// tracked-by: #674
// export const palantROfOrthanc: CardDefinition = {
//     id: "6efb6a69-562c-4d95-858d-b067444cfd7e",
//     name: "Palantír of Orthanc",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
// };

// The One Ring (issue #674). Every clause is declarative: the keyword rides
// `staticAbilities`, and all three abilities are Effect Scripts (ADR 0045) —
// no `resolve()` closure anywhere on the card.
//
// The ETB clause needed the one genuinely new engine capability: PLAYER-scoped
// protection from everything (CR 702.16b/e/i applied to a player via CR 115.4).
// Before this card, `gre/protection.ts` handled only the colour-parametrized,
// permanent-scoped keyword. It now also owns the single predicate
// `playerHasProtectionFromEverything`, read by the targeting gate in BOTH
// `getLegalTargets` and the `selectTarget` mutation (so the offered set and
// the accepted set can't diverge) and by `applyPlayerDamagePrevention` (the
// one chokepoint every player-damage sink routes through). The Op
// `setProtectionFromEverything` is its declarative skin.
export const theOneRing: CardDefinition = {
    id: "93de9042-cc62-4ade-8d8d-68fdbc84bfae",
    name: "The One Ring",
    rarity: "mythic",
    oracleText:
        "Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.\n{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    // CR 205.4a — "Legendary Artifact"; the legend rule (CR 704.5j) applies
    // only via this supertype.
    supertypes: ["Legendary"],
    // CR 702.12 — Indestructible. Declared literally (Mechanics Registry row
    // `indestructible`, status "implemented"): the SBA 704.5g destroy skip and
    // `regenerateOrDestroy` both read the effective ability list, so a printed
    // keyword works exactly like a layer-6 grant.
    staticAbilities: ["indestructible"],
    triggeredAbilities: [
        enteredTrigger({
            id: "the-one-ring-etb-protection",
            oracleText:
                "When The One Ring enters, if you cast it, you gain protection from everything until your next turn.",
            scope: "self",
            // CR 603.4 check-time condition — "if you cast it" reads the
            // `wasCast` flag `finalizeSpellResolution` stamps ONLY at the
            // cast-resolution chokepoint (`PermanentEnteredEvent.wasCast`), so
            // a One Ring reanimated, flickered or otherwise put onto the
            // battlefield grants no protection. Same shape as Lutri, the
            // Spellchaser (iko/multicolor.ts).
            condition: (event) => event.wasCast === true,
            effects: [
                // CR 702.16b/e/i — "you" is the source's controller: an ETB
                // ability always belongs to the permanent that has it, so
                // `ctx.controller` inside the script is The One Ring's
                // controller. The "until your next turn" boundary is intrinsic
                // to the Op (cleared at the grantee's next turn start in
                // `advanceTurn`, NOT at CLEANUP — the protection has to cover
                // the whole intervening opponent turn).
                { op: "setProtectionFromEverything", player: "controller" },
            ],
        }),
        phaseTrigger({
            id: "the-one-ring-upkeep-burden",
            oracleText:
                "At the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                // CR 122.6 — the amount is the LIVE burden count on the
                // source; with no counters yet the trigger still resolves and
                // costs 0 life (there is no intervening-if on this ability).
                {
                    op: "loseLife",
                    player: "controller",
                    amount: {
                        counters: { of: { ref: "$source" }, type: "burden" },
                    },
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "the-one-ring-draw",
            oracleText:
                "{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.",
            cost: { tap: true },
            useStack: true,
            effects: [
                // CR 122.1 — the counter goes on FIRST…
                {
                    op: "counters",
                    action: "add",
                    counter: "burden",
                    target: { ref: "$source" },
                    count: 1,
                },
                // …and the draw then reads the count INCLUDING it ("then draw
                // a card for each burden counter"), because the `counters`
                // value reads the live battlefield permanent (CR 122.6). The
                // first activation therefore draws 1, not 0.
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        counters: { of: { ref: "$source" }, type: "burden" },
                    },
                },
            ],
        },
    ],
};
