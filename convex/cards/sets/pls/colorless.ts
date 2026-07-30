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

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Star Compass and Meteor Crater offer a colour set that is neither fixed nor
// "any colour": it is derived from a described slice of the board and
// recomputed at every activation. Both declare an
// `ActivatedAbility.manaColorSource` descriptor (`convex/cards/types.ts`) —
// declarative data evaluated by the engine's single `boardDerivedManaChoices`
// authority (`gre/constants.ts`), which the castability probe, the auto-tap
// solver, the bot's payment planner and the client picker already read, so the
// restricted set is visible everywhere and never desyncs. The two exercise the
// descriptor's two orthogonal axes: WHICH permanents contribute (a filter) and
// HOW each yields a colour (`"produces"`, CR 106.4, vs `"isColor"`, CR 105.2).
// Third card of the family: Quirion Explorer (`pls/green.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Representative / fallback options (any single colour) for best-effort
 *  callers with no board snapshot. The `manaColorSource` descriptor overrides
 *  it wherever a board IS available — the same contract Fellwar Stone
 *  (`drk/colorless.ts`) established. */
const ANY_SINGLE_COLOR: ManaCost[] = [
    { W: 1 },
    { U: 1 },
    { B: 1 },
    { R: 1 },
    { G: 1 },
];

// Star Compass — {2} Artifact. "This artifact enters tapped. / {T}: Add one
// mana of any color that a basic land you control could produce."
// (CR 110.5b enters tapped; CR 605.1a mana ability, `useStack: false`;
// CR 106.4 "could produce" over the controller's own BASIC lands only —
// `supertypes: "Basic"` is read from the LIVE supertype set, so a
// non-basic dual never contributes.)
export const starCompass: CardDefinition = {
    id: "b1d0beb4-c3dd-4bb1-b49b-a48b2d4ad38d",
    rarity: "uncommon",
    name: "Star Compass",
    oracleText:
        "This artifact enters tapped.\n{T}: Add one mana of any color that a basic land you control could produce.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "star-compass-mana",
            oracleText:
                "{T}: Add one mana of any color that a basic land you control could produce.",
            cost: { tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
            manaColorSource: {
                filter: {
                    types: "Land",
                    supertypes: "Basic",
                    controllerRelation: "you",
                },
                colors: "produces",
            },
        },
    ],
};

// Meteor Crater — Land. "{T}: Choose a color of a permanent you control. Add
// one mana of that color." (CR 605.1a mana ability, `useStack: false`. The
// scope is EVERY permanent the controller has, not just lands, and the colour
// read is the permanent's OWN colour (CR 105.2 / 202.2, post-layer-5) rather
// than what it could produce — a Forest contributes nothing, a green creature
// contributes {G}. Meteor Crater itself is a colourless land, so it never
// contributes to its own list.)
export const meteorCrater: CardDefinition = {
    id: "043a2299-1cfc-4732-a10a-58c773b9992c",
    rarity: "rare",
    name: "Meteor Crater",
    oracleText:
        "{T}: Choose a color of a permanent you control. Add one mana of that color.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "meteor-crater-mana",
            oracleText:
                "{T}: Choose a color of a permanent you control. Add one mana of that color.",
            cost: { tap: true },
            useStack: false,
            manaChoices: ANY_SINGLE_COLOR,
            manaColorSource: {
                filter: { controllerRelation: "you" },
                colors: "isColor",
            },
        },
    ],
};
