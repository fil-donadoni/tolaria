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
import { advancePhase } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

// The registry seam (ADR 0046): the card is reached by ID through
// `makeInstance`, never by importing its definition out of the set module.
const GAU_ID = "89175ce1-0746-4ba1-970e-617d134b0527";

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

// CR 207.2c — `Rage` is an ability WORD: no rules meaning, no Mechanics
// Registry row, and so nothing on `staticAbilities`. That is not asserted here
// (a definition read that calls nothing is the definition written twice) —
// `mechanicsRegistry.test.ts` fails catalogue-wide on a shipped keyword with no
// `implemented` row, which is exactly the guard an invented "rage" keyword
// would trip.
describe("Gau, Feral Youth — Rage attack trigger (CR 207.2c / 122)", () => {
    it("puts a +1/+1 counter on itself when it attacks", () => {
        const { state, gau } = setup();
        resolveTrigger(state, gau, "gau-feral-youth-rage", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: ["gau"],
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

    it("the opponent's end step is a LATER TURN, so the tally has reset (CR 500.1 / 513.1)", () => {
        // "At the beginning of EACH end step" fires in every player's turn,
        // but there is exactly one end step per turn — so the second firing is
        // in the OPPONENT's turn, reading that turn's own tally. Walked through
        // the real phase machine rather than by hand-setting `activePlayerId`,
        // which would fabricate a state the engine never produces.
        const { state } = setup({ graveyard: 1 });
        moveCard(state.players[0], "gy-0", "graveyard", "exile");
        const gauTrigger = (s: GameState, activePlayerId: string) =>
            collectTriggers(s, [
                {
                    type: "PHASE_BEGIN" as const,
                    phase: "END_STEP" as const,
                    activePlayerId,
                } as never,
            ]).filter(
                (t) => t.triggeredAbilityId === "gau-feral-youth-end-step"
            );
        // This turn's end step: the departure happened, so it fires.
        expect(gauTrigger(state, "p1")).toHaveLength(1);
        // Into the opponent's turn. Nothing has left the graveyard during it.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.players[0].leftGraveyardThisTurn).toBeUndefined();
        expect(gauTrigger(state, "p2")).toHaveLength(0);
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
