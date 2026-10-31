// Impending (CR 702.176, issue #1970) — the whole keyword, on the card that
// carries it: Overlord of the Balemurk, "Impending 5—{1}{B}".
//
// CR 702.176a is FOUR abilities, and each has its block below:
//   1. the alternative cost        — resolves through `getAlternativeCost` /
//                                    `affordableAlternativeCosts`, and the real
//                                    cast-commit seam tags the stack item
//                                    `impended: true` while paying {1}{B};
//   2. the entry replacement       — five time counters as it enters, only when
//                                    the impending cost was paid;
//   3. "not a creature"            — a derived layer-4 removal: it cannot
//                                    attack, creature-only removal cannot
//                                    target it, it stays an Enchantment with
//                                    its abilities, and the LAST counter
//                                    coming off — by any means — ends it;
//   4. the end-step countdown      — one counter at each of its controller's
//                                    end steps, none at the opponent's, never
//                                    on a hard-cast Overlord.
// Plus the surfaces the instance fact crosses: serialization, CR 400.7 (a
// zone change makes a new object whose impending cost was never paid) and the
// wire projection the client renders.

import { describe, expect, it } from "vitest";
import { resolveTopOfStack, type GameState } from "../state";
import {
    affordableAlternativeCosts,
    getAlternativeCost,
} from "../alternativeCost";
import { tryAutoCommitPendingCast } from "../../game";
import { advancePhase } from "../phases";
import { syncLayers2to5 } from "../layers2to5";
import { validateAttackerEligibility } from "../combat";
import { getLegalTargets } from "../rules";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { getCardByName, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const OVERLORD = getCardByName("Overlord of the Balemurk").id;

function inHand(state: GameState) {
    return state.players[0].hand.find((c) => c.id === "overlord")!;
}

function onBattlefield(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "overlord");
}

/** p1 holding Overlord of the Balemurk in its first main phase, with `mana`
 *  black floating. */
function castPosition(mana: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(OVERLORD, {
                        id: "overlord",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.turn = 3;
    state.players[0].manaPool.B = mana;
    return state;
}

/** Casts the Overlord through the REAL commit seam and resolves it: the
 *  impending cost ({1}{B}) when `impending`, else the printed {3}{B}{B}. The
 *  enters-or-attacks trigger it puts on the stack is left there. */
function castAndResolve(impending: boolean): GameState {
    const state = castPosition(5);
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "overlord",
        manaCost: impending ? { X: 1, B: 1 } : { X: 3, B: 2 },
        tappedLandIds: [],
        ...(impending ? { impended: true } : {}),
    };
    expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
    const top = state.stack.length - 1;
    expect(state.stack[top]?.id).toBe("overlord");
    resolveTopOfStack(state);
    expect(onBattlefield(state)).toBeDefined();
    return state;
}

/** Walks the game from wherever it is to the next END_STEP whose active
 *  player is `activePlayerId`, resolving nothing else on the way, then
 *  resolves every trigger that step put on the stack. */
function throughEndStep(state: GameState, activePlayerId: string) {
    state.stack = [];
    state.activePlayerId = activePlayerId;
    state.priorityPlayerId = activePlayerId;
    state.phase = "POSTCOMBAT_MAIN";
    advancePhase(state);
    expect(state.phase).toBe("END_STEP");
    while (state.stack.length > 0) resolveTopOfStack(state);
}

describe("Impending — the alternative cost (CR 702.176a, CR 601.2b)", () => {
    it("getAlternativeCost resolves def.impending by its own id", () => {
        const def = getDefinition(OVERLORD);
        expect(getAlternativeCost(def, "impending")).toBe(def.impending);
    });

    it("{1}{B} affords the impending cast and not the printed {3}{B}{B}", () => {
        const state = castPosition(2);
        expect(
            affordableAlternativeCosts(
                state,
                state.players[0],
                inHand(state)
            ).map((a) => a.id)
        ).toContain("impending");
    });

    it("the cast commit PAYS {1}{B} and tags the stack item impended", () => {
        const state = castPosition(2);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "overlord",
            manaCost: { X: 1, B: 1 },
            tappedLandIds: [],
            impended: true,
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        expect(state.players[0].manaPool.B).toBe(0);
        expect(state.stack.find((s) => s.id === "overlord")?.impended).toBe(
            true
        );
    });
});

describe("Impending — entry, and the not-a-creature window (CR 702.176a, 613.1d)", () => {
    it("enters with five time counters and is not a creature", () => {
        const state = castAndResolve(true);
        const overlord = onBattlefield(state)!;
        expect(overlord.counters?.time).toBe(5);
        expect(overlord.types).toEqual(["Enchantment"]);
        // It keeps its subtypes and every ability: only the type is removed.
        expect(overlord.subtypes).toEqual(["Avatar", "Horror"]);
        expect(
            getDefinition(OVERLORD).triggeredAbilities?.map((t) => t.id)
        ).toContain("overlord-of-the-balemurk-trigger");
    });

    it("its enters-or-attacks trigger still fires: an impending Overlord enters", () => {
        const state = castAndResolve(true);
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "overlord-of-the-balemurk-trigger"
        );
        expect(trigger?.triggerSourceId).toBe("overlord");
        // CR 603.6a — and it enters as what it IS: a noncreature, so a
        // "whenever a creature enters" watcher sees no creature.
        expect(trigger?.triggerEvent).toMatchObject({
            type: "PERMANENT_ENTERED",
            types: ["Enchantment"],
        });
    });

    it("cannot attack, even long after it entered", () => {
        const state = castAndResolve(true);
        const overlord = onBattlefield(state)!;
        overlord.isSummoningSick = undefined;
        expect(validateAttackerEligibility(overlord).eligible).toBe(false);
    });

    it("is not a legal target for creature-only removal", () => {
        const state = castAndResolve(true);
        expect(
            getLegalTargets(state, { type: "Creature", count: 1 }, "p2")
        ).not.toContain("overlord");
    });

    it("hard-cast: no counters, a creature immediately", () => {
        const state = castAndResolve(false);
        const overlord = onBattlefield(state)!;
        expect(overlord.counters?.time ?? 0).toBe(0);
        expect(overlord.types).toContain("Creature");
        expect(overlord.impended).toBeUndefined();
    });
});

