// Speed — Start your engines! (CR 702.179), its state-based action (CR 704.5aa)
// and the source-less trigger that raises it (CR 702.179d). The max speed gate
// on a compiled trigger is `convex/oracle/__tests__/maxSpeed.test.ts`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { checkStateBasedActions } from "../sba";
import {
    emitLifeLost,
    payLifeCost,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../state";
import type { CardInstanceState, GameState } from "../state";
import { compactState, expandState } from "../serialize";
import { hasMaxSpeed, speedOf } from "../speed";
import { collectTriggers } from "../triggers";
import { applyAllCombatDamage } from "../phases";

function permanent(
    id: string,
    controllerId: string,
    staticAbilities: string[] = ["start your engines!"]
): CardInstanceState {
    return {
        id,
        card: { id: "" },
        types: ["Enchantment"],
        subtypes: [],
        staticAbilities,
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
    } as CardInstanceState;
}

/** p1 is the active player. */
function board(p1Speed?: number, p2Speed?: number): GameState {
    return makeState({
        turn: 5,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", p1Speed === undefined ? {} : { speed: p1Speed }),
            makePlayer("p2", p2Speed === undefined ? {} : { speed: p2Speed }),
        ],
    });
}

const speedOfSeat = (state: GameState, id: string) =>
    state.players.find((p) => p.id === id)!.speed;

describe("start your engines! (CR 704.5aa, CR 702.179a)", () => {
    it("gives a player with no speed speed 1", () => {
        const state = board();
        state.players[0]!.battlefield = [permanent("a", "p1")];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBe(1);
        expect(speedOfSeat(state, "p2")).toBeUndefined();
    });

    it("reads the controller, not whose battlefield holds the permanent", () => {
        const state = board();
        state.players[0]!.battlefield = [permanent("a", "p2")];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBeUndefined();
        expect(speedOfSeat(state, "p2")).toBe(1);
    });

    it("leaves a player who already has speed alone", () => {
        const state = board(3);
        state.players[0]!.battlefield = [permanent("a", "p1")];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBe(3);
    });

    it("needs the keyword itself", () => {
        const state = board();
        state.players[0]!.battlefield = [permanent("a", "p1", ["flying"])];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBeUndefined();
    });

    // CR 702.179b — speed is set by a rule; nothing in the rule takes it away.
    it("keeps the speed after the permanent leaves", () => {
        const state = board();
        state.players[0]!.battlefield = [permanent("a", "p1")];
        checkStateBasedActions(state);
        state.players[0]!.battlefield = [];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBe(1);
    });
});

describe("reading a player's speed (CR 702.179e, CR 702.179f)", () => {
    it("reads no speed as 0", () => {
        expect(speedOf({})).toBe(0);
        expect(speedOf({ speed: 2 })).toBe(2);
    });

    it("has max speed only at 4", () => {
        expect(hasMaxSpeed({})).toBe(false);
        expect(hasMaxSpeed({ speed: 3 })).toBe(false);
        expect(hasMaxSpeed({ speed: 4 })).toBe(true);
    });
});

describe("the inherent speed trigger (CR 702.179d)", () => {
    /** Puts whatever waits onto the stack, as the next priority check does. */
    const flush = (state: GameState) => processPendingActionTriggers(state);

    it("uses the stack, controlled by the player, with no source", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 2, false);
        // Nothing moved yet: it is a triggered ability, not an immediate rise.
        expect(speedOfSeat(state, "p1")).toBe(1);
        flush(state);
        expect(state.stack).toHaveLength(1);
        const item = state.stack[0]!;
        expect(item.controllerId).toBe("p1");
        expect(item.designationId).toBe("speed");
        expect((item.card as { id: string }).id).toBe("");
        resolveTopOfStack(state);
        expect(speedOfSeat(state, "p1")).toBe(2);
        expect(state.stack).toHaveLength(0);
    });

    it("triggers only once each turn", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 1, false);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        expect(state.stack).toHaveLength(0);
        expect(speedOfSeat(state, "p1")).toBe(2);
    });

    it("triggers again on a later turn", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        resolveTopOfStack(state);
        state.turn = 7;
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        expect(state.stack).toHaveLength(1);
    });

    it("hears a life cost an opponent pays (CR 119.4)", () => {
        const state = board(1);
        payLifeCost(state, state.players[1]!, 2);
        flush(state);
        expect(state.stack).toHaveLength(1);
    });

    it("ignores the player's own life loss", () => {
        const state = board(1);
        emitLifeLost(state, "p1", 3, false);
        flush(state);
        expect(state.stack).toHaveLength(0);
    });

    it("works only during that player's own turn", () => {
        const state = board(undefined, 1);
        emitLifeLost(state, "p1", 3, false);
        flush(state);
        expect(state.stack).toHaveLength(0);
        expect(speedOfSeat(state, "p2")).toBe(1);
    });

    it("does not exist for a player with no speed", () => {
        const state = board();
        emitLifeLost(state, "p2", 3, false);
        flush(state);
        expect(state.stack).toHaveLength(0);
        expect(speedOfSeat(state, "p1")).toBeUndefined();
    });

    // CR 603.2 — the sweep that gives first speed runs after the loss, but the
    // player had no such ability when the life was lost.
    it("does not fire off a loss from before the player had speed", () => {
        const state = board();
        emitLifeLost(state, "p2", 3, false);
        state.players[0]!.battlefield = [permanent("a", "p1")];
        checkStateBasedActions(state);
        expect(speedOfSeat(state, "p1")).toBe(1);
        expect(state.stack).toHaveLength(0);
    });

    it("does not trigger at max speed", () => {
        const state = board(4);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        expect(state.stack).toHaveLength(0);
        expect(speedOfSeat(state, "p1")).toBe(4);
    });

    // CR 603.4 — the "if your speed is less than 4" is read again on resolution.
    it("does nothing if the player reached max speed in response", () => {
        const state = board(3);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        state.players[0]!.speed = 4;
        resolveTopOfStack(state);
        expect(speedOfSeat(state, "p1")).toBe(4);
    });

    it("rises one step at a time to max speed and stops", () => {
        const state = board(1);
        for (const turn of [5, 7, 9, 11]) {
            state.turn = turn;
            emitLifeLost(state, "p2", 1, false);
            flush(state);
            if (state.stack.length > 0) resolveTopOfStack(state);
        }
        expect(speedOfSeat(state, "p1")).toBe(4);
    });

    it("survives a save between two losses of one turn", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 1, false);
        flush(state);
        resolveTopOfStack(state);
        const loaded = expandState(compactState(state));
        expect(speedOfSeat(loaded, "p1")).toBe(2);
        emitLifeLost(loaded, "p2", 1, false);
        flush(loaded);
        expect(loaded.stack).toHaveLength(0);
    });

    it("keeps a trigger waiting across a save", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 1, false);
        const loaded = expandState(compactState(state));
        flush(loaded);
        expect(loaded.stack).toHaveLength(1);
        resolveTopOfStack(loaded);
        expect(speedOfSeat(loaded, "p1")).toBe(2);
    });
});

