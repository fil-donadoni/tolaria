// The compiler's TRANSFORM layout (CR 712.8a / 712.8c / 712.8e, issue #7217)
// and the "Transform this creature." clause it needs (CR 701.27a).
//
// Four layers:
//
//  1. GOLDEN — real corpus rows compiled whole: the front face is the card,
//     the back face its nonmodal `backFace`, its colours read off the corpus
//     face (CR 202.2e), never off the front.
//  2. REFUSALS — a back face whose colours the corpus does not report (the
//     pinned corpus today, issue #7905), a back face carrying what a
//     `CardBackFace` cannot hold, a face count other than two, and a
//     transform aimed at anything but the source.
//  3. GAP AGGREGATION — both faces' gaps and the colour gap are reported
//     together, so the backlog ranks every line of a refused card.
//  4. GOLD round trip — `goldOracleCard` rebuilds a transform card's input
//     from its definition, back-face colours included.
//
// The corpus rows are copied from the pinned cache (gitignored); the back
// face's `colors` is Scryfall's `card_faces[].colors` for that card.

import { describe, expect, it } from "vitest";
import {
    compileCard,
    TRANSFORM_BACK_COLOR_REASON,
    TRANSFORM_LAYOUT,
} from "../compile";
import { sortKeys } from "../gates";
import { goldOracleCard } from "../gold";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CardDefinition } from "../../cards/types";
import type { OracleCard, OracleFace } from "../types";
import { oracleCard } from "./oracle.fixture";

const HERDBEAST = GOLDEN_FIXTURES.find((f) => f.rule === "transform-self")!;

/** Thraben Gargoyle // Stonewing Antagonizer, as the pinned corpus has it:
 *  no `colors` on either face. */
const GARGOYLE: OracleCard = {
    oracleId: "9b5cf592-8385-4115-b27a-98f42bdf6329",
    name: "Thraben Gargoyle // Stonewing Antagonizer",
    manaCost: "",
    typeLine:
        "Artifact Creature — Gargoyle // Artifact Creature — Gargoyle Horror",
    oracleText: "",
    layout: TRANSFORM_LAYOUT,
    faces: [
        {
            name: "Thraben Gargoyle",
            manaCost: "{1}",
            typeLine: "Artifact Creature — Gargoyle",
            oracleText: "Defender\n{6}: Transform this creature.",
            power: "2",
            toughness: "2",
        },
        {
            name: "Stonewing Antagonizer",
            manaCost: "",
            typeLine: "Artifact Creature — Gargoyle Horror",
            oracleText: "Flying",
            power: "4",
            toughness: "2",
        },
    ],
};

/** `card` with its back face's colours as Scryfall reports them. */
function withBackColors(card: OracleCard, colors: OracleFace["colors"]) {
    const [front, back] = card.faces!;
    return { ...card, faces: [front, { ...back, colors }] };
}

/** `card` with its back face replaced field by field. */
function withBack(card: OracleCard, back: Partial<OracleFace>): OracleCard {
    const [front, original] = card.faces!;
    return { ...card, faces: [front, { ...original, ...back }] };
}

const reasonsOf = (card: OracleCard): string[] => {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason)
        : [`(${outcome.state})`];
};

describe("CR 712.8a / 712.8e — a transform card compiles to its front face with a nonmodal backFace", () => {
    it("golden: Bonded Herdbeast — a back face coloured differently from its front (CR 202.2e)", () => {
        const outcome = compileCard(HERDBEAST.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(HERDBEAST.expected)
        );
        expect(outcome.opsUsed).toEqual(["transform"]);
    });

    it("golden: Thraben Gargoyle — a colourless back face carries no colors", () => {
        const outcome = compileCard(withBackColors(GARGOYLE, []));
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Thraben Gargoyle",
                types: ["Artifact", "Creature"],
                subtypes: ["Gargoyle"],
                manaCost: { X: 1 },
                power: 2,
                toughness: 2,
                oracleText: "Defender\n{6}: Transform this creature.",
                staticAbilities: ["defender"],
                activatedAbilities: [
                    {
                        id: "thraben-gargoyle-ability",
                        oracleText: "{6}: Transform this creature.",
                        cost: { mana: { X: 6 } },
                        useStack: true,
                        effects: [
                            { op: "transform", target: { ref: "$source" } },
                        ],
                    },
                ],
                backFace: {
                    name: "Stonewing Antagonizer",
                    types: ["Artifact", "Creature"],
                    subtypes: ["Gargoyle", "Horror"],
                    power: 4,
                    toughness: 2,
                    staticAbilities: ["flying"],
                    oracleText: "Flying",
                },
            })
        );
    });

    it("the back face's colours are the corpus face's, never the front face's", () => {
        const outcome = compileCard(withBackColors(GARGOYLE, ["U"]));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.backFace?.colors).toEqual(["U"]);
        expect(outcome.definition.backFace?.kind).toBeUndefined();
    });
});

