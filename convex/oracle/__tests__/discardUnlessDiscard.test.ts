// The `discard` Verb Frame: "Then discard two cards unless you discard a
// creature card" (CR 701.9a + CR 118.12a, issue #8589).
//
// Three layers:
//
//  1. GOLDEN forms — one real corpus card per argument class (the card type
//     word of the rider), compiled whole: the draw, then the `mayPay` HAND leg
//     filtered to the type and the `if not` discard of the count — CR
//     118.12a's "you may discard a creature card; if you don't, discard two
//     cards".
//  2. REFUSALS — printed neighbours the frame must NOT read, each pinned to
//     where the compiler gave up: a supertype, a type list, a subtype, a
//     payment that is no discard, a condition, a rider on another player.
//  3. NEIGHBOUR FRAME — the typed discard payment is the `discard` frame's
//     alone: "sacrifice it unless you discard a land card" stays refused.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

/** A real corpus spell row: no power or toughness. */
function spell(
    name: string,
    manaCost: string,
    typeLine: "Instant" | "Sorcery",
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        typeLine,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

/** WHERE the compiler gave up on a card it refuses. */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") {
        expect(outcome.gaps).toHaveLength(1);
        const gap = outcome.gaps[0]!;
        return gap.attribution === undefined
            ? gap.reason
            : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`;
    }
    throw new Error(`${card.name} parsed, but should not have`);
}

/** The draw-three, typed-discard-or-discard-two script every Thirst prints. */
function drawThenDiscardUnless(type: string, object: string) {
    return [
        { op: "draw", player: "controller", count: 3 },
        {
            op: "mayPay",
            player: "controller",
            cost: {
                hand: {
                    action: "discard",
                    requirements: [{ filter: { type }, count: 1 }],
                },
            },
            prompt: `Discard ${object} instead of two cards?`,
            bind: "$may1",
        },
        {
            op: "if",
            predicate: { not: { binding: "$may1" } },
            then: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discard2",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard2" },
                },
            ],
        },
    ];
}

describe("discard frame — golden forms (CR 701.9a + CR 118.12a)", () => {
    it("Mystic Meditation — unless you discard a creature card", () => {
        const oracleText =
            "Draw three cards. Then discard two cards unless you discard a creature card.";
        const outcome = compileCard(
            spell("Mystic Meditation", "{3}{U}", "Sorcery", oracleText)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Mystic Meditation",
            types: ["Sorcery"],
            manaCost: { X: 3, U: 1 },
            oracleText,
            effects: drawThenDiscardUnless("Creature", "a creature card"),
        });
    });

    it("Thirst for Knowledge — unless you discard an artifact card", () => {
        const oracleText =
            "Draw three cards. Then discard two cards unless you discard an artifact card.";
        const outcome = compileCard(
            spell("Thirst for Knowledge", "{2}{U}", "Instant", oracleText)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Thirst for Knowledge",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText,
            effects: drawThenDiscardUnless("Artifact", "an artifact card"),
        });
    });

    it("Thirst for Meaning — unless you discard an enchantment card", () => {
        const oracleText =
            "Draw three cards. Then discard two cards unless you discard an enchantment card.";
        const outcome = compileCard(
            spell("Thirst for Meaning", "{2}{U}", "Instant", oracleText)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition).toEqual({
            name: "Thirst for Meaning",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText,
            effects: drawThenDiscardUnless(
                "Enchantment",
                "an enchantment card"
            ),
        });
    });
});

describe("discard frame — refused neighbours (fail-closed)", () => {
    const draw = "Draw three cards. Then discard two cards unless you ";

    it("a supertype — Thirst for Discovery's basic land card", () => {
        expect(
            refusedAt(
                spell(
                    "Thirst for Discovery",
                    "{2}{U}",
                    "Instant",
                    `${draw}discard a basic land card.`
                )
            )
        ).toBe("effect clause: discard a basic land card");
    });

    it("a type list — Practical Research's instant or sorcery card", () => {
        expect(
            refusedAt(
                spell(
                    "Practical Research",
                    "{3}{U}{R}",
                    "Instant",
                    "Draw four cards. Then discard two cards unless you discard an instant or sorcery card."
                )
            )
        ).toBe("effect clause: discard an instant or sorcery card");
    });

    it("a subtype — a Pirate card", () => {
        expect(
            refusedAt(
                spell(
                    "Test Pirate Loot",
                    "{2}{U}",
                    "Instant",
                    `${draw}discard a Pirate card.`
                )
            )
        ).toBe("effect clause: discard a Pirate card");
    });

    it("a payment that is no discard — Tragic Lesson's return", () => {
        expect(
            refusedAt(
                spell(
                    "Tragic Lesson",
                    "{2}{U}",
                    "Instant",
                    "Draw two cards. Then discard a card unless you return a land you control to its owner's hand."
                )
            )
        ).toBe(
            "effect clause: Then discard a card unless you return a land you control to its owner's hand"
        );
    });

    it("an untyped discard — no printed form, never a rider here", () => {
        expect(
            refusedAt(
                spell(
                    "Test Untyped Loot",
                    "{2}{U}",
                    "Instant",
                    `${draw}discard a card.`
                )
            )
        ).toBe("effect clause: discard a card");
    });

    it("a condition — Chart a Course's attack", () => {
        expect(
            compileCard(
                spell(
                    "Chart a Course",
                    "{1}{U}",
                    "Sorcery",
                    "Draw two cards. Then discard a card unless you attacked this turn."
                )
            ).state
        ).toBe("unparsed");
    });

    it("another player's rider — Wrench Mind", () => {
        expect(
            compileCard(
                spell(
                    "Wrench Mind",
                    "{B}{B}",
                    "Sorcery",
                    "Target player discards two cards unless they discard an artifact card."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("the typed discard payment is the discard frame's alone", () => {
    it("Fallow Wurm — sacrifice it unless you discard a land card", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Fallow Wurm",
                    manaCost: "{2}{G}",
                    typeLine: "Creature — Wurm",
                    oracleText:
                        "When this creature enters, sacrifice it unless you discard a land card.",
                    power: "4",
                    toughness: "4",
                })
            ).state
        ).toBe("unparsed");
    });
});
