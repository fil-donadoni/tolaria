// The four Composition Rules of the compositional pilot (issue #6557,
// CR 608.2c), generalised from the idioms that bound each to one head:
//
//  1. the `, then` / `. Then` CHAIN between any two members the sentence
//     grammar reads (was: after a token-creation head only);
//  2. the LEADING DURATION applied to every member (was: spelled into a few
//     whole-sentence shapes);
//  3. the OBJECT PRONOUN bound to the last frame that produced a referent,
//     refused with none (`verbFrames.test.ts` carries its fixtures);
//  4. `If you do,` gating the member before it as a paid cost (CR 118.12; was:
//     three head-bound kinds).
//
// Each connector has a real-card fixture where the corpus prints one and a
// property test on its semantics — order, duration on every member, the
// gate — run through the real compiler, never a hand-built IR.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sentenceRule } from "../grammar/shared/effectClause";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}
const sorcery = (name: string, manaCost: string, oracleText: string) =>
    oracleCard({ name, manaCost, typeLine: "Sorcery", oracleText });
const ops = (card: ReturnType<typeof oracleCard>) =>
    (compiledDefinition(card).effects ?? []).map((e) => e.op);

describe("the `, then` chain — any head, printed order (CR 608.2c)", () => {
    it("fixture: Foresee — Scry 4, then draw two cards", () => {
        const text = "Scry 4, then draw two cards.";
        expect(compiledDefinition(sorcery("Foresee", "{3}{U}", text))).toEqual({
            name: "Foresee",
            types: ["Sorcery"],
            manaCost: { X: 3, U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 4,
                    destination: "library-bottom",
                },
                { op: "draw", player: "controller", count: 2 },
            ],
        });
    });

    it("order: the two members lower in the order written, whichever order that is", () => {
        expect(
            ops(sorcery("Probe", "{U}", "Scry 2, then draw a card."))
        ).toEqual(["scryReorder", "draw"]);
        expect(
            ops(sorcery("Probe", "{U}", "Draw a card, then scry 2."))
        ).toEqual(["draw", "scryReorder"]);
    });

    it("a frame chain may be a member: the tail after a kind head", () => {
        expect(
            ops(
                sorcery(
                    "Probe",
                    "{B}",
                    "Draw a card, then search your library for a card, put that card into your hand, then shuffle."
                )
            )
        ).toEqual(["draw", "choice", "moveZone", "libraryLook"]);
    });

    it("a half the grammar cannot read refuses the sentence on that half", () => {
        const outcome = compileCard(
            sorcery("Probe", "{U}", "Scry 2, then frobnicate a card.")
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.attribution?.span).toBe(
                "Frobnicate a card"
            );
    });
});

