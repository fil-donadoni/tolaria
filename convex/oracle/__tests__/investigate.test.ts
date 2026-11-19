// Investigate: "Investigate[ twice | <N> times | X times]" (CR 701.16a,
// issue #9949).
//
// CR 701.16a — "Investigate" means "Create a Clue token." The rule reads the
// keyword action into the predefined-token IR with the name fixed to Clue, so
// it lowers through the one name→spec table (`PREDEFINED_TOKEN_SPECS`) to
// exactly what the hand-written `investigateOp` builds.
//
//  1. GOLDEN fixtures — a real corpus card compiled whole, one per accepted
//     form: bare (Thraben Inspector), "twice" (Detective's Satchel's trigger,
//     on a sorcery stand-in for the line), a printed "<N> times" (Confirm
//     Suspicions), announced "X times" (Follow Him).
//  2. GOLD — the lowered Op equals `investigateOp()` / `investigateOp(_, N)`,
//     and the compiled Thraben Inspector equals the hand-written card.
//  3. REFUSALS — every count the rule does not bind.
//  4. FULL PATH — compiled text → GRE → `projectPublicState`: Clues on the
//     battlefield.

import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    CLUE_TOKEN_SPEC,
    investigateOp,
} from "../../cards/abilities/tokens/clueToken";
import { projectPublicState } from "../../gameProjections";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function sorcery(oracleText: string, manaCost = "{2}") {
    return oracleCard({
        name: "Test Investigate Sorcery",
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

const THRABEN_INSPECTOR: OracleCard = {
    oracleId: "caa02547-66e3-4e27-a2d3-5e94f3e7a069",
    name: "Thraben Inspector",
    manaCost: "{W}",
    typeLine: "Creature — Human Soldier",
    oracleText:
        'When this creature enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
    power: "1",
    toughness: "2",
    layout: "normal",
};

describe("investigate — golden fixtures (CR 701.16a)", () => {
    it("bare — Thraben Inspector's enters trigger", () => {
        expect(compiled(THRABEN_INSPECTOR)).toEqual({
            name: "Thraben Inspector",
            types: ["Creature"],
            subtypes: ["Human", "Soldier"],
            manaCost: { W: 1 },
            power: 1,
            toughness: 2,
            oracleText: THRABEN_INSPECTOR.oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "thraben-inspector-trigger",
                    oracleText: "When this creature enters, investigate.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: CLUE_TOKEN_SPEC,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it('"twice" — Armed with Proof\'s enters trigger, read alone', () => {
        const oracleText =
            'When this enchantment enters, investigate twice. (To investigate, create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")';
        expect(
            compiled({
                oracleId: "b401a490-d25f-4029-bb91-8999e140c6a1",
                name: "Armed with Proof",
                manaCost: "{2}{W}",
                typeLine: "Enchantment",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Armed with Proof",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 1 },
            oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "armed-with-proof-trigger",
                    oracleText:
                        "When this enchantment enters, investigate twice.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: CLUE_TOKEN_SPEC,
                            controller: "controller",
                            count: 2,
                        },
                    ],
                },
            ],
        });
    });

    it('"<N> times" — Confirm Suspicions', () => {
        const oracleText =
            'Counter target spell.\nInvestigate three times. (To investigate, create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")';
        const definition = compiled({
            oracleId: "a30d076b-c942-45e4-b943-3749ce955291",
            name: "Confirm Suspicions",
            manaCost: "{3}{U}{U}",
            typeLine: "Instant",
            oracleText,
            layout: "normal",
        });
        expect(definition.effects?.[definition.effects.length - 1]).toEqual({
            op: "createToken",
            token: CLUE_TOKEN_SPEC,
            controller: "controller",
            count: 3,
        });
    });

    it('"X times" — the announced X (CR 107.3)', () => {
        expect(
            compiled(sorcery("Investigate X times.", "{X}{U}{U}")).effects
        ).toEqual([
            {
                op: "createToken",
                token: CLUE_TOKEN_SPEC,
                controller: "controller",
                count: { X: true },
            },
        ]);
    });
});

describe("investigate — gold: the lowering is investigateOp", () => {
    it.each([
        ["Investigate.", investigateOp()],
        ["Investigate twice.", investigateOp("controller", 2)],
        ["Investigate four times.", investigateOp("controller", 4)],
    ])("%s", (text, op) => {
        expect(compiled(sorcery(text)).effects).toEqual([op]);
    });

    it("the compiled Thraben Inspector's script equals the hand-written card's", () => {
        const handWritten = getDefinition(
            "d140c3b7-ca78-483d-baeb-307b624fea8b"
        );
        expect(handWritten.name).toBe("Thraben Inspector");
        expect(
            compiled(THRABEN_INSPECTOR).compiledTriggeredAbilities?.[0]?.effects
        ).toEqual(handWritten.triggeredAbilities?.[0]?.effects);
    });
});

describe("investigate — refusals (fail-closed)", () => {
    it.each([
        ['"that many times"', "Investigate that many times."],
        [
            '"for each" (a count the rule does not bind)',
            "Investigate for each opponent who lost life this turn.",
        ],
        [
            '"once for each"',
            "Investigate once for each nontoken attacking creature.",
        ],
        [
            '"X times, where X is …"',
            "Investigate X times, where X is the number of opponents you have.",
        ],
        ['"two times" (printed "twice")', "Investigate two times."],
        ['"once"', "Investigate once."],
    ])("%s: %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });

    it("an X count on a site that announces no X is refused (CR 107.3)", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Test X Investigate Creature",
                    oracleText:
                        "When this creature enters, investigate X times.",
                })
            ).state
        ).toBe("unparsed");
    });
});

describe("investigate — full path (CR 701.16a, CR 111.10f)", () => {
    const outcome = compileCard(sorcery("Investigate twice."));
    if (outcome.state !== "ready")
        throw new Error(`not ready: ${JSON.stringify(outcome)}`);
    const id = "test-investigate-sorcery";
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: 2 },
        types: ["Sorcery"],
        effects: outcome.definition.effects,
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    pushSpell(state, id, "p1", []);
    resolveTopOfStack(state);

    it("the GRE puts two Clues with their sacrifice-draw ability onto the battlefield", () => {
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact"]);
            expect(token.subtypes).toEqual(["Clue"]);
            const definition = getDefinition((token.card as { id: string }).id);
            expect(definition.activatedAbilities?.map((a) => a.id)).toEqual([
                "sacrifice-draw",
            ]);
        }
    });

    it("the projection the client reads keeps them Clue artifacts", () => {
        const projected = projectPublicState(state, 1, "p1");
        const tokens = projected.players[0]!.battlefield.filter(
            (c) => c.isToken
        );
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact"]);
            expect(token.subtypes).toEqual(["Clue"]);
        }
    });
});
