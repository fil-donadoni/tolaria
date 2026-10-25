// Source damage history — "each planeswalker it has dealt damage to this game"
// (CR 120.1 / 120.3c / 400.7 / 608.2h, issue #6867, The Fallen).
//
// A permanent's `damagedPermanentsThisGame` lists the permanents it has dealt
// damage to as the object it now is; a `forEach` permanents selector's
// `damagedBySourceThisGame` reads it back. Covers both damage sinks that can
// have a permanent source (combat, and an ability naming a permanent as the
// source), CR 400.7 at both ends (a returned recipient and a returned source
// are new objects), the CR 608.2h last-known-information read of a source
// that left, and the loyalty loss through the wire projection.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import type { StackItem } from "../state";
import {
    type CardInstanceState,
    type GameState,
    buildSpellContext,
    phaseInBundle,
    phaseOutPermanent,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
} from "../state";
import { applyAllCombatDamage, buildAutoDamageAssignments } from "../phases";
import { projectPublicState } from "../../gameProjections";

const THE_FALLEN = getDefinition("f4a176e1-b22b-4f36-ba7b-c506cb4e1bed");

function planeswalker(id: string, controllerId: string): CardInstanceState {
    return {
        id,
        card: { id },
        types: ["Planeswalker"],
        subtypes: [],
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        counters: { loyalty: 5 },
    };
}

function fallenState(): GameState {
    const fallen = makeInstance(THE_FALLEN.id, {
        id: "fallen",
        controllerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [fallen, planeswalker("own-pw", "p1")],
            }),
            makePlayer("p2", {
                battlefield: [
                    planeswalker("pw", "p2"),
                    planeswalker("pw2", "p2"),
                ],
            }),
        ],
    });
}

function card(state: GameState, id: string): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

function loyalty(state: GameState, id: string): number | undefined {
    return card(state, id)?.counters?.loyalty;
}

/** The Fallen attacks planeswalker `pwId` unblocked (CR 508.1b). */
function fallenAttacks(state: GameState, pwId: string): void {
    card(state, "fallen")!.isAttacking = true;
    state.phase = "COMBAT_DAMAGE";
    state.combat = {
        attackerIds: ["fallen"],
        attackTargets: { fallen: pwId },
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: true,
    };
    applyAllCombatDamage(
        state,
        buildAutoDamageAssignments(state, "regular"),
        "regular"
    );
    state.combat = undefined;
    card(state, "fallen")!.isAttacking = false;
}

/** An ability of The Fallen that names it as the damage source (CR 120.1). */
function fallenPings(state: GameState, target: string, amount = 1): void {
    const item = {
        ...card(state, "fallen")!,
        id: "ping",
        zone: "stack",
        triggerSourceId: "fallen",
    } as StackItem;
    buildSpellContext(state, item).dealDamageFromPermanent(
        "fallen",
        { type: "permanent", id: target },
        amount
    );
}

/** Puts The Fallen's upkeep trigger on the stack as `buildTriggerItem` does —
 *  a `{ ...self }` snapshot of its source (gre/triggers.ts). */
function pushUpkeepTrigger(state: GameState): void {
    const fallen = card(state, "fallen")!;
    state.stack.push({
        ...fallen,
        id: "upkeep-trigger",
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "the-fallen-upkeep",
        triggerSourceId: "fallen",
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"],
        targets: [],
    });
}

describe("source damage history (CR 120.1, issue #6867)", () => {
    it("combat damage to a planeswalker is recorded on the attacking source", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        expect(loyalty(state, "pw")).toBe(3);
        expect(card(state, "fallen")!.damagedPermanentsThisGame).toEqual([
            "pw",
        ]);
    });

    it("an ability's permanent-source damage is recorded, each recipient once", () => {
        const state = fallenState();
        fallenPings(state, "pw2");
        fallenPings(state, "pw2");
        expect(loyalty(state, "pw2")).toBe(3);
        expect(card(state, "fallen")!.damagedPermanentsThisGame).toEqual([
            "pw2",
        ]);
    });

    it("an ability's default-source damage is its source permanent's (CR 608.2h)", () => {
        const state = fallenState();
        const ability = {
            ...card(state, "fallen")!,
            id: "ability",
            zone: "stack",
            triggeredAbilityId: "the-fallen-upkeep",
            triggerSourceId: "fallen",
        } as StackItem;
        buildSpellContext(state, ability).dealDamage(
            { type: "permanent", id: "pw" },
            1
        );
        expect(loyalty(state, "pw")).toBe(4);
        expect(card(state, "fallen")!.damagedPermanentsThisGame).toEqual([
            "pw",
        ]);
    });

    it("damage from a source that is not a permanent records nothing", () => {
        const state = fallenState();
        const spell = {
            ...makeInstance(THE_FALLEN.id, { id: "bolt", controllerId: "p1" }),
            zone: "stack",
        } as StackItem;
        buildSpellContext(state, spell).dealDamage(
            { type: "permanent", id: "pw" },
            1
        );
        expect(loyalty(state, "pw")).toBe(4);
        expect(
            card(state, "fallen")!.damagedPermanentsThisGame
        ).toBeUndefined();
    });
});