describe("the `. Then` connector — a sentence-initial 'Then' opens a frame chain", () => {
    it("'Then that player shuffles.' folds onto the search of a target library before it", () => {
        expect(
            ops(
                sorcery(
                    "Probe",
                    "{1}{U}",
                    "Search target player's library for a card and exile it. Then that player shuffles."
                )
            )
        ).toEqual(["choice", "moveZone", "libraryLook"]);
    });

    it("with no such search before it, it is refused by name", () => {
        const outcome = compileCard(
            sorcery("Probe", "{U}", "Draw a card. Then that player shuffles.")
        );
        expect(outcome.state).toBe("unparsed");
        // Both sentences parse; the LIST is what refuses, so the attribution
        // is sentence assembly's (issue #3822).
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.attribution?.path).toEqual([
                "sentence assembly",
            ]);
    });

    it("a 'Then' chain whose pronoun has no referent in it is refused (the pronoun rule crosses no full stop)", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{B}",
                    "Search your library for a card, put that card into your hand. Then shuffle and put it on top."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("the leading duration — on every member (CR 611.2a)", () => {
    const read = (text: string) => sentenceRule.run(text, parseContext());

    it("equals the trailing spelling: 'Until end of turn, X becomes …' is 'X becomes … until end of turn'", () => {
        const leading = compiledDefinition(
            sorcery(
                "Probe",
                "{U}",
                "Until end of turn, target creature becomes the color of your choice."
            )
        );
        const trailing = compiledDefinition(
            sorcery(
                "Probe",
                "{U}",
                "Target creature becomes the color of your choice until end of turn."
            )
        );
        expect(leading.effects).toEqual(trailing.effects);
        expect(JSON.stringify(leading.effects)).toContain('"end-of-turn"');
    });

    it("lands on EVERY member of a chain, not the first alone", () => {
        const result = read(
            "Until end of turn, target creature becomes the color of your choice, then target creature becomes the color of your choice"
        );
        expect(result.ok).toBe(true);
        if (!result.ok || result.value.role !== "then-chain") return;
        expect(result.value.effects).toHaveLength(2);
        for (const effect of result.value.effects) {
            expect(effect.kind).toBe("set-color-choice");
            if (effect.kind === "set-color-choice")
                expect(effect.duration).toEqual({ kind: "end-of-turn" });
        }
    });

    it("refuses a member with no duration slot, and one already carrying its own", () => {
        for (const text of [
            "Until end of turn, draw a card",
            "Until end of turn, target creature becomes the color of your choice until end of turn",
            "Until end of turn, search your library for a card, put that card into your hand, then shuffle",
        ]) {
            const result = read(text);
            expect(result.ok, text).toBe(false);
        }
    });

    it("an exact shape that spells its own leading duration stays the table's — one reader, no ambiguity: Abeyance", () => {
        const text =
            "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities.\nDraw a card.";
        expect(
            compileCard(
                oracleCard({
                    name: "Abeyance",
                    manaCost: "{1}{W}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).state
        ).toBe("ready");
    });
});

describe("`If you do,` — the optional action is a cost, paid or not (CR 118.12)", () => {
    const creature = (name: string, oracleText: string) =>
        oracleCard({
            name,
            manaCost: "{2}{U}{U}",
            typeLine: "Creature — Phyrexian Bird",
            oracleText,
            power: "3",
            toughness: "1",
        });

    it("fixture: Impaler Shrike — 'you may sacrifice it. If you do, draw three cards.'", () => {
        const def = compiledDefinition(
            creature(
                "Impaler Shrike",
                "Flying\nWhenever this creature deals combat damage to a player, you may sacrifice it. If you do, draw three cards."
            )
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "mayPay",
                player: "controller",
                prompt: "Sacrifice it?",
                bind: "$may1",
            },
            {
                op: "if",
                predicate: { binding: "$may1" },
                then: [
                    {
                        op: "sacrifice",
                        target: { ref: "$source" },
                        bind: "$did2",
                    },
                    {
                        op: "if",
                        predicate: {
                            boundMatchesFilter: { ref: "$did2" },
                            filter: {},
                        },
                        then: [{ op: "draw", player: "controller", count: 3 }],
                    },
                ],
            },
        ]);
    });

    it("behind a `sacrifice` frame chain the edict's pick IS the evidence (issue #6630, CR 118.12): Forbidden Ritual's first pair", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Probe",
                manaCost: "{2}{B}{B}",
                typeLine: "Sorcery",
                oracleText:
                    "Sacrifice a nontoken permanent. If you do, draw a card.",
            })
        );
        expect(def.effects).toEqual([
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: "controller",
                zone: "battlefield",
                filter: {
                    type: [
                        "Artifact",
                        "Battle",
                        "Creature",
                        "Enchantment",
                        "Land",
                        "Planeswalker",
                    ],
                    isToken: false,
                },
                count: 1,
                prompt: "Sacrifice a nontoken permanent.",
                bind: "$sacrifice1",
            },
            // The sacrifice binds its first pick (the interpreter's CR 608.2h
            // snapshot); nothing picked, nothing bound, gate shut.
            {
                op: "sacrifice",
                permanents: { ref: "$sacrifice1" },
                bind: "$sacrificed2",
            },
            {
                op: "if",
                predicate: {
                    boundMatchesFilter: { ref: "$sacrificed2" },
                    filter: {},
                },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });

    it("the gate reads what YOU did: an opponent's edict, or a pick of more than one, is no evidence (CR 118.12, CR 118.3)", () => {
        const refusal = (oracleText: string) => {
            const outcome = compileCard(
                oracleCard({
                    name: "Probe",
                    manaCost: "{1}{B}",
                    typeLine: "Sorcery",
                    oracleText,
                })
            );
            return outcome.state === "unparsed"
                ? `unparsed: ${JSON.stringify(outcome.gaps)}`
                : outcome.state;
        };
        // The fold never fires: the sacrifice was the opponent's.
        expect(
            refusal(
                "Target opponent sacrifices a creature of their choice. If you do, draw a card."
            )
        ).toContain("unparsed");
        // Two picks bind the first alone: one creature given up would still
        // open the gate, so the pair is refused at the lowering.
        expect(
            refusal("Sacrifice two creatures. If you do, draw a card.")
        ).toContain("leaves no evidence");
        const optional = compileCard(
            creature(
                "Probe",
                "When this creature enters, you may sacrifice two creatures. If you do, draw a card."
            )
        );
        expect(optional.state).toBe("unparsed");
        if (optional.state === "unparsed")
            expect(JSON.stringify(optional.gaps)).toContain(
                "leaves no evidence"
            );
        // A sacrifice already gated on a payment is no cost of yours either.
        expect(
            refusal(
                "At the beginning of your upkeep, sacrifice this creature unless you pay {1}. If you do, draw a card."
            )
        ).toContain("unparsed");
    });

    it("the source form keeps its bind name: 'Sacrifice this enchantment. If you do, …' binds `$sacrificed1` as before the frame", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Probe",
                manaCost: "{1}{U}",
                typeLine: "Enchantment",
                oracleText:
                    "At the beginning of your upkeep, sacrifice this enchantment. If you do, draw a card.",
            })
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "sacrifice",
                target: { ref: "$source" },
                bind: "$sacrificed1",
            },
            {
                op: "if",
                predicate: {
                    boundMatchesFilter: { ref: "$sacrificed1" },
                    filter: {},
                },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });

    it("the gated effect runs only on the EVIDENCE the action was paid (CR 118.3), never on the answer alone", () => {
        const def = compiledDefinition(
            creature(
                "Probe",
                "When this creature enters, you may sacrifice it. If you do, you gain 1 life."
            )
        );
        const effects = def.compiledTriggeredAbilities?.[0]?.effects ?? [];
        expect(effects.map((e) => e.op)).toEqual(["mayPay", "if"]);
        const may = effects[1] as { then: { op: string; bind?: string }[] };
        expect(may.then.map((e) => e.op)).toEqual(["sacrifice", "if"]);
        const gate = may.then[1] as unknown as {
            predicate: unknown;
            then: { op: string }[];
        };
        // The gate reads the sacrifice's own bind: a source already gone
        // binds nothing, and the life is not gained.
        expect(gate.predicate).toEqual({
            boundMatchesFilter: { ref: may.then[0]!.bind },
            filter: {},
        });
        expect(gate.then.map((e) => e.op)).toEqual(["gainLife"]);
    });

    it("an optional action that leaves no evidence it was paid is refused by name: a draw", () => {
        for (const text of [
            "When this creature enters, you may draw a card. If you do, discard a card.",
        ]) {
            const outcome = compileCard(creature("Probe", text));
            expect(outcome.state, text).toBe("unparsed");
            if (outcome.state === "unparsed")
                expect(JSON.stringify(outcome.gaps), text).toMatch(
                    /leaves no evidence it was paid \(CR 118\.12\)/
                );
        }
    });

    it("refuses 'If you do' behind a member that always happens, or a second gate on one member", () => {
        for (const text of [
            "When this creature enters, draw a card. If you do, you gain 1 life.",
            "When this creature enters, you may sacrifice it. If you do, you gain 1 life. If you do, you gain 1 life.",
        ]) {
            const outcome = compileCard(creature("Probe", text));
            expect(outcome.state, text).toBe("unparsed");
            // Every sentence parses; the LIST refuses the gate (issue #3822).
            if (outcome.state === "unparsed")
                expect(outcome.gaps[0]?.attribution?.path, text).toEqual([
                    "sentence assembly",
                ]);
        }
    });

    it("the head-bound idioms still read as before: 'you may pay {1}. If you do, …' is the pay-mana kind", () => {
        const def = compiledDefinition(
            creature(
                "Probe",
                "When this creature enters, you may pay {1}. If you do, you gain 1 life."
            )
        );
        expect(
            def.compiledTriggeredAbilities?.[0]?.effects?.map((e) => e.op)
        ).toEqual(["mayPay", "if"]);
    });
});
