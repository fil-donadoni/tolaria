// CR 305 / 614.1c / 614.12 / 400.7 / 302.6 — the ISMCTS rollout mover plays a
// land through the SAME chokepoint as the authoritative mutation
// (`applyPlayLandFromAnyZone`), so a land entering inside a search enters under
// the real rules: tapped when its replacement says so, a pay-or-tapped land
// auto-finalized instead of stalling, stale battlefield state cleared.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

// Havenwood Battleground (FEM) — "This land enters tapped."
const TAPPED_LAND = "9028f200-80dd-4c53-877f-ea380ff417cb";
const SHOCK = getCardByName("Steam Vents").id;
const FASTBOND = getCardByName("Fastbond").id;
const FOREST = getCardByName("Forest").id;

function play(state: GameState, id: string): void {
    state.passCount = 1;
    applyMoveInSearch(state, "p1", { kind: "play-land", cardInstanceId: id });
}

function boardWith(
    hand: ReturnType<typeof makeInstance>[],
    extra: Partial<Parameters<typeof makePlayer>[1]> = {}
): GameState {
    return makeState({
        players: [makePlayer("p1", { hand, ...extra }), makePlayer("p2")],
    });
}

describe("rollout play-land uses the shared land-entry chokepoint", () => {
    it("an enters-tapped land enters tapped (CR 614.1c)", () => {
        const state = boardWith([
            makeInstance(TAPPED_LAND, { id: "land", zone: "hand" }),
        ]);
        play(state, "land");
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "land"
        );
        expect(land?.isTapped).toBe(true);
    });

    it("a pay-or-tapped land is auto-finalized, never stalling (CR 614.12)", () => {
        const rich = boardWith(
            [makeInstance(SHOCK, { id: "shock", zone: "hand" })],
            { life: 20 }
        );
        play(rich, "shock");
        expect(rich.pendingChoices?.length ?? 0).toBe(0);
        const paid = getPlayer(rich, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(paid?.isTapped).toBe(false);
        expect(getPlayer(rich, "p1").life).toBe(18);

        const poor = boardWith(
            [makeInstance(SHOCK, { id: "shock", zone: "hand" })],
            { life: 1 }
        );
        play(poor, "shock");
        expect(poor.pendingChoices?.length ?? 0).toBe(0);
        const tapped = getPlayer(poor, "p1").battlefield.find(
            (c) => c.id === "shock"
        );
        expect(tapped?.isTapped).toBe(true);
    });

    it("clears stale battlefield-transient state on entry (CR 400.7)", () => {
        const dead = makeInstance(FOREST, {
            id: "dead",
            zone: "graveyard",
            isTapped: true,
            damageMarked: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [dead],
                    battlefield: [
                        makeInstance(getCardByName("Icetill Explorer").id, {
                            id: "src",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        play(state, "dead");
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "dead"
        );
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(land!.damageMarked ?? 0).toBe(0);
    });

    it("stamps the control-continuity entry turn (CR 302.6)", () => {
        const state = boardWith([
            makeInstance(FOREST, { id: "f", zone: "hand" }),
        ]);
        play(state, "f");
        const land = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "f"
        );
        expect(land?.enteredOnTurn).toBe(state.turn);
    });

    it("stays a special action: drop counted, cycle reset, actor keeps priority, play-triggers fire (CR 117.3c / 305.2)", () => {
        const state = boardWith(
            [
                makeInstance(FOREST, { id: "a", zone: "hand" }),
                makeInstance(FOREST, { id: "b", zone: "hand" }),
            ],
            {
                battlefield: [
                    makeInstance(FASTBOND, {
                        id: "fb",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }
        );
        play(state, "a");
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
        const lifeBefore = getPlayer(state, "p1").life;
        play(state, "b");
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(2);
        // Fastbond's trigger goes on the stack; resolving it costs 1 life.
        expect(state.stack.length).toBeGreaterThan(0);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore);
    });
});