describe("The Fallen — each planeswalker it has dealt damage to this game (CR 120.3c)", () => {
    it("at upkeep, deals 1 to each planeswalker it damaged, whoever controls it, and to no other", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        fallenPings(state, "own-pw");
        pushUpkeepTrigger(state);
        resolveTopOfStack(state);
        expect(loyalty(state, "pw")).toBe(2);
        expect(loyalty(state, "own-pw")).toBe(3);
        expect(loyalty(state, "pw2")).toBe(5);
        // The loyalty loss crosses the wire (the client reads the projection).
        const projected = projectPublicState(state, 1, "p1");
        const pw = projected.players[1].battlefield.find((c) => c.id === "pw");
        expect(pw?.counters?.loyalty).toBe(2);
    });

    it("forgets a planeswalker that left and returned — a new object (CR 400.7)", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        removePermanentTo(state, "pw", "graveyard");
        const returned = state.players[1].graveyard.find((c) => c.id === "pw")!;
        putReanimatedSetOnBattlefield(state, [
            { card: returned, controllerId: "p2" },
        ]);
        expect(card(state, "pw")).toBeDefined();
        expect(
            card(state, "fallen")!.damagedPermanentsThisGame
        ).toBeUndefined();
        const before = loyalty(state, "pw");
        pushUpkeepTrigger(state);
        resolveTopOfStack(state);
        expect(loyalty(state, "pw")).toBe(before);
    });

    it("a Fallen that left and returned has damaged nothing (CR 400.7)", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        removePermanentTo(state, "fallen", "graveyard");
        const returned = state.players[0].graveyard.find(
            (c) => c.id === "fallen"
        )!;
        putReanimatedSetOnBattlefield(state, [
            { card: returned, controllerId: "p1" },
        ]);
        expect(
            card(state, "fallen")!.damagedPermanentsThisGame
        ).toBeUndefined();
        pushUpkeepTrigger(state);
        resolveTopOfStack(state);
        expect(loyalty(state, "pw")).toBe(3);
    });

    it("a phased-out Fallen forgets a planeswalker that returned meanwhile (CR 702.26d / 400.7)", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        const bundle = phaseOutPermanent(state, "fallen", {
            returnOn: { kind: "untap-cycle" },
        });
        expect(bundle).not.toBeNull();
        removePermanentTo(state, "pw", "graveyard");
        const returned = state.players[1].graveyard.find((c) => c.id === "pw")!;
        putReanimatedSetOnBattlefield(state, [
            { card: returned, controllerId: "p2" },
        ]);
        expect(phaseInBundle(state, bundle!)).toBe(true);
        expect(
            card(state, "fallen")!.damagedPermanentsThisGame
        ).toBeUndefined();
    });

    it("its upkeep trigger reads the object it came from when The Fallen returned in response (CR 608.2h)", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        pushUpkeepTrigger(state);
        removePermanentTo(state, "fallen", "graveyard");
        const returned = state.players[0].graveyard.find(
            (c) => c.id === "fallen"
        )!;
        putReanimatedSetOnBattlefield(state, [
            { card: returned, controllerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(loyalty(state, "pw")).toBe(2);
    });

    it("its upkeep trigger still reads the history after The Fallen has left (CR 608.2h)", () => {
        const state = fallenState();
        fallenAttacks(state, "pw");
        pushUpkeepTrigger(state);
        removePermanentTo(state, "fallen", "graveyard");
        resolveTopOfStack(state);
        expect(loyalty(state, "pw")).toBe(2);
    });
});