describe("speed on the wire (CR 702.179)", () => {
    it("reaches both seats through the public projection", () => {
        const state = board(3);
        const projected = projectPublicState(
            state as never,
            1,
            "p2"
        ) as never as {
            players: { id: string; speed?: number }[];
        };
        expect(projected.players.find((p) => p.id === "p1")!.speed).toBe(3);
        expect(
            projected.players.find((p) => p.id === "p2")!.speed
        ).toBeUndefined();
    });

    it("keeps the trigger's stack tile identity", () => {
        const state = board(1);
        emitLifeLost(state, "p2", 1, false);
        processPendingActionTriggers(state);
        const projected = projectPublicState(
            state as never,
            1,
            "p2"
        ) as never as {
            stack: { designationId?: string }[];
        };
        expect(projected.stack[0]!.designationId).toBe("speed");
    });
});

describe("a compiled card behind max speed (CR 702.178a)", () => {
    const outcome = compileCard({
        oracleId: "527cc22f-b471-4a84-93a8-be56193a9723",
        name: "Risen Necroregent",
        manaCost: "{4}{B}",
        typeLine: "Creature — Zombie Cat Knight",
        oracleText:
            "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)\nMax speed — At the beginning of your end step, create a 2/2 black Zombie creature token.",
        power: "5",
        toughness: "4",
        layout: "normal",
    });
    if (outcome.state !== "ready")
        throw new Error("Risen Necroregent compiles");
    const definition = {
        ...outcome.definition,
        id: "test-7502-necroregent",
    } as CardDefinition;

    function withBoard<T>(
        speed: number | undefined,
        fn: (state: GameState) => T
    ): T {
        return withTemporaryDefinition(definition, () => {
            const state = board(speed);
            state.players[0]!.battlefield = [
                makeInstance(definition.id, {
                    id: "regent",
                    controllerId: "p1",
                }),
            ];
            return fn(state);
        });
    }
    const endStep = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    } as never;

    it("gives its controller speed through the sweep", () => {
        withBoard(undefined, (state) => {
            checkStateBasedActions(state);
            expect(speedOfSeat(state, "p1")).toBe(1);
        });
    });

    it("has no end-step trigger below max speed", () => {
        withBoard(3, (state) => {
            expect(collectTriggers(state, [endStep])).toEqual([]);
        });
    });

    it("triggers at max speed, and resolves even if speed drops after", () => {
        withBoard(4, (state) => {
            const triggers = collectTriggers(state, [endStep]);
            expect(triggers).toHaveLength(1);
            state.stack.push(...triggers);
            state.players[0]!.speed = 3;
            resolveTopOfStack(state);
            expect(
                state.players[0]!.battlefield.filter(
                    (c) => c.id !== "regent" && c.subtypes.includes("Zombie")
                )
            ).toHaveLength(1);
        });
    });
});

describe("combat damage raises speed (CR 702.179d, CR 120.3a)", () => {
    it("sends the trigger to the stack before priority", () => {
        const state = board(1);
        const attacker = {
            ...permanent("atk", "p1", []),
            types: ["Creature"],
            power: 2,
            toughness: 2,
            isAttacking: true,
        } as CardInstanceState;
        state.players[0]!.battlefield = [attacker];
        state.phase = "COMBAT_DAMAGE" as never;
        state.combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        } as never;
        applyAllCombatDamage(state, { atk: { p2: 2 } });
        checkStateBasedActions(state);
        expect(state.players[1]!.life).toBe(18);
        expect(state.stack.map((i) => i.designationId)).toEqual(["speed"]);
    });
});
