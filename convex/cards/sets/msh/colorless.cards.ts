// MSH — colorless cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import {
    nthSpellOfTypeThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";

// The Fantasticar — {3} Legendary Artifact — Vehicle, 4/4 (MSC, issue #7255,
// parent #4243). "Flying. Whenever you cast a noncreature spell, you may have
// The Fantasticar become an artifact creature until end of turn. Whenever you
// cast your fourth noncreature spell each turn, you may sacrifice The
// Fantasticar. If you do, create four 4/4 colorless Construct artifact
// creature tokens with flying and haste." DSL-first (ADR 0045), no
// `resolve()`.
//
// A Vehicle with NO crew ability, so `makeVehicle` (which always appends
// Crew N) does not fit; the definition is written directly. CR 301.7a/b: it
// has its printed 4/4 only while it is a creature, so the animation is the
// `animate` Op with the printed P/T until end of turn (CR 514.2), exactly the
// body `crewAbility` uses.
//
// "Fourth noncreature spell each turn" is `nthSpellOfTypeThisTurn(4,
// { excludeTypes: "Creature" })` (CR 601.2i, issue #1968): the caster's tally
// snapshotted on the cast event, so a fifth spell cast in response does not
// undo it. Plain `condition`, not `interveningIf` — the Oracle text has no
// "if" clause (CR 603.4).
//
// "You may sacrifice ... If you do" (CR 701.21a): a bare `mayPay` decision,
// then the sacrifice only when The Fantasticar is still on the battlefield
// (`objectMatchesFilter`; a permanent already gone cannot be
// sacrificed, so "if you do" is false and no Constructs appear).
//
// Guard C (issue #2701): the grammar does not consume either trigger head.
// compiler-gap: Whenever you cast a noncreature spell (#7216)
// hand-tail: Whenever you cast your fourth noncreature spell each turn (#7255)
export const theFantasticar = defineCard(() => ({
    id: "ed0beb69-8441-4104-9990-81bd82f81f9a",
    name: "The Fantasticar",
    rarity: "rare",
    oracleText:
        "Flying\nWhenever you cast a noncreature spell, you may have The Fantasticar become an artifact creature until end of turn.\nWhenever you cast your fourth noncreature spell each turn, you may sacrifice The Fantasticar. If you do, create four 4/4 colorless Construct artifact creature tokens with flying and haste.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    subtypes: ["Vehicle"],
    power: 4,
    toughness: 4,
    // CR 702.9 Flying.
    staticAbilities: ["flying"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "the-fantasticar-animate",
            oracleText:
                "Whenever you cast a noncreature spell, you may have The Fantasticar become an artifact creature until end of turn.",
            scope: "you",
            filter: { excludeTypes: "Creature" },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Have The Fantasticar become an artifact creature until end of turn?",
                    bind: "$animate",
                },
                {
                    op: "if",
                    predicate: { binding: "$animate" },
                    then: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 4,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
        spellCastTrigger({
            id: "the-fantasticar-constructs",
            oracleText:
                "Whenever you cast your fourth noncreature spell each turn, you may sacrifice The Fantasticar. If you do, create four 4/4 colorless Construct artifact creature tokens with flying and haste.",
            scope: "you",
            condition: nthSpellOfTypeThisTurn(4, { excludeTypes: "Creature" }),
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Sacrifice The Fantasticar to create four 4/4 Construct tokens?",
                    bind: "$sacrifice",
                },
                {
                    op: "if",
                    predicate: { binding: "$sacrifice" },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { ref: "$source" },
                                filter: { type: "Artifact" },
                            },
                            then: [
                                {
                                    op: "sacrifice",
                                    target: { ref: "$source" },
                                },
                                {
                                    op: "createToken",
                                    token: {
                                        name: "Construct",
                                        types: ["Artifact", "Creature"],
                                        subtypes: ["Construct"],
                                        power: 4,
                                        toughness: 4,
                                        staticAbilities: ["flying", "haste"],
                                    },
                                    controller: "controller",
                                    count: 4,
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
}));
