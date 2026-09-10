// Exert — CR 701.43. The mechanic's own tests; the two CARDS that carry it are
// tested in their set files (`sets/akh/__tests__/red.test.ts` for the optional
// attack cost, `sets/mh3/__tests__/colorless.test.ts` for the cost leg).

import { describe, it, expect } from "vitest";
import {
    exertPermanent,
    exertableAttackerIds,
    mayExertAsAttacks,
    payDeclaredExertCosts,
    payExertActivationCost,
} from "../exert";
import { advancePhase } from "../phases";
import { makeInstance, makeState } from "../../cards/__tests__/setup";

const GLORYBRINGER = "3277ad99-5682-4baa-b106-de15721876a6";
const ARENA_OF_GLORY = "dd148edc-9e43-41aa-bb50-f912115d3e72";
/** Grizzly Bears — a vanilla creature that offers no exert. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

describe("exert (CR 701.43)", () => {
    it("CR 701.43a — exerting stamps the one-shot skip and emits PERMANENT_EXERTED", () => {
        const dragon = makeInstance(GLORYBRINGER, { isTapped: true });
        const event = exertPermanent(dragon, true);
        expect(dragon.skipNextUntap).toBe(true);
        expect(event).toMatchObject({
            type: "PERMANENT_EXERTED",
            permanentId: dragon.id,
            controllerId: "p1",
            asAttacks: true,
        });
        expect(
            event.type === "PERMANENT_EXERTED" && event.permanentTypes
        ).toContain("Creature");
    });

    it("CR 701.43b — a permanent can be exerted while UNTAPPED, and exerted again before its next untap step", () => {
        const dragon = makeInstance(GLORYBRINGER, { isTapped: false });
        exertPermanent(dragon, true);
        expect(dragon.skipNextUntap).toBe(true);
        expect(dragon.isTapped).toBe(false);
        // Re-exerting is legal and does not throw; both not-untap effects
        // expire during the SAME untap step, which a single boolean models.
        const second = exertPermanent(dragon, true);
        expect(second.type).toBe("PERMANENT_EXERTED");
        expect(dragon.skipNextUntap).toBe(true);
    });

    it("CR 701.43a/b — the exerted permanent misses exactly ONE untap step, then untaps normally", () => {
        const dragon = makeInstance(GLORYBRINGER, { isTapped: true });
        exertPermanent(dragon, true);
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        state.players[0].battlefield = [dragon];

        // Into p2's turn and back around to p1's untap step.
        advancePhase(state);
        while (!(state.activePlayerId === "p1" && state.turn >= 3)) {
            advancePhase(state);
        }
        expect(dragon.isTapped).toBe(true);
        expect(dragon.skipNextUntap).toBeUndefined();

        // The FOLLOWING untap step untaps it normally.
        while (!(state.activePlayerId === "p1" && state.turn >= 5)) {
            advancePhase(state);
        }
        expect(dragon.isTapped).toBe(false);
    });

    it("CR 701.43d — only a card declaring the static ability offers the attack choice", () => {
        expect(mayExertAsAttacks(makeInstance(GLORYBRINGER))).toBeDefined();
        expect(mayExertAsAttacks(makeInstance(BEARS))).toBeUndefined();
        // CR 701.43a exerts a PERMANENT, but Arena of Glory pays its exert as
        // an activation cost, never as an attack cost — no offer here.
        expect(mayExertAsAttacks(makeInstance(ARENA_OF_GLORY))).toBeUndefined();
    });

    it("CR 508.1g — only DECLARED attackers that offer exert are exertable, and only before the declaration is confirmed", () => {
        const dragon = makeInstance(GLORYBRINGER);
        const bears = makeInstance(BEARS);
        const state = makeState({ phase: "DECLARE_ATTACKERS" });
        state.players[0].battlefield = [dragon, bears];
        state.combat = {
            attackerIds: [dragon.id, bears.id],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        expect(exertableAttackerIds(state)).toEqual([dragon.id]);

        // Not declared → not offered.
        state.combat.attackerIds = [bears.id];
        expect(exertableAttackerIds(state)).toEqual([]);

        // Confirmed → the window is closed (CR 508.1g happens as attackers are
        // declared, not afterwards).
        state.combat.attackerIds = [dragon.id];
        state.combat.confirmed = true;
        expect(exertableAttackerIds(state)).toEqual([]);
    });

    it("CR 508.1g — paying the declared costs exerts the chosen attackers and drops ids that are no longer attacking", () => {
        const dragon = makeInstance(GLORYBRINGER);
        const ghost = makeInstance(GLORYBRINGER);
        const state = makeState({ phase: "DECLARE_ATTACKERS" });
        state.players[0].battlefield = [dragon];
        state.combat = {
            attackerIds: [dragon.id],
            // `ghost` was toggled and then dropped from the declaration by the
            // CR 508.1c/1d fold — a cost is never paid for a non-attacker.
            exertedIds: [dragon.id, ghost.id],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        const events = payDeclaredExertCosts(state);
        expect(events).toHaveLength(1);
        expect(dragon.skipNextUntap).toBe(true);
        expect(ghost.skipNextUntap).toBeUndefined();
        expect(state.combat.exertedIds).toEqual([dragon.id]);
    });

    it("CR 602.1a — the activation-cost leg queues its event and reports whether IT exerted the source", () => {
        const land = makeInstance(ARENA_OF_GLORY, { isTapped: false });
        const state = makeState();
        state.players[0].battlefield = [land];

        expect(payExertActivationCost(state, land)).toBe(true);
        expect(land.skipNextUntap).toBe(true);
        expect(state.pendingEvents).toHaveLength(1);
        expect(state.pendingEvents?.[0]).toMatchObject({
            type: "PERMANENT_EXERTED",
            permanentId: land.id,
            asAttacks: false,
        });

        // CR 701.43b — a second exert is legal, but it is not what set the
        // flag, so the reversible payment path must not claim it.
        expect(payExertActivationCost(state, land)).toBe(false);
        expect(state.pendingEvents).toHaveLength(2);
    });
});
