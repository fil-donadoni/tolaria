// PLS (Planeshift) — colorless cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, ManaCost, MayPayCost } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// CR 117.3a / 701.16 / 701.24 — the Planeshift "Lair" cycle (5 tri-colour tap
// lands: Crosis's Catacombs, Darigaaz's Caldera, Dromar's Cavern, Rith's
// Grove, Treva's Ruins). Each reads "When this land enters, sacrifice it
// unless you return a non-Lair land you control to its owner's hand." — a
// may-pay PERMANENT leg (`action: "return"`, ADR 0079 `CostLegs`, issue
// #1933) with a "not $paid" sacrifice fallback (CR 118 "unless"). Whether to
// pay, and which land pays, are both an explicit player choice routed through
// the unified `sacrificeChoice` layer (`mayPay` suspends for the Pay/Skip
// decision; accepting opens the return-leg picker over the legal lands) —
// never auto-picked, even with exactly one legal land to return.
//
// `excludeSubtypes: "Lair"` (CR 205.3i lists Lair among the recognized land
// types) is the "non-Lair" restriction: the filter runs over the payer's
// WHOLE battlefield at payment time, so every OTHER Lair the player already
// controls is excluded too — a Lair can never pay for its own or a sibling
// Lair's survival.
const LAIR_ORACLE_TEXT =
    "When this land enters, sacrifice it unless you return a non-Lair land you control to its owner's hand.";

const RETURN_A_NON_LAIR_LAND: MayPayCost = {
    permanent: {
        action: "return",
        filter: { types: "Land", excludeSubtypes: "Lair" },
        count: 1,
    },
};

function lairEntersUnlessReturned(triggerId: string) {
    return enteredTrigger({
        id: triggerId,
        oracleText: LAIR_ORACLE_TEXT,
        scope: "self",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost: RETURN_A_NON_LAIR_LAND,
                prompt: "Return a non-Lair land you control to its owner's hand, or sacrifice this land?",
                bind: "$paid",
            },
            {
                op: "if",
                // CR 118 — the "unless" consequence: decline and the source is
                // sacrificed.
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "sacrifice", target: { ref: "$source" } }],
            },
        ],
    });
}

/** `{T}: Add <colour>, <colour>, or <colour>.` — no `effect` closure needed;
 *  the engine derives `addMana` from `manaChoices` directly (painland /
 *  depletion-dual precedent). */
function lairManaAbility(
    id: string,
    oracleText: string,
    manaChoices: [ManaCost, ManaCost, ManaCost]
) {
    return {
        id,
        oracleText,
        cost: { tap: true },
        useStack: false,
        manaChoices,
    };
}

export const crosissCatacombs: CardDefinition = {
    id: "7caad74f-c0d0-4eca-94be-b89a2c9a3980",
    name: "Crosis's Catacombs",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {U}, {B}, or {R}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("crosiss-catacombs-etb")],
    activatedAbilities: [
        lairManaAbility(
            "crosiss-catacombs-mana",
            "{T}: Add {U}, {B}, or {R}.",
            [{ U: 1 }, { B: 1 }, { R: 1 }]
        ),
    ],
};

export const darigaazsCaldera: CardDefinition = {
    id: "752f6f0c-af30-4937-b4a7-48f493e007a0",
    name: "Darigaaz's Caldera",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {B}, {R}, or {G}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("darigaazs-caldera-etb")],
    activatedAbilities: [
        lairManaAbility(
            "darigaazs-caldera-mana",
            "{T}: Add {B}, {R}, or {G}.",
            [{ B: 1 }, { R: 1 }, { G: 1 }]
        ),
    ],
};

export const dromarsCavern: CardDefinition = {
    id: "85f10cee-6a63-438e-a9df-6b902dd025b8",
    name: "Dromar's Cavern",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {W}, {U}, or {B}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("dromars-cavern-etb")],
    activatedAbilities: [
        lairManaAbility("dromars-cavern-mana", "{T}: Add {W}, {U}, or {B}.", [
            { W: 1 },
            { U: 1 },
            { B: 1 },
        ]),
    ],
};

export const rithsGrove: CardDefinition = {
    id: "740fa25d-9c1f-44eb-9eb4-0dd514cb315a",
    name: "Rith's Grove",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {R}, {G}, or {W}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("riths-grove-etb")],
    activatedAbilities: [
        lairManaAbility("riths-grove-mana", "{T}: Add {R}, {G}, or {W}.", [
            { R: 1 },
            { G: 1 },
            { W: 1 },
        ]),
    ],
};

export const trevasRuins: CardDefinition = {
    id: "8bae2458-b54f-426a-ad40-13529a73c423",
    name: "Treva's Ruins",
    rarity: "uncommon",
    oracleText: `${LAIR_ORACLE_TEXT}\n{T}: Add {G}, {W}, or {U}.`,
    types: ["Land"],
    subtypes: ["Lair"],
    triggeredAbilities: [lairEntersUnlessReturned("trevas-ruins-etb")],
    activatedAbilities: [
        lairManaAbility("trevas-ruins-mana", "{T}: Add {G}, {W}, or {U}.", [
            { G: 1 },
            { W: 1 },
            { U: 1 },
        ]),
    ],
};
