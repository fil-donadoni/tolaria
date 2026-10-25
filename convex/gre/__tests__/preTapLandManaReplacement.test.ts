// Pre-tap readers see the mana a tap WOULD add under an active land-mana
// replacement (CR 106.7 "could produce" + CR 614) — Infernal Darkness, Naked
// Singularity, Reality Twist, Deep Water, False Dawn.
//
//  1. **Tap options + planner + "could produce"** read the substituted type.
//  2. **One funnel** — `applyLandManaReplacement` re-applied to an option that
//     already carries the substitution never rewrites it twice, and the
//     additive riders (High Tide) are applied once, at the pool.
//  3. **Full path** — `announceCast` + `autoTapForPayment` through the
//     registered mutations: castable exactly when the substituted mana pays.

import { describe, it, expect } from "vitest";
import {
    applyLandManaReplacement,
    getManaTapOptions,
    getProducibleColorsOnBoard,
    manaGateBattlefields,
} from "../constants";
import { buildAutoTapSources } from "../autoTap";
import { getPlayer, type GameState } from "../state";
import { tapSourceIntoPayment } from "../../game";
import { announceCast, autoTapForPayment, selectTargets } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../state";
import { falseDawn } from "../../cards/sets/apc/white.cards";
import { divineLight } from "../../cards/sets/apc/white.cards";
import { infernalDarkness } from "../../cards/sets/ice/black.cards";
import { realityTwist } from "../../cards/sets/ice/blue.cards";
import { nakedSingularity } from "../../cards/sets/ice/colorless.cards";
import { darkRitual } from "../../cards/sets/lea/black.cards";
import { giantGrowth } from "../../cards/sets/lea/green.cards";
import { ancestralRecall } from "../../cards/sets/lea/blue.cards";
import { forest, island, mountain } from "../../cards/sets/lea/colorless.cards";
import type { Id } from "../../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

const bf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

