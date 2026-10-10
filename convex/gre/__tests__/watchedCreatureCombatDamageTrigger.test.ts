// CR 603.7b / 510.2 (issue #2142) — the instance-scoped repeating
// `this-turn-watched-creature-deals-combat-damage` delayed trigger, driven
// through the REAL Vigorous Charge definition ({G} instant, Kicker {W}).
//
// Claims no Op test makes: one firing PER damage event (trample over a
// blocker + the player = two gains, no batch collapse); only the WATCHED
// creature's COMBAT damage counts; the watch survives its firings, dies with
// its creature (CR 400.7) and expires at cleanup (CR 514.2); unkicked casts
// schedule nothing.
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../cards/index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { finalizeCleanup } from "../phases";
import { collectTriggers } from "../triggers";
import { projectPublicState } from "../../gameProjections";
import type { GameEvent } from "../../cards/types";

const VIGOROUS_CHARGE = getDefinition("af6f57ad-d370-4c81-8da0-c15d87725ab1");
/** Grizzly Bears — a plain green creature. */
const BEARS = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const WATCH = "this-turn-watched-creature-deals-combat-damage";

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(BEARS.id, {
                        id: "atk",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(BEARS.id, {
                        id: "other",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(BEARS.id, {
                        id: "blk",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

function cast(state: GameState, kicked: boolean): void {
    const item = pushSpell(state, VIGOROUS_CHARGE.id, "p1", [
        { type: "permanent", id: "atk" },
    ]);
    if (kicked) item.kickerPayments = { kicker: 1 };
    resolveTopOfStack(state);
}

const damage = (
    sourceInstanceId: string,
    target: { type: "player" | "permanent"; id: string },
    amount: number,
    isCombat = true
): GameEvent =>
    ({
        type: "DAMAGE_DEALT",
        sourceInstanceId,
        sourceControllerId: "p1",
        target,
        amount,
        isCombat,
    }) as unknown as GameEvent;

const watches = (state: GameState) =>
    (state.delayedTriggers ?? []).filter((t) => t.timing === WATCH);

const fired = (state: GameState) =>
    state.stack.filter((i) => i.delayedTriggerId !== undefined);

describe("Vigorous Charge — instance combat-damage watch (CR 603.7b / 510.2, issue #2142)", () => {
    it("unkicked: trample is granted but nothing is scheduled", () => {
        const state = board();
        cast(state, false);
        expect(watches(state)).toHaveLength(0);
        collectTriggers(state, [
            damage("atk", { type: "player", id: "p2" }, 3),
        ]);
        expect(fired(state)).toHaveLength(0);
    });

    it("kicked: fires once PER damage event (blocker AND player), gaining that much each time", () => {
        const state = board();
        cast(state, true);
        expect(watches(state)).toHaveLength(1);
        state.players[0].life = 10;
        const items = collectTriggers(state, [
            damage("atk", { type: "permanent", id: "blk" }, 2),
            damage("atk", { type: "player", id: "p2" }, 1),
        ]);
        state.stack.push(...items);
        expect(fired(state)).toHaveLength(2);
        // Wire format — both abilities cross projectPublicState.
        expect(
            projectPublicState(state, 0, "p1").stack.filter(
                (i) => i.delayedTriggerId !== undefined
            )
        ).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(13);
        // Repeating: still queued after firing.
        expect(watches(state)).toHaveLength(1);
    });

    it("ignores non-combat damage and damage from any other source", () => {
        const state = board();
        cast(state, true);
        const items = collectTriggers(state, [
            damage("atk", { type: "player", id: "p2" }, 3, false),
            damage("other", { type: "player", id: "p2" }, 3),
        ]);
        expect(items).toHaveLength(0);
    });

    it("CR 400.7 — drops the watch when the creature leaves, but still fires for damage dealt in that same batch", () => {
        const state = board();
        cast(state, true);
        const items = collectTriggers(state, [
            damage("atk", { type: "player", id: "p2" }, 4),
            {
                type: "PERMANENT_LEFT",
                instanceId: "atk",
                toZone: "graveyard",
            } as GameEvent,
        ]);
        expect(
            items.filter((i) => i.delayedTriggerId !== undefined)
        ).toHaveLength(1);
        expect(watches(state)).toHaveLength(0);
    });

    it("CR 514.2 — expires at cleanup, fired or not", () => {
        const state = board();
        cast(state, true);
        expect(watches(state)).toHaveLength(1);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(watches(state)).toHaveLength(0);
    });
});
