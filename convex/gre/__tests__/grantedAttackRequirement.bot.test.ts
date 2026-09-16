// Bot seams of the grantable attack requirement (CR 508.1d, issue #1972).
//
// The engine side lives in `grantedAttackRequirement.test.ts`. Here: the Bot's
// declare-attackers enumeration honours a GRANTED requirement exactly like a
// printed one (never a declaration that leaves the creature home, never an
// empty move list), and the `grantAbility` Op's sign splits on its payload.
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";
import { enumerateMoves } from "../moves";
import { opBeneficence } from "../ai/opValuers";

const RECIPIENT_ID = "test-1972-bot-recipient";
registerTokenDefinition({
    id: RECIPIENT_ID,
    name: "Test Bot Recipient",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

/** p1 declaring attackers with two vanilla creatures; `forced` carries a
 *  granted (indefinite) attack requirement, `free` carries none. */
function board(forcedOverrides: Record<string, unknown> = {}): GameState {
    const forced = makeInstance(RECIPIENT_ID, {
        id: "forced",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        grantedAttackRequirements: [{ seq: 1 }],
        ...forcedOverrides,
    });
    const free = makeInstance(RECIPIENT_ID, {
        id: "free",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    return makeState({
        turn: 3,
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [forced, free] }),
            makePlayer("p2"),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function declarations(state: GameState): string[][] {
    return enumerateMoves(state, "p1")
        .filter((m) => m.kind === "declare-attackers")
        .map((m) => (m.kind === "declare-attackers" ? m.attackerIds : []));
}

describe("enumerateMoves honours a granted attack requirement (CR 508.1d, issue #1972)", () => {
    it("every declare-attackers move includes the granted creature, and there is at least one", () => {
        const decls = declarations(board());
        expect(decls.length).toBeGreaterThan(0);
        for (const ids of decls) expect(ids).toContain("forced");
        // The voluntary creature stays optional — both shapes are offered.
        expect(decls.some((ids) => !ids.includes("free"))).toBe(true);
        expect(decls.some((ids) => ids.includes("free"))).toBe(true);
    });

    it("a granted creature that can't attack is not forced, and the Bot still has moves", () => {
        const decls = declarations(board({ isTapped: true }));
        expect(decls.length).toBeGreaterThan(0);
        for (const ids of decls) expect(ids).not.toContain("forced");
    });
});

describe("opBeneficence — `grantAbility` splits on its payload (issue #1972)", () => {
    it("a keyword grant is a gift; an attack-requirement grant is an attack", () => {
        expect(
            opBeneficence({
                op: "grantAbility",
                target: { target: 0 },
                ability: "flying",
            })
        ).toBe("beneficial");
        expect(
            opBeneficence({
                op: "grantAbility",
                target: { target: 0 },
                attackRequirement: true,
            })
        ).toBe("harmful");
    });
});
