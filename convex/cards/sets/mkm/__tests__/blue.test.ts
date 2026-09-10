// MKM — blue per-card behaviour tests (ADR 0043 colour split). Each describe
// block cites the CR section it exercises; assertions check external behaviour
// only, through a real engine entry point.
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { effectiveMaxHandSize } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const PROFT_ID = "af5b29b3-974c-4200-8df8-b072c11e1600";
/** Grizzly Bears — a vanilla 2/2 body for the counters to land on. */
const BEAR_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    });
    resolveTopOfStack(state);
}

const beginCombat = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "BEGINNING_OF_COMBAT" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

function setup(drawn: string[]) {
    const proft = makeInstance(PROFT_ID, {
        id: "proft",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(BEAR_ID, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "BEGINNING_OF_COMBAT",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [proft, bear],
                drawnThisTurn: drawn,
            }),
            makePlayer("p2"),
        ],
    });
    return { state, proft, bear };
}

describe("Proft's Eidetic Memory — ETB draw (CR 121.1 / 603.6a)", () => {
    it("draws a card when it enters", () => {
        const proft = makeInstance(PROFT_ID, {
            id: "proft",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [proft],
                    library: [
                        makeInstance(BEAR_ID, {
                            id: "lib-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, proft, "profts-eidetic-memory-etb-draw", {
            type: "PERMANENT_ENTERED",
            instanceId: "proft",
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib-1"]);
        // CR 121.1 — the draw feeds the same per-turn tally the combat trigger
        // reads, so the ETB is itself one of the "cards you've drawn".
        expect(state.players[0].drawnThisTurn).toEqual(["lib-1"]);
    });
});

describe("Proft's Eidetic Memory — no maximum hand size (CR 402.2 / 514.1)", () => {
    it("lifts the controller's cleanup discard ceiling while it is on the battlefield", () => {
        const { state } = setup([]);
        expect(effectiveMaxHandSize(state.players[0], state)).toBe(Infinity);
        // The opponent is untouched — "YOU have no maximum hand size".
        expect(effectiveMaxHandSize(state.players[1], state)).toBe(7);
    });
});

describe("Proft's Eidetic Memory — beginning-of-combat counters (CR 603.4 / 121.1)", () => {
    it("does nothing when exactly one card was drawn this turn ('MORE than one')", () => {
        const { state, proft } = setup(["d1"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBeUndefined();
    });

    it("puts (cards drawn − 1) +1/+1 counters on the target (CR 608.2h — X at resolution)", () => {
        const { state, proft } = setup(["d1", "d2", "d3", "d4"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBe(3);
        // Counters are board-visible, so they must survive the projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(3);
    });

    it("two drawn cards is the boundary — exactly one counter", () => {
        const { state, proft } = setup(["d1", "d2"]);
        resolveTrigger(
            state,
            proft,
            "profts-eidetic-memory-combat",
            beginCombat("p1"),
            [{ type: "permanent", id: "bear" }]
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["+1/+1"]).toBe(1);
    });

    it("the CHECK-TIME half of the intervening if gates the trigger too (CR 603.4)", () => {
        const { state } = setup(["d1"]);
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "BEGINNING_OF_COMBAT" as const,
            activePlayerId: "p1",
        };
        const matching = (s: GameState) =>
            collectTriggers(s, [event as never]).filter(
                (t) => t.triggeredAbilityId === "profts-eidetic-memory-combat"
            );
        expect(matching(state)).toHaveLength(0);
        state.players[0].drawnThisTurn = ["d1", "d2"];
        expect(matching(state)).toHaveLength(1);
    });

    it("only on YOUR turn — the opponent's beginning of combat never fires it", () => {
        const { state } = setup(["d1", "d2", "d3"]);
        state.activePlayerId = "p2";
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "BEGINNING_OF_COMBAT" as const,
            activePlayerId: "p2",
        };
        expect(
            collectTriggers(state, [event as never]).filter(
                (t) => t.triggeredAbilityId === "profts-eidetic-memory-combat"
            )
        ).toHaveLength(0);
    });
});