describe("transform layout refusals (fail-closed)", () => {
    it("refuses a back face whose colours the corpus does not report", () => {
        expect(reasonsOf(GARGOYLE)).toEqual([TRANSFORM_BACK_COLOR_REASON]);
    });

    it("refuses a back face that compiles to a trigger a CardBackFace cannot hold", () => {
        const card = withBack(withBackColors(GARGOYLE, []), {
            oracleText:
                "Flying\nWhenever this creature attacks, you gain 1 life.",
        });
        expect(reasonsOf(card)).toEqual([
            "transform back face carries compiledTriggeredAbilities, which a CardBackFace cannot hold",
        ]);
    });

    it("refuses a card with other than two faces", () => {
        expect(reasonsOf({ ...GARGOYLE, faces: [GARGOYLE.faces![0]] })).toEqual(
            [`layout "transform" needs exactly two faces, got 1`]
        );
    });

    it("reports both faces' gaps and the colour gap together", () => {
        const card = {
            ...GARGOYLE,
            faces: [
                {
                    ...GARGOYLE.faces![0],
                    oracleText:
                        "Defender\nAt the beginning of your upkeep, look at the top card of your library.",
                },
                {
                    ...GARGOYLE.faces![1],
                    oracleText: "Flying\nThis creature dreams of nothing.",
                },
            ],
        };
        const reasons = reasonsOf(card);
        expect(reasons).toHaveLength(3);
        expect(reasons[reasons.length - 1]).toBe(TRANSFORM_BACK_COLOR_REASON);
    });
});

describe("CR 701.27a — the transform clause reads the source only", () => {
    const ability = (effect: string) =>
        compileCard(
            oracleCard({
                name: "Test Shifter",
                oracleText: `{2}: ${effect}`,
            })
        );

    it.each(["Transform this creature.", "Transform Test Shifter."])(
        "accepts %s",
        (effect) => {
            const outcome = ability(effect);
            if (outcome.state === "unparsed") throw new Error("unparsed");
            expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual(
                [{ op: "transform", target: { ref: "$source" } }]
            );
        }
    );

    it.each([
        "Transform target creature.",
        "Transform it.",
        "Transform each creature.",
    ])("refuses %s", (effect) => {
        expect(ability(effect).state).toBe("unparsed");
    });
});

describe("gold — goldOracleCard rebuilds a transform card's input", () => {
    it("round-trips the golden definition, back-face colours included", () => {
        const definition = {
            ...HERDBEAST.expected,
            id: "bonded-herdbeast",
            rarity: "common",
        } as CardDefinition;
        const rebuilt = goldOracleCard(definition);
        expect(rebuilt.layout).toBe(TRANSFORM_LAYOUT);
        expect(rebuilt.faces?.[1]?.colors).toEqual(["G", "R"]);
        const outcome = compileCard(rebuilt);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(HERDBEAST.expected)
        );
    });

    it("reads an absent back-face colors as the hand-written claim of colourless", () => {
        const rebuilt = goldOracleCard({
            ...HERDBEAST.expected,
            backFace: { ...HERDBEAST.expected.backFace!, colors: undefined },
            id: "bonded-herdbeast",
            rarity: "common",
        } as CardDefinition);
        expect(rebuilt.faces?.[1]?.colors).toEqual([]);
    });
});
