// FIC — red per-card behaviour tests (ADR 0043 colour split). Each describe
// block cites the CR section it exercises; assertions check external behaviour
// only, through a real engine entry point.
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    moveCard,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { gauFeralYouth } from "../red";

const GAU_ID = gauFeralYouth.id;

/** Push a triggered ability onto the stack with its trigger event attached,
 *  then resolve it — the resolve-time half of the CR 603.4 intervening-if. */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
    });
    resolveTopOfStack(state);
}

const endStep = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

function setup(opts: { graveyard?: number; counters?: number } = {}) {
    const gau = makeInstance(GAU_ID, {
        id: "gau",
        controllerId: "p1",
        ownerId: "p1",
        ...(opts.counters ? { counters: { "+1/+1": opts.counters } } : {}),
    });
    const graveyard: CardInstanceState[] = Array.from(
        { length: opts.graveyard ?? 0 },
        (_, i) => ({
            id: `gy-${i}`,
            card: { id: GAU_ID },
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard" as const,
            isTapped: false,
        })
    );
    const state = makeState({
        phase: "END_STEP",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [gau], graveyard }),
            makePlayer("p2"),
        ],
    });
    return { state, gau };
}

describe("Gau, Feral Youth — Rage attack trigger (CR 207.2c / 122)", () => {
    it("`Rage` is an ability word, so it earns NO staticAbilities entry", () => {
        // CR 207.2c — ability words have no rules meaning. The card must not
        // smuggle one into the keyword surface, where Guard A would (rightly)
        // demand a Mechanics Registry row for it.
        expect(gauFeralYouth.staticAbilities ?? []).toEqual([]);
        expect(gauFeralYouth.oracleText).toContain("Rage —");
    });

    it("puts a +1/+1 counter on itself when it attacks", () => {
        const { state, gau } = setup();
        resolveTrigger(state, gau, "gau-feral-youth-rage", {
            type: "ATTACKERS_DECLARED",
            attackers: [{ id: "gau", controllerId: "p1" }],
            attackingPlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const live = state.players[0].battlefield.find((c) => c.id === "gau")!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        // The counter is what the CLIENT sees too — the projection strips fat
        // fields, and a counter the board never renders is a shipped bug.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "gau"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
    });
});

describe("Gau, Feral Youth — end-step damage (CR 603.4 / 400.7 / 120.1)", () => {
    it("does nothing when no card left your graveyard this turn", () => {
        const { state, gau } = setup({ graveyard: 1 });
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p1"));
        expect(state.players[1].life).toBe(20);
    });

    it("deals damage equal to its power to the opponent once a card left your graveyard", () => {
        const { state, gau } = setup({ graveyard: 1 });
        moveCard(state.players[0], "gy-0", "graveyard", "exile");
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p1"));
        expect(state.players[1].life).toBe(18); // 20 - 2 power
    });

    it("reads EFFECTIVE power at resolution — a Rage counter raises the damage (CR 613)", () => {
        const { state, gau } = setup({ graveyard: 1, counters: 3 });
        moveCard(state.players[0], "gy-0", "graveyard", "exile");
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p1"));
        expect(state.players[1].life).toBe(15); // 20 - (2 + 3)
    });

    it("fires and re-checks at BOTH end steps of the turn (CR 603.4)", () => {
        const { state, gau } = setup({ graveyard: 1 });
        moveCard(state.players[0], "gy-0", "graveyard", "exile");
        // The controller's own end step.
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p1"));
        expect(state.players[1].life).toBe(18);
        // The OPPONENT's end step, same turn's tally still standing: "each end
        // step" fires again, and nothing cleared the tally in between.
        state.activePlayerId = "p2";
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p2"));
        expect(state.players[1].life).toBe(16);
    });

    it("the CHECK-TIME half of the intervening if gates the trigger too (CR 603.4)", () => {
        const { state } = setup({ graveyard: 1 });
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "END_STEP" as const,
            activePlayerId: "p1",
        };
        // Nothing has left the graveyard: the ability does not even trigger.
        expect(
            collectTriggers(state, [event as never]).filter(
                (t) => t.triggeredAbilityId === "gau-feral-youth-end-step"
            )
        ).toHaveLength(0);
        moveCard(state.players[0], "gy-0", "graveyard", "exile");
        expect(
            collectTriggers(state, [event as never]).filter(
                (t) => t.triggeredAbilityId === "gau-feral-youth-end-step"
            )
        ).toHaveLength(1);
    });

    it("reads the CONTROLLER's graveyard, not the opponent's (CR 603.4 — 'your graveyard')", () => {
        const { state, gau } = setup();
        state.players[1].graveyard.push({
            id: "opp-gy",
            card: { id: GAU_ID },
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
            isTapped: false,
        });
        moveCard(state.players[1], "opp-gy", "graveyard", "exile");
        resolveTrigger(state, gau, "gau-feral-youth-end-step", endStep("p1"));
        expect(state.players[1].life).toBe(20);
    });
});
