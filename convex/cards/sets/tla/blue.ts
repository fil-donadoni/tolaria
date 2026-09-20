// TLA — blue cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { cardsPutIntoLibraryTrigger } from "../../abilities/triggers/cardsPutIntoLibraryTrigger";
import { SPIRIT_SPIRITS_ONLY_COMBAT_TOKEN } from "../../sharedTokens";

// Wan Shi Tong, Librarian (issue #788, cube slice #674) — {X}{U}{U}
// Legendary Creature — Bird Spirit, 1/1, TLA #78. STOP-AND-ISSUE
// (ADR 0061, tracked-by: #1993): the ETB is "put X +1/+1 counters on him.
// Then draw half X cards, rounded down." — a genuine CR 603.6b TRIGGERED
// ability (not `entersWith`, since the Oracle line is "When ~ enters, put X
// counters..."), and "half X, rounded down" needs `Math.floor(x / 2)`
// integer division the Effect Script `EffectValue` grammar structurally
// cannot express (ADR 0045 — "no arithmetic, no expressions"). That forces
// this ability onto `resolve()` — but ADR 0061 forbids a `resolve()` /
// `resolveSteps` closure from calling the raw draw primitive
// (`SpellContext.drawCards` silently skips interactive replacements; only
// the DSL `draw` Op suspends/resumes) and calls exactly this shape — a
// protocol-like card needing both a draw and inexpressible logic — a
// stop-and-issue tracked stub, never shipped silently broken. There is no
// replacement-aware draw callable from a closure today, so the card cannot
// ship until one exists. The card's OTHER half — "whenever an opponent
// searches their library, put a +1/+1 counter on Wan Shi Tong and draw a
// card" — is pure DSL with no arithmetic and was the actual capability
// issue #788 was chartered to ship (`LIBRARY_SEARCHED` event +
// `librarySearchedTrigger` factory, `abilities/triggers/librarySearchedTrigger.ts`);
// that capability ships fully tested with no catalogue card consuming it
// yet, pending this card's draw-primitive gap closing.
// export const wanShiTongLibrarian: CardDefinition = {
//     id: "e20da6b5-1057-4a28-9e85-07de714e262f",
//     name: "Wan Shi Tong, Librarian",
//     rarity: "mythic",
//     manaCost: { X: "X", U: 2 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Bird", "Spirit"],
//     power: 1,
//     toughness: 1,
// };

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
export const wanShiTongAllKnowing: CardDefinition = {
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
};
