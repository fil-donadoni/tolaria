// CR 508.3b / 603.7b (issue #8166) — "Until your next turn, whenever one or more
// creatures attack one of your opponents, those creatures get +2/+2 and gain
// trample until end of turn." One firing per declaration, over the group of
// creatures attacking a player, repeating until the controller's next turn.
import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../cards/types";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { advancePhase, emitAttackersDeclaredEvents } from "../phases";
import { resolveTopOfStack } from "../state";
import type { GameState } from "../state";

const TIMING = "until-next-turn-creatures-attack-your-opponents" as const;

const BODY: EffectOp[] = [
    {
        op: "forEach",
        select: { set: "eventAttackers" },
        effects: [
            {
                op: "pump",
                target: { ref: "$each" },
                power: 2,
                toughness: 2,
                duration: { phase: "end-of-turn" },
            },
            {
                op: "grantAbility",
                target: { ref: "$each" },
                ability: "trample",
                duration: { phase: "end-of-turn" },
            },
        ],
    },
];

const SCHEDULE: EffectOp[] = [
    {
        op: "delayedTrigger",
        timing: TIMING,
        oracleText:
            "Whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.",
        effects: BODY,
    },
];

function openWindow(state: GameState, controllerId: string): void {
    const id = `test-attack-watch-${controllerId}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects: SCHEDULE,
    });
    pushSpell(state, id, controllerId);
    resolveTopOfStack(state);
}

/** p1 holds three bears, p2 one. An `attackTargets` entry stands for the
 *  planeswalker an attacker is sent at; nothing here reads the permanent itself. */
function board(): GameState {
    const bear = getCardByName("Grizzly Bears");
    const mine = (id: string) =>
        makeInstance(bear.id, { id, controllerId: "p1", ownerId: "p1" });
    const theirs = (id: string) =>
        makeInstance(bear.id, { id, controllerId: "p2", ownerId: "p2" });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [mine("a"), mine("b"), mine("c")],
            }),
            makePlayer("p2", { battlefield: [theirs("x")] }),
        ],
    });
}

/** Declares through the production entry point; returns how many window firings
 *  reached the stack, then resolves them. */
function declare(
    state: GameState,
    activePlayerId: string,
    attackerIds: string[],
    attackTargets?: Record<string, string>
): number {
    state.activePlayerId = activePlayerId;
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...(attackTargets ? { attackTargets } : {}),
    };
    emitAttackersDeclaredEvents(state);
    const firings = state.stack.filter(
        (s) => s.delayedTriggerId !== undefined
    ).length;
    while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
        resolveTopOfStack(state);
    }
    return firings;
}

function permanent(state: GameState, id: string) {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id)!;
}

describe("until-next-turn-creatures-attack-your-opponents (CR 508.3b / 603.7b, issue #8166)", () => {
    it("fires ONCE for the declaration and pumps every creature in the group", () => {
        const state = board();
        openWindow(state, "p1");
        expect(declare(state, "p1", ["a", "b"])).toBe(1);
        for (const id of ["a", "b"]) {
            const c = permanent(state, id);
            expect(getEffectivePower(state, c)).toBe(4);
            expect(getEffectiveToughness(state, c)).toBe(4);
            expect(c.staticAbilities).toContain("trample");
        }
        // A creature that did not attack is not one of "those creatures".
        expect(getEffectivePower(state, permanent(state, "c"))).toBe(2);
    });

    it("leaves out a creature attacking a planeswalker (CR 508.3b)", () => {
        const state = board();
        openWindow(state, "p1");
        expect(declare(state, "p1", ["a", "b"], { b: "pw" })).toBe(1);
        expect(getEffectivePower(state, permanent(state, "a"))).toBe(4);
        expect(getEffectivePower(state, permanent(state, "b"))).toBe(2);
    });

    it("does not fire when every attacker attacks a planeswalker (CR 508.3b)", () => {
        const state = board();
        openWindow(state, "p1");
        expect(declare(state, "p1", ["a"], { a: "pw" })).toBe(0);
        expect(getEffectivePower(state, permanent(state, "a"))).toBe(2);
    });

    it("does not fire when an opponent attacks the controller (CR 506.2)", () => {
        const state = board();
        openWindow(state, "p1");
        expect(declare(state, "p2", ["x"])).toBe(0);
        expect(getEffectivePower(state, permanent(state, "x"))).toBe(2);
    });

    it("repeats on a later declaration: it has a stated duration (CR 603.7b)", () => {
        const state = board();
        openWindow(state, "p1");
        expect(declare(state, "p1", ["a"])).toBe(1);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(declare(state, "p1", ["c"])).toBe(1);
        expect(getEffectivePower(state, permanent(state, "c"))).toBe(4);
    });

    it("skips a creature that left the battlefield before resolution", () => {
        const state = board();
        openWindow(state, "p1");
        state.activePlayerId = "p1";
        state.phase = "DECLARE_ATTACKERS";
        state.combat = {
            attackerIds: ["a", "b"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        emitAttackersDeclaredEvents(state);
        const p1 = state.players[0];
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "b");
        while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
            resolveTopOfStack(state);
        }
        expect(getEffectivePower(state, permanent(state, "a"))).toBe(4);
    });

    it("survives the opponent's turn and closes as the controller's next turn begins", () => {
        const state = board();
        openWindow(state, "p1");
        const open = () =>
            state.delayedTriggers?.some((t) => t.timing === TIMING) ?? false;

        state.activePlayerId = "p1";
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(open()).toBe(true);

        state.activePlayerId = "p2";
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(open()).toBe(false);
    });

    it("the pump and the trample survive projection (wire format)", () => {
        const state = board();
        openWindow(state, "p1");
        declare(state, "p1", ["a"]);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "a"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(slim.staticAbilities).toContain("trample");
    });

    describe("validator", () => {
        const validate = (effects: EffectOp[]) =>
            validateEffectScript({
                id: "attack-watch-host",
                name: "attack-watch-host",
                effects,
            } as Parameters<typeof validateEffectScript>[0]);

        it("accepts the group body under this timing", () => {
            expect(validate(SCHEDULE)).toEqual([]);
        });

        it("rejects eventAttackers where the declaration is not in scope", () => {
            expect(validate(BODY).join("\n")).toContain("eventAttackers");
        });

        it("rejects eventAttackers in a delayed body whose event is gone", () => {
            const errors = validate([
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText: "At the beginning of the next end step, …",
                    effects: BODY,
                },
            ]);
            expect(errors.join("\n")).toContain("eventAttackers");
        });

        it("rejects extra fields on the selector", () => {
            const errors = validate([
                {
                    op: "forEach",
                    select: { set: "eventAttackers", zone: "battlefield" },
                    effects: BODY[0].op === "forEach" ? BODY[0].effects : [],
                },
            ] as unknown as EffectOp[]);
            expect(errors.join("\n")).toMatch(/select/);
        });
    });
});
