// Combat: attack a planeswalker (issue #1220, follow-up to the #700 loyalty
// framework / ADR 0058).
//
// Covers the declare-attackers attack target (CR 508.1a — each attacker chooses
// the defending player OR a planeswalker that player controls) and the combat
// damage routing (CR 120.3c / 509.1h — damage to a planeswalker removes loyalty;
// regular trample does NOT spill excess to the controller — "trample over
// planeswalkers" (CR 702.19f) is a distinct, out-of-scope keyword). Builds on
// #700's loyalty-removal path + 0-loyalty SBA (reused, not re-implemented).

import { describe, it, expect } from "vitest";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { applyAllCombatDamage, buildAutoDamageAssignments } from "../phases";
import { checkStateBasedActions } from "../sba";
import { assertLegalAttackTarget } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";

/** Minimal battlefield permanent with the slim `card: { id }` shape. */
function makeCard(
    overrides: Partial<CardInstanceState> & { types?: CardType[] } = {}
): CardInstanceState {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: { id: overrides.id ?? crypto.randomUUID() },
        types: overrides.types ?? [],
        subtypes: overrides.subtypes ?? [],
        power: overrides.power,
        toughness: overrides.toughness,
        staticAbilities: overrides.staticAbilities ?? [],
        controllerId: overrides.controllerId ?? "p1",
        ownerId: overrides.ownerId ?? overrides.controllerId ?? "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function planeswalker(id: string, loyalty: number): CardInstanceState {
    return makeCard({
        id,
        types: ["Planeswalker"],
        controllerId: "p2",
        ownerId: "p2",
        counters: { loyalty },
    });
}

function attacker(
    id: string,
    power: number,
    staticAbilities: string[] = []
): CardInstanceState {
    return makeCard({
        id,
        types: ["Creature"],
        power,
        toughness: power,
        staticAbilities,
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
}

/** A confirmed combat where p1's attackers attack p2. Attach `attackTargets`
 *  per-attacker to send an attacker at a planeswalker (CR 508.1a). */
function combatState(args: {
    attackers: CardInstanceState[];
    p2Battlefield: CardInstanceState[];
    attackTargets?: Record<string, string>;
    blockerAssignments?: Record<string, string[]>;
    blockedAttackerIds?: string[];
}): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: args.attackers }),
            makePlayer("p2", { battlefield: args.p2Battlefield }),
        ],
    });
    state.phase = "COMBAT_DAMAGE";
    state.combat = {
        attackerIds: args.attackers.map((a) => a.id),
        attackTargets: args.attackTargets,
        confirmed: true,
        blockerAssignments: args.blockerAssignments ?? {},
        blockersConfirmed: true,
        blockedAttackerIds: args.blockedAttackerIds,
    };
    return state;
}

function resolveRegularDamage(state: GameState): void {
    applyAllCombatDamage(
        state,
        buildAutoDamageAssignments(state, "regular"),
        "regular"
    );
    checkStateBasedActions(state);
}

describe("attack target validation (CR 508.1a, #1220)", () => {
    it("accepts a planeswalker the defending player controls", () => {
        const pw = planeswalker("pw", 3);
        expect(() => assertLegalAttackTarget([pw], "pw")).not.toThrow();
    });

    it("rejects a non-planeswalker permanent", () => {
        const creature = makeCard({
            id: "bear",
            types: ["Creature"],
            controllerId: "p2",
        });
        expect(() => assertLegalAttackTarget([creature], "bear")).toThrow(
            /must be a planeswalker/
        );
    });

    it("rejects an id that isn't on the defending battlefield", () => {
        expect(() => assertLegalAttackTarget([], "ghost")).toThrow(
            /must be a planeswalker/
        );
    });
});

describe("combat damage → planeswalker loyalty (CR 120.3c / 509.1h, #1220)", () => {
    it("an unblocked attacker attacking a planeswalker removes loyalty, not player life", () => {
        const atk = attacker("atk", 3);
        const pw = planeswalker("pw", 5);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);

        const pwAfter = state.players[1].battlefield.find((c) => c.id === "pw");
        expect(pwAfter?.counters?.loyalty).toBe(2);
        // Not marked as damage (a planeswalker has no toughness).
        expect(pwAfter?.damageMarked ?? 0).toBe(0);
        // The defending player takes no life loss.
        expect(state.players[1].life).toBe(startLife);
    });

    it("lethal loyalty loss sends the planeswalker to its owner's graveyard (0-loyalty SBA reused)", () => {
        const atk = attacker("atk", 3);
        const pw = planeswalker("pw", 3);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        resolveRegularDamage(state);

        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "pw")).toBe(
            true
        );
    });

    it("without an attack target the same attacker still hits the defending player", () => {
        const atk = attacker("atk", 3);
        const pw = planeswalker("pw", 5);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            // no attackTargets → attacks the player (default, CR 508.1a)
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);

        expect(state.players[1].life).toBe(startLife - 3);
        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")?.counters
                ?.loyalty
        ).toBe(5);
    });

    it("a planeswalker that left the battlefield before damage takes none — and it does NOT redirect to the player", () => {
        const atk = attacker("atk", 4);
        // Attack target points at a planeswalker that is no longer present.
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [],
            attackTargets: { atk: "gone-pw" },
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);
        expect(state.players[1].life).toBe(startLife);
    });
});

describe("trample over a planeswalker (CR 702.19f, #1220)", () => {
    it("an unblocked trampler assigns ALL its damage to the planeswalker — regular trample does NOT spill the excess to the controller", () => {
        const atk = attacker("atk", 5, ["trample"]);
        const pw = planeswalker("pw", 2);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);

        // The planeswalker dies (2 loyalty − 2 removed). Regular trample does
        // not carry over a planeswalker (CR 702.19f): the remaining 3 damage is
        // wasted, the controller takes nothing.
        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(startLife);
    });

    it("without trample the whole assignment stays on the planeswalker (no spill)", () => {
        const atk = attacker("atk", 5);
        const pw = planeswalker("pw", 2);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);
        // Planeswalker dies but the surplus is lost — the player takes nothing.
        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(startLife);
    });

    it("a blocked trampler attacking a planeswalker routes excess over its blocker onto the planeswalker's loyalty", () => {
        const atk = attacker("atk", 5, ["trample"]);
        const blocker = makeCard({
            id: "blk",
            types: ["Creature"],
            power: 1,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const pw = planeswalker("pw", 10);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [blocker, pw],
            attackTargets: { atk: "pw" },
            blockerAssignments: { blk: ["atk"] },
            blockedAttackerIds: ["atk"],
        });
        const startLife = state.players[1].life;
        resolveRegularDamage(state);

        // 2 lethal to the blocker, 3 excess → the planeswalker's loyalty.
        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")?.counters
                ?.loyalty
        ).toBe(7);
        // The blocker died; the player took no combat damage.
        expect(
            state.players[1].battlefield.find((c) => c.id === "blk")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(startLife);
    });
});

describe("attackTargets survives the wire projection + serialization (#1220)", () => {
    it("projectPublicState carries combat.attackTargets", () => {
        const atk = attacker("atk", 3);
        const pw = planeswalker("pw", 5);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat?.attackTargets).toEqual({ atk: "pw" });
    });

    it("round-trips through compact/expand serialization", () => {
        const atk = attacker("atk", 3);
        const pw = planeswalker("pw", 5);
        const state = combatState({
            attackers: [atk],
            p2Battlefield: [pw],
            attackTargets: { atk: "pw" },
        });
        const restored = expandState(compactState(state));
        expect(restored.combat?.attackTargets).toEqual({ atk: "pw" });
    });
});
