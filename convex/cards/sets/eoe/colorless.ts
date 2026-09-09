// EOE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe"` resolves through eoe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { TEZZERET_CRUEL_CAPTAIN_EMBLEM_ID } from "../../emblems";

// Tezzeret, Cruel Captain — {3} Legendary Planeswalker — Tezzeret, loyalty 4
// (EOE, issue #3229).
// "Whenever an artifact you control enters, put a loyalty counter on Tezzeret.
//  0: Untap target artifact or creature. If it's an artifact creature, put a
//     +1/+1 counter on it.
//  −3: Search your library for an artifact card with mana value 1 or less,
//     reveal it, put it into your hand, then shuffle.
//  −7: You get an emblem with 'At the beginning of combat on your turn, put
//     three +1/+1 counters on target artifact you control. If it's not a
//     creature, it becomes a 0/0 Robot artifact creature.'"
//
// A colourless planeswalker: the mana cost has no pip, so ADR 0043 files it
// under colorless.ts. `loyalty: 4` is the printed starting loyalty; the engine
// materialises it as four `loyalty` counters on entry (CR 306.5b), which is the
// SAME field the signed `cost.loyalty` legs below spend and damage removes.
// Every loyalty ability is the shipped framework (ADR 0058, #700): `cost:
// { loyalty: N }` with `useStack: true`, and one per permanent per turn is the
// engine's own gate (CR 606.3), never restated per card.
//
// TRIGGER — "whenever an artifact you control enters, put a loyalty counter on
// Tezzeret." A NON-loyalty ability that adds loyalty counters, which needs no
// special case: `counters` with `counter: "loyalty"` writes the very field
// `LOYALTY_COUNTER_KEY` (`gre/loyalty.ts`) names, so the gain is visible to the
// 0-loyalty SBA (CR 704.5i) and to every `-N` cost check. `scope: "yours"` +
// `filter: { types: "Artifact" }` is CR 109.2's "you control"; Tezzeret himself
// is a planeswalker, so his own entry never fires it.
//
// 0 — "Untap target artifact or creature. If it's an artifact creature, put a
// +1/+1 counter on it." The target is an OR of two card types (CR 205 — a
// `TargetRequirement.type` array is OR-of-types), so a plain creature and a
// plain artifact are both legal. The rider needs the AND, and there is no
// AND-of-types filter in the engine (issue #974): it is expressed as NESTED
// `if`s over `objectMatchesFilter` (issue #1747), one per type, which is the
// composition ADR 0045 asks for instead of a new filter field. Both read the
// LIVE, layer-materialised type line (CR 613), so an artifact animated into a
// creature this turn correctly gets the counter, and a creature that stopped
// being an artifact correctly does not.
//
// −3 — the plain shipped tutor shape (Spellseeker, `sets/bbd/blue.ts`):
// `choice(search-library)` → `reveal` → `moveZone(library → hand)` →
// `libraryLook(shuffle)`. The `reveal` Op is load-bearing, not decoration:
// CR 701.23e makes a found card private unless the effect says to reveal it.
// `manaValueAtMost: 1` is CR 202.3's "mana value 1 or less".
//
// −7 — the `emblem` Op naming the registered `EmblemDefinition`
// (`cards/emblems.ts`), where the granted combat trigger and its art live.
// compiler-gap: "Whenever an artifact you control enters, put a loyalty counter on Tezzeret." (#2693)
// compiler-gap: "0: Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it." (#2693)
// compiler-gap: "-3: Search your library for an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle." (#2693)
// compiler-gap: "-7: You get an emblem with "At the beginning of combat on your turn, put three +1/+1 counters on target artifact you control. If it's not a creature, it becomes a 0/0 Robot artifact creature."" (#2693)
export const tezzeretCruelCaptain: CardDefinition = {
    id: "02e8e540-8aa3-4e6a-9a11-c3949cab5f0f",
    name: "Tezzeret, Cruel Captain",
    rarity: "mythic",
    oracleText:
        "Whenever an artifact you control enters, put a loyalty counter on Tezzeret.\n0: Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it.\n−3: Search your library for an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle.\n−7: You get an emblem with \"At the beginning of combat on your turn, put three +1/+1 counters on target artifact you control. If it's not a creature, it becomes a 0/0 Robot artifact creature.\"",
    manaCost: { X: 3 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Tezzeret"],
    loyalty: 4,
    triggeredAbilities: [
        enteredTrigger({
            id: "tezzeret-cruel-captain-artifact-loyalty",
            oracleText:
                "Whenever an artifact you control enters, put a loyalty counter on Tezzeret.",
            scope: "yours",
            filter: { types: "Artifact" },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "loyalty",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "tezzeret-cruel-captain-zero",
            cost: { loyalty: 0 },
            useStack: true,
            oracleText:
                "0: Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it.",
            targetRequirement: { type: ["Artifact", "Creature"], count: 1 },
            effects: [
                // CR 701.26b — untap.
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                // CR 205 — "artifact creature" is an AND of two card types; the
                // engine's type filters are OR-arrays, so the AND is two nested
                // gates rather than one filter (issue #974).
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { target: 0 },
                        filter: { type: "Artifact" },
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { target: 0 },
                                filter: { type: "Creature" },
                            },
                            then: [
                                {
                                    op: "counters",
                                    action: "add",
                                    counter: "+1/+1",
                                    target: { target: 0 },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            id: "tezzeret-cruel-captain-minus3",
            cost: { loyalty: -3 },
            useStack: true,
            oracleText:
                "−3: Search your library for an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Artifact", manaValueAtMost: 1 },
                    count: 1,
                    prompt: "Search your library for an artifact card with mana value 1 or less.",
                    bind: "$picked",
                },
                // CR 701.23e — a found card is NOT revealed unless the effect
                // says so, and this one does.
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
        {
            id: "tezzeret-cruel-captain-minus7",
            cost: { loyalty: -7 },
            useStack: true,
            oracleText:
                '−7: You get an emblem with "At the beginning of combat on your turn, put three +1/+1 counters on target artifact you control. If it\'s not a creature, it becomes a 0/0 Robot artifact creature."',
            effects: [
                { op: "emblem", emblem: TEZZERET_CRUEL_CAPTAIN_EMBLEM_ID },
            ],
        },
    ],
};
