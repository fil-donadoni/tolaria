// Per-card test for tmp/red.ts — Mogg Fanatic. Same sacrifice-for-effect
// shape as nem Seal of Fire, but on a creature: the self-sacrifice cost
// (`cost.sacrifice: true`) is NOT a tap ability, so summoning sickness never
// gates it (CR 302.6 / 602.5b) — a Mogg Fanatic can ping the turn it enters.
// Exercised through the GRE entry point: pay the cost (move the source to the
// graveyard), then resolve the `dealDamage` off the stack-item clone.
import { describe, it, expect } from "vitest";
import { moggFanatic, jackalPup } from "..";
import { lightningBolt } from "../../lea/red";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import type { GameEvent } from "../../../types";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

/** Mirror of the game.ts commit path for a no-mana, no-tap self-sacrifice
 *  activated ability (`cost.sacrifice: true`): pay the cost by moving the
 *  source to the graveyard, then push the ability (a clone of the source) on
 *  the stack and resolve it. */
function sacrificeSelfActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    const stackItem: StackItem = {
        ...structuredClone(source),
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    };
    removePermanentTo(state, source.id, "graveyard");
    state.stack.push(stackItem);
    resolveTopOfStack(state);
}

describe("Mogg Fanatic (sacrifice-for-effect, CR 602.1 / 701.21 / 120.1)", () => {
    it("sacrifices itself to deal 1 damage to a player and lands in the graveyard", () => {
        const mogg = makeInstance(moggFanatic.id, {
            id: "mogg",
            controllerId: "p1",
            ownerId: "p1",
            // Summoning-sick: proves a sacrifice ability is unaffected (it is
            // not a tap ability).
            isSummoningSick: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "player", id: "p2" },
        ]);

        expect(getPlayer(state, "p2").life).toBe(19);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "mogg")
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "mogg")
        ).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("can ping a 1-toughness creature to death (any target)", () => {
        const mogg = makeInstance(moggFanatic.id, { id: "mogg" });
        const foe = makeInstance(moggFanatic.id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "permanent", id: "foe" },
        ]);

        // 1 damage to a 1/1 is lethal — the SBA sweep in resolveTopOfStack
        // moves it to the graveyard.
        expect(
            getPlayer(state, "p2").battlefield.some((c) => c.id === "foe")
        ).toBe(false);
        expect(
            getPlayer(state, "p2").graveyard.some((c) => c.id === "foe")
        ).toBe(true);
    });

    it("the damage and the sacrifice survive the public projection (wire format)", () => {
        const mogg = makeInstance(moggFanatic.id, {
            id: "mogg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mogg] }),
                makePlayer("p2"),
            ],
        });

        sacrificeSelfActivated(state, mogg, "mogg-fanatic-sac", [
            { type: "player", id: "p2" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(19);
        expect(
            projected.players[0].battlefield.some((c) => c.id === "mogg")
        ).toBe(false);
        expect(
            projected.players[0].graveyard.some((c) => c.id === "mogg")
        ).toBe(true);
    });
});

// Jackal Pup — 2/1 for {R} with the self-damage drawback (modern oracle):
// "Whenever this creature is dealt damage, it deals that much damage to you."
// Built on `damageTakenTrigger` gating on the receiver being this permanent
// (CR 109.2). The redirect reads the firing event's damage amount
// (`damage.amount`) — hence the imperative resolve (not DSL-migratable, ADR
// 0045; the EVENT_FIELD_REGISTRY has no numeric family).
describe("Jackal Pup (self-damage drawback, CR 120.3 / 603.4)", () => {
    it("has the right P/T and mana cost (2/1 for {R})", () => {
        expect(jackalPup.power).toBe(2);
        expect(jackalPup.toughness).toBe(1);
        expect(jackalPup.manaCost).toEqual({ R: 1 });
        expect(jackalPup.types).toContain("Creature");
        expect(jackalPup.triggeredAbilities?.[0]?.event).toBe("DAMAGE_DEALT");
    });

    it("redirects lethal damage to its controller — a bolt that kills it still pings you (CR 603.10 LKI)", () => {
        const pup = makeInstance(jackalPup.id, {
            id: "pup",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pup], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });

        // p2 bolts the Pup for 3 — lethal to a 2/1.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "pup" },
        ]);
        resolveTopOfStack(state); // deals 3, emits DAMAGE_DEALT, SBA kills Pup
        processPendingActionTriggers(state); // collect the redirect trigger
        resolveTopOfStack(state); // resolve the redirect

        // Controller (p1) takes "that much" (3) damage even though the Pup
        // died from the same damage.
        expect(getPlayer(state, "p1").life).toBe(17);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "pup")
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "pup")
        ).toBe(true);
    });

    it("redirects EXACTLY the amount dealt (that much, not a fixed number)", () => {
        const pup = makeInstance(jackalPup.id, {
            id: "pup",
            controllerId: "p1",
            ownerId: "p1",
        });
        const src = makeInstance(moggFanatic.id, {
            id: "src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pup], life: 20 }),
                makePlayer("p2", { battlefield: [src], life: 20 }),
            ],
        });

        // Synthetic non-lethal 2-damage event to the Pup. Drives the trigger
        // through the real collect + resolve path to prove the redirect scales
        // with the damage amount rather than a hardcoded value.
        const event: GameEvent = {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "src",
            sourceControllerId: "p2",
            target: { type: "permanent", id: "pup" },
            amount: 2,
            isCombat: false,
        };
        state.pendingEvents = [event];
        processPendingActionTriggers(state);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").life).toBe(18);
    });

    it("the redirected life loss survives the public projection (wire format)", () => {
        const pup = makeInstance(jackalPup.id, {
            id: "pup",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pup], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });

        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "pup" },
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].life).toBe(17);
    });
});
