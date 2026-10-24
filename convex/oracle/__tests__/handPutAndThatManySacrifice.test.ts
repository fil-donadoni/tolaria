// "Put a <Subtype> permanent card from your hand onto the battlefield" and
// "Sacrifice that many permanents" (issue #5203, CR 400.7 / CR 205.3 /
// CR 701.21a / CR 120.3).
//
//  1. GOLDENS — each accepted form is the trigger line of a real corpus card
//     (Goblin Lackey, Phyrexian Negator), compared with `sortKeys` equality.
//     Both are also `GOLDEN_FIXTURES` rows: the canned smoke scenario cannot
//     size a runtime `count` nor stage a hand→battlefield move.
//  2. GOLD — Goblin Lackey's compiled ability equals the hand-written one's
//     effect script (same filter, same 0..1 pick), so no divergence row.
//  3. REFUSALS — the neighbours the rules must NOT read.

import { describe, expect, it } from "vitest";
import { goblinLackey } from "../../cards/sets/usg/red.cards";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const LACKEY =
    "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.";
const NEGATOR =
    "Whenever this creature is dealt damage, sacrifice that many permanents.";

function effectsOf(oracleText: string, typeLine = "Creature — Goblin") {
    const outcome = compileCard(
        oracleCard({ name: "Probe", typeLine, oracleText, manaCost: "{R}" })
    );
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition.compiledTriggeredAbilities?.[0]?.effects;
}

const refused = (oracleText: string) =>
    compileCard(
        oracleCard({
            name: "Probe",
            typeLine: "Creature — Goblin",
            manaCost: "{R}",
            oracleText,
        })
    ).state === "unparsed";

describe("hand put and that-many sacrifice — goldens (issue #5203)", () => {
    it("Goblin Lackey: a 0..1 pick of a Goblin non-instant/sorcery card, then the move", () => {
        expect(sortKeys(effectsOf(LACKEY))).toEqual(
            sortKeys([
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: {
                        subtype: "Goblin",
                        excludeType: ["Instant", "Sorcery"],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "You may put a Goblin permanent card from your hand onto the battlefield.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ])
        );
    });

    it("Goblin Lackey: the compiled script equals the hand-written one", () => {
        const handWritten = goblinLackey().triggeredAbilities?.[0]?.effects;
        expect(sortKeys(effectsOf(LACKEY))).toEqual(sortKeys(handWritten));
    });

    it("Phyrexian Negator: the edict is sized by the damage the head carried", () => {
        expect(
            sortKeys(effectsOf(NEGATOR, "Creature — Phyrexian Horror"))
        ).toEqual(
            sortKeys([
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "controller",
                    zone: "battlefield",
                    // "permanents" is the whole permanent-type list, as the
                    // shared descriptor reads it (the `sacrifice` frame's
                    // one spelling; the retired kind wrote `{}`).
                    filter: {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                    },
                    count: { ref: "$event.amount" },
                    prompt: "Sacrifice that many permanents.",
                    bind: "$sacrifice1",
                },
                { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
            ])
        );
    });
});

describe("hand put and that-many sacrifice — refusals (issue #5203)", () => {
    it("refuses a word that is not a creature type", () => {
        expect(
            refused(LACKEY.replace("Goblin permanent", "Artifact permanent"))
        ).toBe(true);
    });

    it("refuses the unconditional put (no 'may' is not a printed form)", () => {
        expect(refused(LACKEY.replace("you may put", "put"))).toBe(true);
    });

    it("'that many' of a narrower noun is the same quantity on another descriptor (the `sacrifice` frame composes them)", () => {
        expect(refused(NEGATOR.replace("permanents", "creatures"))).toBe(false);
        expect(
            effectsOf(
                NEGATOR.replace("permanents", "creatures"),
                "Creature — Phyrexian Horror"
            )?.[0]
        ).toMatchObject({
            op: "choice",
            filter: { type: "Creature" },
            count: { ref: "$event.amount" },
            prompt: "Sacrifice that many creatures.",
        });
    });

    it("refuses 'that many' behind a head that carries no amount", () => {
        expect(
            refused(
                "Whenever this creature attacks, sacrifice that many permanents."
            )
        ).toBe(true);
    });
});
