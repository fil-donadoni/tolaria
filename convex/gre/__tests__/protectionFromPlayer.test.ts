import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    PROTECTION_FROM_EACH_OPPONENT,
    hasProtectionFromEachOpponent,
    isProtectedFrom,
    isProtectedFromController,
    isProtectedFromSource,
} from "../protection";
import { validateBlockerEligibility } from "../combat";
import { getLegalTargets } from "../rules";

// CR 702.16k — protection from a PLAYER ("protection from each of your
// opponents", Figure of Fable's final stage, issue #1748). The quality is
// re-derived live from the protected permanent's OWN controller, so a
// control-change effect moves the protection with the permanent.

/** A 1/1 with the player-quality protection, controlled by `controllerId`. */
function protectedCreature(controllerId: string) {
    return makeInstance("ce2d603a-3231-4a8c-bf39-1617586ea870", {
        id: "protected",
        controllerId,
        ownerId: controllerId,
        types: ["Creature"],
        subtypes: ["Kithkin"],
        power: 1,
        toughness: 1,
        staticAbilities: [PROTECTION_FROM_EACH_OPPONENT],
    });
}

function plainCreature(id: string, controllerId: string) {
    return makeInstance("ce2d603a-3231-4a8c-bf39-1617586ea870", {
        id,
        controllerId,
        ownerId: controllerId,
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
        staticAbilities: [],
    });
}

describe("protection from each of your opponents (CR 702.16k)", () => {
    it("parses the player-quality ability off staticAbilities", () => {
        expect(hasProtectionFromEachOpponent(protectedCreature("p1"))).toBe(
            true
        );
        expect(hasProtectionFromEachOpponent(plainCreature("x", "p1"))).toBe(
            false
        );
    });

    it("bars an opponent's source but never the controller's own", () => {
        const target = protectedCreature("p1");
        expect(isProtectedFromController(target, "p2")).toBe(true);
        expect(isProtectedFromController(target, "p1")).toBe(false);
    });

    it("fails closed when the source controller is unknown", () => {
        // A colour-only call site passes no controller — it must not silently
        // start barring every source.
        expect(
            isProtectedFrom(protectedCreature("p1"), {
                colors: ["R"],
                types: ["Instant"],
                supertypes: [],
                controllerId: undefined,
            })
        ).toBe(false);
        expect(
            isProtectedFromController(protectedCreature("p1"), undefined)
        ).toBe(false);
    });

    it("moves with the permanent on a control change (CR 109.4)", () => {
        // Same card, now controlled by p2: p2's own spells are fine again and
        // p1's are barred — the opponent set is re-derived, never frozen.
        const stolen = protectedCreature("p2");
        expect(isProtectedFromController(stolen, "p1")).toBe(true);
        expect(isProtectedFromController(stolen, "p2")).toBe(false);
    });

    it("bars an opponent-controlled source regardless of its colour", () => {
        const target = protectedCreature("p1");
        const opponentSource = plainCreature("src", "p2");
        const ownSource = plainCreature("own", "p1");
        expect(isProtectedFromSource(target, opponentSource)).toBe(true);
        expect(isProtectedFromSource(target, ownSource)).toBe(false);
    });

    it("CR 702.16b — an opponent can't target it, its controller can", () => {
        const target = protectedCreature("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const requirement = { type: "Creature" as const, count: 1 };
        const forOpponent = getLegalTargets(state, requirement, ["R"], "p2");
        expect(forOpponent.some((t) => t.id === "protected")).toBe(false);
        const forController = getLegalTargets(state, requirement, ["R"], "p1");
        expect(forController.some((t) => t.id === "protected")).toBe(true);
    });

    it("CR 702.16f — an opponent's creature can't block it", () => {
        const attacker = protectedCreature("p1");
        attacker.isAttacking = true;
        const blocker = plainCreature("blocker", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        const verdict = validateBlockerEligibility(
            attacker,
            blocker,
            [blocker],
            state
        );
        expect(verdict.eligible).toBe(false);
    });
});