/** p1: a Forest, a Mountain and `hand`; p2: a Forest. Plus `extraP1` permanents. */
function board(
    hand: ReadonlyArray<{ id: string; cardId: string }> = [],
    extraP1: ReadonlyArray<ReturnType<typeof makeInstance>> = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: hand.map((h) =>
                    makeInstance(h.cardId, {
                        id: h.id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    })
                ),
                battlefield: [
                    makeInstance(forest().id, {
                        id: "frs",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(mountain().id, {
                        id: "mtn",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...extraP1,
                ],
                manaPool: { ...POOL0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(forest().id, {
                        id: "opp-frs",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const permanent = (cardId: string, id: string, controllerId = "p2") =>
    makeInstance(cardId, { id, controllerId, ownerId: controllerId });

const forestOf = (state: GameState, pid = "p1") =>
    getPlayer(state, pid).battlefield.find((c) => c.id.includes("frs"))!;

const sourceOptionColors = (state: GameState, pid: string, cardId: string) => {
    const player = getPlayer(state, pid);
    const src = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state),
        undefined,
        state
    ).find((s) => s.cardId === cardId);
    return src?.options.map((o) => o.mana);
};

describe("Infernal Darkness — every land taps for {B} (CR 106.7 / 614)", () => {
    const withDarkness = () =>
        board([], [permanent(infernalDarkness().id, "dark", "p1")]);

    it("the tap option list shows {B}, not {G}", () => {
        const state = withDarkness();
        expect(getManaTapOptions(forestOf(state), "p1", bf(state))).toEqual([
            { B: 1 },
        ]);
    });

    it("'could produce' reports {B} for a Forest", () => {
        const state = withDarkness();
        expect([
            ...getProducibleColorsOnBoard(forestOf(state), bf(state)),
        ]).toEqual(["B"]);
    });

    it("the planner counts the Forest as a {B} source, for either player", () => {
        const state = withDarkness();
        expect(sourceOptionColors(state, "p1", "frs")).toEqual([{ B: 1 }]);
        expect(sourceOptionColors(state, "p2", "opp-frs")).toEqual([{ B: 1 }]);
    });

    it("without the substitution the Forest is still {G} (delta zero)", () => {
        const state = board();
        expect(getManaTapOptions(forestOf(state), "p1", bf(state))).toEqual([
            { G: 1 },
        ]);
        expect(sourceOptionColors(state, "p1", "frs")).toEqual([{ G: 1 }]);
    });

    it("tapping adds {B} exactly once — the funnel does not re-apply to the option", () => {
        const state = withDarkness();
        const player = getPlayer(state, "p1");
        tapSourceIntoPayment(state, player, forestOf(state), undefined, []);
        expect(player.manaPool).toMatchObject({ B: 1, G: 0 });
    });

    it("the funnel is idempotent on an already-substituted option; High Tide still adds once", () => {
        const state = withDarkness();
        const frs = forestOf(state);
        const opt = getManaTapOptions(frs, "p1", bf(state))[0];
        expect(applyLandManaReplacement(state, "p1", frs, opt)).toEqual({
            B: 1,
        });
        state.highTideThisTurn = ["p1"];
        const isl = makeInstance(island().id, {
            id: "isl",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(isl);
        const islOpt = getManaTapOptions(isl, "p1", bf(state))[0];
        expect(islOpt).toEqual({ B: 1 });
        expect(applyLandManaReplacement(state, "p1", isl, islOpt)).toEqual({
            B: 1,
            U: 1,
        });
    });
});

describe("Naked Singularity / Reality Twist — a basic taps for its mapped colour", () => {
    for (const [name, card] of [
        ["Naked Singularity", nakedSingularity],
        ["Reality Twist", realityTwist],
    ] as const) {
        it(`${name}: the option and the pool agree on the mapped colour, once`, () => {
            const state = board([], [permanent(card().id, "sub", "p1")]);
            const frs = forestOf(state);
            // The mapped colour is what the pool-time funnel yields for a {G}
            // tap — the single authority the pre-tap view must agree with.
            const mapped = applyLandManaReplacement(state, "p1", frs, {
                G: 1,
            });
            const [color] = Object.keys(mapped);
            expect(mapped).toEqual({ [color]: 1 });
            const options = getManaTapOptions(frs, "p1", bf(state));
            expect(options).toEqual([mapped]);
            expect([...getProducibleColorsOnBoard(frs, bf(state))]).toEqual(
                color === "C" ? [] : [color]
            );
            const player = getPlayer(state, "p1");
            tapSourceIntoPayment(state, player, frs, undefined, []);
            const pool = player.manaPool as Record<string, number>;
            expect(pool[color]).toBe(1);
            expect(Object.values(pool).reduce((a, b) => a + b, 0)).toBe(1);
        });
    }
});

describe("Deep Water — the controller's lands count as {U} sources (CR 614)", () => {
    it("p1's Forest is {U} to the planner and the picker, p2's Forest stays {G}", () => {
        const state = board();
        state.landManaReplacedToBlueThisTurn = ["p1"];
        expect(sourceOptionColors(state, "p1", "frs")).toEqual([{ U: 1 }]);
        expect(sourceOptionColors(state, "p2", "opp-frs")).toEqual([{ G: 1 }]);
        expect(
            getProducibleColorsOnBoard(
                forestOf(state),
                bf(state),
                0,
                false,
                state
            )
        ).toEqual(new Set(["U"]));
        expect(
            getProducibleColorsOnBoard(
                forestOf(state, "p2"),
                bf(state),
                0,
                false,
                state
            )
        ).toEqual(new Set(["G"]));
    });
});

describe("False Dawn — a Mountain is a {W} source for its controller (CR 614.1a / 106.3)", () => {
    it("the planner reads {W}; the opponent's mana is untouched", () => {
        const state = board();
        pushSpell(state, falseDawn().id, "p1");
        resolveTopOfStack(state);
        expect(sourceOptionColors(state, "p1", "mtn")).toEqual([{ W: 1 }]);
        expect(sourceOptionColors(state, "p2", "opp-frs")).toEqual([{ G: 1 }]);
    });
});

describe("full path — announceCast + autoTapForPayment (CR 106.7)", () => {
    const run = (
        harness: ReturnType<typeof makeMutationCtx>,
        mutation: unknown,
        args: Record<string, unknown>
    ) =>
        runMutation(
            mutation as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, ...args }
        );

    it("Infernal Darkness: {B} Dark Ritual is payable by Forests alone", async () => {
        const state = board(
            [{ id: "ritual", cardId: darkRitual().id }],
            [permanent(infernalDarkness().id, "dark", "p1")]
        );
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "mtn"
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, announceCast, { cardInstanceId: "ritual" });
        if (harness.state().pendingCast) {
            await run(harness, autoTapForPayment, {});
        }
        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((i) => i.card.id)).toEqual([darkRitual().id]);
        expect(
            getPlayer(after, "p1").battlefield.find((c) => c.id === "frs")
                ?.isTapped
        ).toBe(true);
    });

    it("Infernal Darkness: a {G} spell is NOT castable from Forests alone", async () => {
        const state = board(
            [{ id: "growth", cardId: giantGrowth().id }],
            [permanent(infernalDarkness().id, "dark", "p1")]
        );
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "mtn"
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            run(harness, announceCast, { cardInstanceId: "growth" })
        ).rejects.toThrow();
    });

    it("False Dawn: Divine Light ({W}) is castable with only a Mountain", async () => {
        const state = board([{ id: "light", cardId: divineLight().id }]);
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id === "mtn"
        );
        pushSpell(state, falseDawn().id, "p1");
        resolveTopOfStack(state);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, announceCast, { cardInstanceId: "light" });
        if (harness.state().pendingCast) {
            await run(harness, autoTapForPayment, {});
        }
        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((i) => i.card.id)).toContain(divineLight().id);
    });

    it("Deep Water: a {U} spell is castable with only Forests", async () => {
        const state = board([{ id: "recall", cardId: ancestralRecall().id }]);
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id === "frs"
        );
        state.landManaReplacedToBlueThisTurn = ["p1"];
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, announceCast, { cardInstanceId: "recall" });
        await run(harness, selectTargets, {
            targets: [{ targetType: "player", targetId: "p1" }],
        });
        if (harness.state().pendingCast) {
            await run(harness, autoTapForPayment, {});
        }
        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((i) => i.card.id)).toEqual([
            ancestralRecall().id,
        ]);
    });
});
