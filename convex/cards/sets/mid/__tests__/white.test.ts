// Per-card behavior tests for white cards in `convex/cards/sets/mid/white.ts`
// (MID, split by colour per ADR 0043). Fixture builders live in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { adelineResplendentCathar } from "../white";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type PlayerState,
} from "../../../../gre/state";
import { emitAttackersDeclaredEvents } from "../../../../gre/phases";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";
import { getDefinition } from "../../../index";

/** Declares `attackerIds` as attackers through the REAL production entry
 *  point (`emitAttackersDeclaredEvents`, CR 508.1) rather than hand-building
 *  the trigger stack item — the same helper the Jacked Rabbit suite
 *  (`sets/blc/__tests__/white.test.ts`) uses, and for the same reason: a
 *  hand-built stack item never runs `collectTriggers`, so `matches` is never
 *  actually exercised. */
function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

function setupState(p1Overrides: Partial<PlayerState> = {}): GameState {
    return makeState({
        players: [makePlayer("p1", p1Overrides), makePlayer("p2")],
    });
}

describe("Adeline power CDA (CR 604.3/208.2) — power = creatures you control", () => {
    it("counts HERSELF: a lone Adeline is a 1/4 (no 'other' exclusion)", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const state = setupState({ battlefield: [adeline] });
        expect(getEffectivePower(state, adeline)).toBe(1);
        expect(getEffectiveToughness(state, adeline)).toBe(4);
    });

    it("scales with every OTHER creature the controller adds", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const c1 = makeInstance(grizzlyBears.id, { id: "c1" });
        const c2 = makeInstance(grizzlyBears.id, { id: "c2" });
        const state = setupState({ battlefield: [adeline, c1, c2] });
        // Adeline herself + 2 Grizzly Bears = 3.
        expect(getEffectivePower(state, adeline)).toBe(3);
        // Toughness is NOT a CDA — stays fixed at the printed 4.
        expect(getEffectiveToughness(state, adeline)).toBe(4);
    });

    it("does NOT count an opponent's creatures", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [adeline] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        expect(getEffectivePower(state, adeline)).toBe(1);
    });

    it("wire format: power survives projectPublicState", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const c1 = makeInstance(grizzlyBears.id, { id: "c1" });
        const state = setupState({ battlefield: [adeline, c1] });
        expect(getEffectivePower(state, adeline)).toBe(2);

        const projected = projectPublicState(state, 1, "p1");
        const slimAdeline = projected.players[0].battlefield.find(
            (c) => c.id === adeline.id
        )!;
        expect(getEffectivePower(projected, slimAdeline)).toBe(2);
        expect(getEffectiveToughness(projected, slimAdeline)).toBe(4);
    });
});

describe("Adeline attack trigger (CR 508.1/508.4) — token per opponent, tapped and attacking", () => {
    it("fires when you attack even if Adeline herself doesn't (CR rules note)", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const other = makeInstance(grizzlyBears.id, { id: "other" });
        const state = setupState({ battlefield: [adeline, other] });

        // Only `other` attacks — Adeline stays home.
        declareAttackers(state, [other.id]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "adeline-resplendent-cathar-attack-tokens"
        );
    });

    it("creates exactly one tapped-and-attacking 1/1 white Human token (2-player: one opponent)", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
            isSummoningSick: false,
        });
        const state = setupState({ battlefield: [adeline] });

        declareAttackers(state, [adeline.id]);
        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Human")
        );
        expect(tokens).toHaveLength(1);
        const token = tokens[0];
        expect(token.power).toBe(1);
        expect(token.toughness).toBe(1);
        expect(token.types).toContain("Creature");
        expect(token.controllerId).toBe("p1");

        // CR 508.4 — enters ALREADY tapped and ALREADY attacking, joining
        // the current combat directly (not a normal declared attacker).
        expect(token.isTapped).toBe(true);
        expect(token.isAttacking).toBe(true);
        expect(state.combat?.attackerIds).toContain(token.id);
    });

    it("does NOT fire when the opponent attacks (matches on the ATTACKING player, not attacker identity)", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppAttacker = makeInstance(grizzlyBears.id, {
            id: "opp-attacker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [adeline] }),
                makePlayer("p2", { battlefield: [oppAttacker] }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });

        declareAttackers(state, [oppAttacker.id]);
        expect(state.stack).toHaveLength(0);
    });

    it("wires the token's art from the reverse-linked Scryfall lockfile (CR 111)", () => {
        const expected = tokenPrintIdFor(adelineResplendentCathar.id, "Human");
        expect(expected).toBeDefined();

        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const state = setupState({ battlefield: [adeline] });
        declareAttackers(state, [adeline.id]);
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Human")
        )!;
        expect(getDefinition(token.card.id as string).imagePrintId).toBe(
            expected
        );
    });
});

describe("Adeline attack trigger — wire format (projectPublicState)", () => {
    it("the created token's tapped/attacking status survives the projection", () => {
        const adeline = makeInstance(adelineResplendentCathar.id, {
            id: "adeline",
        });
        const state = setupState({ battlefield: [adeline] });
        declareAttackers(state, [adeline.id]);
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Human")
        )!;

        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slimToken.isTapped).toBe(true);
        expect(slimToken.isAttacking).toBe(true);
        expect(slimToken.power).toBe(1);
        expect(slimToken.toughness).toBe(1);
    });
});
