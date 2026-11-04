// TLA — blue cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, PERMANENT_TYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { cardsPutIntoLibraryTrigger } from "../../abilities/triggers/cardsPutIntoLibraryTrigger";
import { librarySearchedTrigger } from "../../abilities/triggers/librarySearchedTrigger";
import { SPIRIT_SPIRITS_ONLY_COMBAT_TOKEN } from "../../sharedTokens";

// Wan Shi Tong, Librarian — {X}{U}{U} Legendary Creature — Bird Spirit 1/1, TLA
// #78. The ETB is a CR 603.6a TRIGGERED ability, not `entersWith` (the Oracle
// line is "When ~ enters, put X counters…"), so its X is the reserved
// `$source.chosenXOnCast` read (CR 400.7d), never `{ X: true }`, which reads the
// trigger's own stack item. "Half X, rounded down" is `divide` (CR 107.1a). A
// source gone before the trigger resolves takes no counters (CR 400.7), yet the
// draw still reads its last-known X (CR 608.2h). The second ability is the
// `LIBRARY_SEARCHED` trigger, which never fires on a look-pick prompt.
//
// hand-tail: "When Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down." (#1993)
// hand-tail: "Whenever an opponent searches their library, put a +1/+1 counter on Wan Shi Tong and draw a card." (#1993)
export const wanShiTongLibrarian = defineCard(() => ({
    id: "e20da6b5-1057-4a28-9e85-07de714e262f",
    name: "Wan Shi Tong, Librarian",
    rarity: "mythic",
    oracleText:
        "Flash\nFlying, vigilance\nWhen Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.\nWhenever an opponent searches their library, put a +1/+1 counter on Wan Shi Tong and draw a card.",
    manaCost: { X: "X", U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Bird", "Spirit"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flash", "flying", "vigilance"],
    triggeredAbilities: [
        enteredTrigger({
            id: "wan-shi-tong-librarian-etb",
            oracleText:
                "When Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.",
            scope: "self",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: { ref: "$source.chosenXOnCast" },
                    target: { ref: "$source" },
                },
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        divide: {
                            value: { ref: "$source.chosenXOnCast" },
                            by: 2,
                            rounding: "down",
                        },
                    },
                },
            ],
        }),
        librarySearchedTrigger({
            id: "wan-shi-tong-librarian-opponent-search",
            oracleText:
                "Whenever an opponent searches their library, put a +1/+1 counter on Wan Shi Tong and draw a card.",
            scope: "opponents",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: 1,
                    target: { ref: "$source" },
                },
                { op: "draw", player: "controller", count: 1 },
            ],
        }),
    ],
}));

// Wan Shi Tong, All-Knowing (issue #3242) — {3}{U}{U} Legendary Creature —
// Bird Spirit 4/4, TLE #98. The ETB's chooser is the target's OWNER, who may be
// the opponent: `optionChoice` routed through `{ ownerOf }` (CR 108.3), each
// mode a positional library insert into that owner's library (CR 400.3). The
// second ability fires once per batch of cards put into any library from
// another zone (`CARDS_PUT_INTO_LIBRARY`, CR 603.2c) — its own ETB's move
// included, so the ETB resolving makes two Spirits. Scry, surveil and other
// reorders never trigger it (the official ruling).
//
// hand-tail: "When Wan Shi Tong enters, target nonland permanent's owner puts it into their library second from the top or on the bottom." (#4195)
// hand-tail: "Whenever one or more cards are put into a library from anywhere, create two 1/1 colorless Spirit creature tokens" (#4195)
export const wanShiTongAllKnowing = defineCard(() => ({
    id: "777fcc21-2856-4181-8ecd-c272f9769e36",
    name: "Wan Shi Tong, All-Knowing",
    rarity: "mythic",
    oracleText:
        "Flying\nWhen Wan Shi Tong enters, target nonland permanent's owner puts it into their library second from the top or on the bottom.\nWhenever one or more cards are put into a library from anywhere, create two 1/1 colorless Spirit creature tokens with \"This token can't block or be blocked by non-Spirit creatures.\"",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Bird", "Spirit"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "wan-shi-tong-all-knowing-etb-tuck",
            oracleText:
                "When Wan Shi Tong enters, target nonland permanent's owner puts it into their library second from the top or on the bottom.",
            scope: "self",
            // CR 115.1c — "target nonland permanent" (any controller's).
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                excludeTypes: "Land",
                count: 1,
            },
            effects: [
                {
                    op: "optionChoice",
                    player: { ownerOf: { target: 0 } },
                    prompt: "Put it into your library second from the top or on the bottom?",
                    modes: [
                        {
                            id: "second-from-top",
                            label: "Second from the top",
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "library",
                                    position: 2,
                                },
                            ],
                        },
                        {
                            id: "bottom",
                            label: "On the bottom",
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "library",
                                    position: "bottom",
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
        cardsPutIntoLibraryTrigger({
            id: "wan-shi-tong-all-knowing-library-spirits",
            oracleText:
                'Whenever one or more cards are put into a library from anywhere, create two 1/1 colorless Spirit creature tokens with "This token can\'t block or be blocked by non-Spirit creatures."',
            scope: "any",
            effects: [
                {
                    op: "createToken",
                    token: SPIRIT_SPIRITS_ONLY_COMBAT_TOKEN,
                    count: 2,
                    controller: "controller",
                },
            ],
        }),
    ],
}));

// Boomerang Basics — {U} Sorcery — Lesson, TLA. "Return target nonland
// permanent to its owner's hand. If you controlled that permanent, draw a
// card."
//
// "Controlled" is a CR 608.2h last-known-information question, but
// `objectMatchesFilter` reads the live battlefield only, so the `if` is
// evaluated BEFORE the bounce and each branch carries the same `moveZone`;
// only the controlled branch draws. The draw follows the bounce, as the
// Oracle text orders it (CR 608.2c).
//
// hand-tail: If you controlled that permanent, draw a card (#7229)
export const boomerangBasics = defineCard(() => ({
    id: "17ab958a-abc6-472e-ad6a-97c731d89c74",
    rarity: "uncommon",
    name: "Boomerang Basics",
    oracleText:
        "Return target nonland permanent to its owner's hand. If you controlled that permanent, draw a card.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    subtypes: ["Lesson"],
    // CR 115.1a — "target nonland permanent" (any controller's).
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "if",
            predicate: {
                objectMatchesFilter: { target: 0 },
                filter: {},
                controlledBy: "controller",
            },
            then: [
                { op: "moveZone", target: { target: 0 }, to: "hand" },
                { op: "draw", player: "controller", count: 1 },
            ],
            else: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
}));