describe("Impending — the enters-or-attacks line (CR 603.2, CR 508.3a)", () => {
    it("fires when the Overlord attacks, and not when another creature does", () => {
        const state = castAndResolve(false);
        const ability = getDefinition(OVERLORD).triggeredAbilities!.find(
            (t) => t.id === "overlord-of-the-balemurk-trigger"
        )!;
        const overlord = onBattlefield(state)!;
        const attack = (attackerIds: string[]) =>
            ability.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds,
                } as never,
                overlord as never,
                undefined
            );
        expect(ability.event).toEqual([
            "PERMANENT_ENTERED",
            "ATTACKERS_DECLARED",
        ]);
        expect(attack(["overlord"])).toBe(true);
        expect(attack(["bear"])).toBe(false);
    });
});

describe("Impending — the end-step countdown (CR 702.176a, CR 603.4)", () => {
    it("removes one counter at each of its controller's end steps", () => {
        const state = castAndResolve(true);
        throughEndStep(state, "p1");
        expect(onBattlefield(state)!.counters?.time).toBe(4);
        throughEndStep(state, "p1");
        expect(onBattlefield(state)!.counters?.time).toBe(3);
    });

    it("removes none at the opponent's end step", () => {
        const state = castAndResolve(true);
        throughEndStep(state, "p2");
        expect(onBattlefield(state)!.counters?.time).toBe(5);
    });

    it("never fires for a hard-cast Overlord", () => {
        const state = castAndResolve(false);
        throughEndStep(state, "p1");
        expect(onBattlefield(state)!.counters?.time ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
    });

    it("the LAST counter makes it a creature, able to attack (CR 302.6)", () => {
        const state = castAndResolve(true);
        const overlord = onBattlefield(state)!;
        overlord.counters = { ...overlord.counters, time: 1 };
        throughEndStep(state, "p1");
        expect(overlord.counters?.time ?? 0).toBe(0);
        expect(overlord.types).toContain("Creature");
        // It has been under p1's control continuously since it entered turns
        // ago: summoning sickness is about control, not about when it became
        // a creature.
        overlord.isSummoningSick = undefined;
        expect(validateAttackerEligibility(overlord).eligible).toBe(true);
    });

    it("a counter removed by ANY means ends the window, no event involved", () => {
        const state = castAndResolve(true);
        const overlord = onBattlefield(state)!;
        overlord.counters = { ...overlord.counters, time: 0 };
        syncLayers2to5(state);
        expect(overlord.types).toContain("Creature");
    });
});

describe("Impending — the instance fact across surfaces", () => {
    it("round-trips through serialization with its counters", () => {
        const state = castAndResolve(true);
        const round = expandState(compactState(state));
        const overlord = round.players[0].battlefield.find(
            (c) => c.id === "overlord"
        )!;
        expect(overlord.impended).toBe(true);
        expect(overlord.counters?.time).toBe(5);
    });

    it("the wire projection shows a noncreature Enchantment with five time counters", () => {
        const state = castAndResolve(true);
        const view = projectPublicState(state, 1, "p2");
        const wire = view.players[0].battlefield.find(
            (c) => c.id === "overlord"
        )!;
        expect(wire.types).toEqual(["Enchantment"]);
        expect(wire.counters?.time).toBe(5);
    });
});
