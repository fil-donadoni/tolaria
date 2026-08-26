// Identity v4 board-chrome derivations (ADR 0103, issue #2727). These three
// helpers are the whole decision layer behind the plaque states and the
// mid-board line: everything else in the slice is class strings. Keeping the
// decisions here — pure, no React — is what makes the precedence assertable
// at all (a rendered plaque only ever shows the WINNER, so a test through the
// component cannot see that `attacked` beat `low`, only that `attacked` won).
import { describe, it, expect } from "vitest";
import type { Combat } from "~/types/game";
import {
    V4_LOW_LIFE_THRESHOLD,
    isCombatLineHot,
    isUnderAttack,
    plaqueState,
} from "~/lib/board-chrome-v4";

function makeCombat(overrides: Partial<Combat> = {}): Combat {
    return {
        attackerIds: [],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...overrides,
    };
}

describe("plaqueState precedence (ADR 0103, issue #2727)", () => {
    it("attacked wins over low life — being attacked at 3 life is still first an attack", () => {
        expect(
            plaqueState({ hasPriority: true, underAttack: true, life: 3 })
        ).toBe("attacked");
    });

    it("low life wins over active — the number is the more urgent thing to say", () => {
        expect(
            plaqueState({
                hasPriority: true,
                underAttack: false,
                life: V4_LOW_LIFE_THRESHOLD,
            })
        ).toBe("low");
    });

    it("active is the quietest of the three", () => {
        expect(
            plaqueState({ hasPriority: true, underAttack: false, life: 20 })
        ).toBe("active");
    });

    it("a resting plaque has no state at all — not a fourth string", () => {
        expect(
            plaqueState({ hasPriority: false, underAttack: false, life: 20 })
        ).toBeNull();
    });

    it("the low-life threshold is inclusive, and one above it is not low", () => {
        const at = plaqueState({
            hasPriority: false,
            underAttack: false,
            life: V4_LOW_LIFE_THRESHOLD,
        });
        const above = plaqueState({
            hasPriority: false,
            underAttack: false,
            life: V4_LOW_LIFE_THRESHOLD + 1,
        });
        expect(at).toBe("low");
        expect(above).toBeNull();
    });
});

describe("isUnderAttack (CR 506.2 / 508.1a)", () => {
    it("the NON-active player is the one under attack once attackers are declared", () => {
        const combat = makeCombat({ attackerIds: ["bear"] });
        expect(isUnderAttack(combat, "defender", "attacker")).toBe(true);
    });

    it("the ACTIVE player is never under attack — they are the one attacking", () => {
        const combat = makeCombat({ attackerIds: ["bear"] });
        expect(isUnderAttack(combat, "attacker", "attacker")).toBe(false);
    });

    it("an empty attacker list is not an attack, however far combat has got", () => {
        const combat = makeCombat({ attackerIds: [], confirmed: true });
        expect(isUnderAttack(combat, "defender", "attacker")).toBe(false);
    });

    it("no combat at all is not an attack", () => {
        expect(isUnderAttack(undefined, "defender", "attacker")).toBe(false);
    });
});

describe("isCombatLineHot (CR 508 — the declare-attackers window)", () => {
    it("is hot while the declaration is still open, before any attacker is chosen", () => {
        expect(isCombatLineHot(makeCombat({ confirmed: false }))).toBe(true);
    });

    it("stays hot after the declaration is locked in, while attackers are on the board", () => {
        expect(
            isCombatLineHot(
                makeCombat({ confirmed: true, attackerIds: ["bear"] })
            )
        ).toBe(true);
    });

    it("goes cold on a confirmed combat with no attackers — nobody attacked", () => {
        expect(
            isCombatLineHot(makeCombat({ confirmed: true, attackerIds: [] }))
        ).toBe(false);
    });

    it("is cold outside combat entirely", () => {
        expect(isCombatLineHot(undefined)).toBe(false);
    });
});
