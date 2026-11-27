// The casting window — "Cast this spell only during combat [after blockers
// are declared]." (CR 601.3, CR 506.1, CR 509.1), the spell slot's
// `cast window` line, lowered onto `CardDefinition.castPhaseRestriction`.
//
//  1. GOLDEN — Chaotic Strike compiled whole (the "after blockers" form).
//  2. The bare "during combat" form, read off Spinal Embrace's printed line:
//     no corpus card printing it compiles whole yet (each carries another
//     gap), so the slot's reading is pinned against the six combat steps, and
//     the real card's compile is shown to consume the line.
//  3. REFUSALS — the neighbouring windows stay unparsed.
//  4. BEHAVIOUR — the compiled window, registered as-is, gates the cast
//     through the engine's one phase check (`passesCastPhaseRestriction`).

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { passesCastPhaseRestriction } from "../../gre/rules";
import type { Phase } from "../../gre/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { spellSlot } from "../grammar/slots/spell";
import { oracleCard, parseContext } from "./oracle.fixture";

const AFTER_BLOCKERS_LINE =
    "Cast this spell only during combat after blockers are declared.";
const DURING_COMBAT_LINE = "Cast this spell only during combat.";

const CHAOTIC_STRIKE_TEXT = `${AFTER_BLOCKERS_LINE}\nFlip a coin. If you win the flip, target creature gets +1/+1 until end of turn.\nDraw a card.`;

const CHAOTIC_STRIKE = oracleCard({
    oracleId: "1f0b3549-2d24-49e8-85bc-55e3a5e5f6b8",
    name: "Chaotic Strike",
    manaCost: "{1}{R}",
    typeLine: "Instant",
    oracleText: CHAOTIC_STRIKE_TEXT,
    power: undefined,
    toughness: undefined,
});

const SPINAL_EMBRACE = oracleCard({
    name: "Spinal Embrace",
    manaCost: "{3}{U}{U}{B}",
    typeLine: "Instant",
    oracleText: `${DURING_COMBAT_LINE}\nUntap target creature you don't control and gain control of it. It gains haste until end of turn. At the beginning of the next end step, sacrifice it. If you do, you gain life equal to its toughness.`,
    power: undefined,
    toughness: undefined,
});

const AFTER_BLOCKERS: Phase[] = [
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
];

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

function refused(line: string) {
    return compileCard(
        oracleCard({
            name: "Probe Strike",
            manaCost: "{R}",
            typeLine: "Instant",
            oracleText: `${line}\nDraw a card.`,
            power: undefined,
            toughness: undefined,
        })
    ).state;
}

describe("cast window — golden fixture (CR 601.3, CR 509.1)", () => {
    it("Chaotic Strike: castable from the declare blockers step to the end of combat", () => {
        expect(sortKeys(compiled(CHAOTIC_STRIKE))).toEqual(
            sortKeys({
                name: "Chaotic Strike",
                types: ["Instant"],
                manaCost: { X: 1, R: 1 },
                oracleText: CHAOTIC_STRIKE_TEXT,
                castPhaseRestriction: AFTER_BLOCKERS,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [
                    {
                        op: "coinFlip",
                        win: {
                            consequence:
                                "Target creature gets +1/+1 until end of turn.",
                            effects: [
                                {
                                    op: "pump",
                                    target: { target: 0 },
                                    power: 1,
                                    toughness: 1,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        loss: { consequence: "Nothing happens.", effects: [] },
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
            })
        );
    });
});

describe("cast window — the bare combat window (CR 506.1)", () => {
    it("reads every step of the combat phase", () => {
        const parsed = spellSlot.run(
            DURING_COMBAT_LINE,
            parseContext(SPINAL_EMBRACE)
        );
        expect(parsed.ok && parsed.value).toEqual({
            kind: "cast-window",
            phases: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
                "FIRST_STRIKE_DAMAGE",
                "COMBAT_DAMAGE",
                "END_OF_COMBAT",
            ],
        });
    });

    it("consumes Spinal Embrace's window line: its remaining gaps are elsewhere", () => {
        const outcome = compileCard(SPINAL_EMBRACE);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.line)).not.toContain(
            DURING_COMBAT_LINE
        );
    });
});

describe("cast window — refusals (fail-closed)", () => {
    it.each([
        "Cast this spell only during combat before blockers are declared.",
        "Cast this spell only during combat on your turn.",
        "Cast this spell only during combat on an opponent's turn.",
        "Cast this spell only during your turn.",
    ])("refuses %s", (line) => {
        expect(refused(line)).toBe("unparsed");
    });

    it("refuses the window on a permanent (CR 113.3a)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe Bear",
                oracleText: DURING_COMBAT_LINE,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("cast window — the cast gate (CR 601.3)", () => {
    const STRIKE_ID = "4585aaaa-1111-4111-8111-111111111111";
    const strike = (): CardDefinition => ({
        ...compiled(CHAOTIC_STRIKE),
        id: STRIKE_ID,
        rarity: "uncommon",
    });

    function castable(phase: Phase): boolean {
        return withTemporaryDefinition(strike(), () => {
            const state = makeState({
                players: [makePlayer("p1"), makePlayer("p2")],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase,
            });
            const card = makeInstance(STRIKE_ID, {
                id: "strike",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            return passesCastPhaseRestriction(state, card);
        });
    }

    it("admits every step from declare blockers to the end of combat", () => {
        for (const phase of AFTER_BLOCKERS) expect(castable(phase)).toBe(true);
    });

    it("refuses the steps before blockers are declared, and outside combat", () => {
        for (const phase of [
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "POSTCOMBAT_MAIN",
        ] as const)
            expect(castable(phase)).toBe(false);
    });
});
