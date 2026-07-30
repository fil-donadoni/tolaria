// PLS (Planeshift) — colorless cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    CardPrint,
    ManaCost,
    MayPayCost,
} from "../../types";
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

// ─────────────────────────────────────────────────────────────────────────
// C8f — Random pick from the exile-by-source pile (CR 400.7 / 701.13, issue
// #1947). Skyship Weatherlight.
// ─────────────────────────────────────────────────────────────────────────

// Skyship Weatherlight — {4} Legendary Artifact. "When this enters, search
// your library for any number of artifact and/or creature cards, exile
// them, then shuffle. {4}, {T}: Choose a card at random that was exiled
// with Skyship Weatherlight. Put that card into its owner's hand."
//
// ETB (CR 603.6a self-ETB): the tutor `choice(kind:"search-library")` +
// `moveZone(cards, to:"exile")` composition (the Jester's Cap precedent,
// ice/colorless.ts) with an unbounded "any number" count — `count: { min:
// 0, max: Number.MAX_SAFE_INTEGER }` is clamped down to however many
// artifact/creature cards actually sit in the library by the `choice` Op's
// own availability clamp (`Math.min(op.count.max, available)`,
// interpreter.ts), the SAME "any number" idiom several resolve() cards
// already use via `peekLibraryTop(..., Number.MAX_SAFE_INTEGER)` — no
// sentinel/special-case needed (ADR 0045 "generalize, don't add"). `filter:
// { type: ["Artifact", "Creature"] }` is CR 205's "and/or" read as an OR
// within the field (Torsten's `digToHand` filter, dmc/multicolor.ts, same
// idiom). The new `linkToSource: true` flag (issue #1947) parametrizes the
// EXISTING `moveZone` `cards` shape rather than adding a second new Op: it
// stamps every exiled card with `exiledBySourceId` via `linkExileToSource`
// — the same CR 607 link `hideaway` already stamps for a single card,
// generalized here to an arbitrary-count tutor sweep. "Then shuffle" is the
// trailing `libraryLook`(shuffle) Op, matching every real tutor's ordering
// (search → exile → shuffle).
//
// ACTIVATED (CR 602.1): `{4}, {T}`, no sacrifice — the artifact stays on
// the battlefield to be reused. `randomExileToHand` (issue #1947, new Op)
// reads the linked pile via `SpellContext.pickRandomCardExiledWith(
// ctx.sourceInstanceId)` — the SAME `exiledBySourceId`-keyed pool
// `getCardsExiledWith` enumerates for Currency Converter's player-CHOSEN
// retrieval and `hideaway`'s cast-permission selector (issues #791/#783),
// generalized to a RANDOM pick — drawing uniformly from the game's seeded
// PRNG (mirrors `discardAtRandom`'s determinism precedent, so replays
// reproduce the same result) and puts the pick into ITS OWNER's hand (the
// modern-Oracle, errata-corrected destination — the 2001 printing said
// "your hand"; both mtgjson's `text` field and the 2004-10-04 ruling
// confirm "its owner's hand"). CR 400.7 / 607: the link is per-INSTANCE,
// keyed to THIS permanent's own id — Skyship Weatherlight leaving the
// battlefield does not return the remaining exiled cards (2004-10-04
// ruling: "If this card leaves the battlefield, the remaining cards that
// were exiled don't come back"), and a second Skyship Weatherlight's own
// pile is entirely disjoint (each stamps its own `exiledBySourceId`). An
// EMPTY pile is a CR 608.2b no-op — per the acceptance criterion's chosen
// disambiguation, the ability is still activatable (its mana/tap cost is
// still paid) but resolves with no effect, matching the same ruling that
// the initial search "may choose to not find anything."
export const skyshipWeatherlight: CardDefinition = {
    id: "63f5498b-bb12-48ec-811b-b52e45ffddaf", // PLS 133 (canonical art)
    rarity: "rare",
    name: "Skyship Weatherlight",
    oracleText:
        "When Skyship Weatherlight enters, search your library for any number of artifact and/or creature cards, exile them, then shuffle.\n{4}, {T}: Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    triggeredAbilities: [
        enteredTrigger({
            id: "skyship-weatherlight-etb",
            oracleText:
                "When Skyship Weatherlight enters, search your library for any number of artifact and/or creature cards, exile them, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: ["Artifact", "Creature"] },
                    count: { min: 0, max: Number.MAX_SAFE_INTEGER },
                    prompt: "Search your library for any number of artifact and/or creature cards to exile.",
                    bind: "$found",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found" },
                    player: "controller",
                    from: "library",
                    to: "exile",
                    linkToSource: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "skyship-weatherlight-random",
            oracleText:
                "{4}, {T}: Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.",
            cost: { mana: { X: 4 }, tap: true },
            useStack: true,
            effects: [{ op: "randomExileToHand" }],
        },
    ],
};

// Skyship Weatherlight — PLS 133★, the foil-only alternate-illustration
// variant printed in the SAME set (ADR 0014: one CardDefinition + one
// CardPrint per artwork). Rarity/mechanics are identical to the canonical
// print above; only the Scryfall art id differs.
export const skyshipWeatherlightAlt: CardPrint = {
    printId: "99791ef7-ff51-4982-b0ef-55560f9577ff", // PLS 133★
    definitionId: skyshipWeatherlight.id,
    setCode: "pls",
    rarity: "rare",
};
