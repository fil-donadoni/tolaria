// A chosen-colour land-mana substitution (CR 614.1a, `landManaSubstitution:
// { chosenColor }`) — Pulse of Llanowar: "If a basic land you control is
// tapped for mana, it produces mana of a color of your choice instead of any
// other type."
//
//  1. **Scope** — a basic land (CR 205.4c) its controller controls offers one
//     tap option per colour; an opponent's basic and a nonbasic do not.
//  2. **Ordering, CR 616.1** — the controller orders the replacements, so the
//     picked colour is final under the fixed substitutions; a result only
//     another ordering reaches (Chaos Moon's {C}) is offered too; an additive
//     rider (High Tide) still adds on top.
//  3. **CR 106.7 "could produce"** — every colour, for castability and the
//     planner; full path through `announceCast` + `autoTapForPayment`.

import { describe, it, expect } from "vitest";
import {
    getManaTapOptions,
    getManaTapOptionsDetailed,
    getProducibleColorsOnBoard,
    manaGateBattlefields,
} from "../constants";
import { getPlayer, type GameState } from "../state";
import { buildAutoTapSources, solveAutoTap } from "../autoTap";
import {
    announceCast,
    autoTapForPayment,
    tapSourceIntoPayment,
} from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { pulseOfLlanowar } from "../../cards/sets/inv/green.cards";
import { infernalDarkness } from "../../cards/sets/ice/black.cards";
import { monssGoblinRaiders } from "../../cards/sets/lea/red.cards";
import {
    forest,
    island,
    mountain,
    taiga,
} from "../../cards/sets/lea/colorless.cards";
import type { Id } from "../../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const FIVE = [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }];

const bf = (state: GameState) =>
    state.players.map((p) => ({ playerId: p.id, battlefield: p.battlefield }));

const perm = (cardId: string, id: string, controllerId: string) =>
    makeInstance(cardId, { id, controllerId, ownerId: controllerId });

/** p1: a Forest, a Mountain, an Island, a Taiga + `extraP1`; p2: a Forest + `extraP2`. */
function board(
    extraP1: ReturnType<typeof makeInstance>[] = [],
    extraP2: ReturnType<typeof makeInstance>[] = [],
    hand: ReturnType<typeof makeInstance>[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand,
                battlefield: [
                    perm(forest().id, "frs", "p1"),
                    perm(mountain().id, "mtn", "p1"),
                    perm(island().id, "isl", "p1"),
                    perm(taiga().id, "taiga", "p1"),
                    ...extraP1,
                ],
                manaPool: { ...POOL0 },
            }),
            makePlayer("p2", {
                battlefield: [perm(forest().id, "opp-frs", "p2"), ...extraP2],
                manaPool: { ...POOL0 },
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const card = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

const options = (state: GameState, id: string) => {
    const c = card(state, id);
    return getManaTapOptions(c, c.controllerId, bf(state));
};

const withPulse = (extraP1: ReturnType<typeof makeInstance>[] = []) =>
    board([perm(pulseOfLlanowar().id, "pulse", "p1"), ...extraP1]);

describe("Pulse of Llanowar — scope (CR 614.1a, CR 205.4c)", () => {
    it("a basic land you control offers one option per colour", () => {
        const state = withPulse();
        expect(options(state, "frs")).toEqual(FIVE);
        expect(options(state, "mtn")).toEqual(FIVE);
    });

    it("an opponent's basic and your own nonbasic keep their own mana", () => {
        const state = withPulse();
        expect(options(state, "opp-frs")).toEqual([{ G: 1 }]);
        expect(options(state, "taiga")).toEqual([{ R: 1 }, { G: 1 }]);
    });

    it("without Pulse a Forest is a single {G} option (delta zero)", () => {
        expect(options(board(), "frs")).toEqual([{ G: 1 }]);
    });

    it("two Pulses still offer the five colours once", () => {
        const state = withPulse([perm(pulseOfLlanowar().id, "pulse2", "p1")]);
        expect(options(state, "frs")).toEqual(FIVE);
    });

    it("an opponent's Pulse does not reach your basic", () => {
        const state = board([], [perm(pulseOfLlanowar().id, "pulse", "p2")]);
        expect(options(state, "frs")).toEqual([{ G: 1 }]);
        expect(options(state, "opp-frs")).toEqual(FIVE);
    });

    it("the picked colour is what reaches the pool", () => {
        const state = withPulse();
        const player = getPlayer(state, "p1");
        // index 3 = {R}
        tapSourceIntoPayment(state, player, card(state, "frs"), 3, []);
        expect(player.manaPool).toMatchObject({ R: 1, G: 0 });
    });
});

describe("Pulse of Llanowar — replacement ordering (CR 616.1)", () => {
    it("with Infernal Darkness a controlled Forest still taps for any colour", () => {
        const state = withPulse([perm(infernalDarkness().id, "dark", "p2")]);
        expect(options(state, "frs")).toEqual(FIVE);
        // The opponent's Forest is outside Pulse's scope: Darkness alone.
        expect(options(state, "opp-frs")).toEqual([{ B: 1 }]);
        const player = getPlayer(state, "p1");
        tapSourceIntoPayment(state, player, card(state, "frs"), 4, []);
        expect(player.manaPool).toMatchObject({ G: 1, B: 0 });
    });

    it("with Chaos Moon's Mountain override a controlled Mountain adds {C} to the five", () => {
        const state = withPulse();
        state.landManaRidersThisTurn = [
            { subtype: "Mountain", color: "C", mode: "override" },
        ];
        const mtn = card(state, "mtn");
        const manual = getManaTapOptionsDetailed(
            mtn,
            "p1",
            bf(state),
            undefined,
            undefined,
            state
        ).map((o) => o.mana);
        expect(manual).toEqual([...FIVE, { C: 1 }]);
        // The automatic planner's list keeps the primary indices only.
        const planner = getManaTapOptionsDetailed(
            mtn,
            "p1",
            bf(state),
            { requireTap: true },
            undefined,
            state
        ).map((o) => o.mana);
        expect(planner).toEqual(FIVE);
        // The appended {C} is a legal pick on the server and is not rewritten.
        const player = getPlayer(state, "p1");
        tapSourceIntoPayment(state, player, mtn, 5, []);
        expect(player.manaPool).toMatchObject({ C: 1, R: 0 });
    });

    it("with High Tide a controlled Island adds the chosen colour plus the extra {U}", () => {
        const state = withPulse();
        state.highTideThisTurn = ["p1"];
        const player = getPlayer(state, "p1");
        // index 2 = {B}
        tapSourceIntoPayment(state, player, card(state, "isl"), 2, []);
        expect(player.manaPool).toMatchObject({ B: 1, U: 1 });
    });
});

describe("Pulse of Llanowar — could produce (CR 106.7)", () => {
    it("a controlled basic could produce every colour; the opponent's only its own", () => {
        const state = withPulse();
        expect(
            getProducibleColorsOnBoard(card(state, "frs"), bf(state))
        ).toEqual(new Set(["W", "U", "B", "R", "G"]));
        expect(
            getProducibleColorsOnBoard(card(state, "opp-frs"), bf(state))
        ).toEqual(new Set(["G"]));
    });

    it("under Chaos Moon's override a controlled Mountain could also produce {C}", () => {
        const state = withPulse();
        state.landManaRidersThisTurn = [
            { subtype: "Mountain", color: "C", mode: "override" },
        ];
        expect(
            getProducibleColorsOnBoard(
                card(state, "mtn"),
                bf(state),
                0,
                true,
                state
            )
        ).toEqual(new Set(["W", "U", "B", "R", "G", "C"]));
    });

    it("full path: the planner pays a {R} creature from a Forest alone", async () => {
        const state = withPulse();
        const p1 = state.players[0];
        p1.battlefield = p1.battlefield.filter(
            (c) => c.id === "frs" || c.id === "pulse"
        );
        p1.hand = [
            makeInstance(monssGoblinRaiders().id, {
                id: "raiders",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
        ];
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        const run = (mutation: unknown, args: Record<string, unknown>) =>
            runMutation(
                mutation as Handler<Record<string, unknown>, void>,
                harness.ctx,
                { gameId: "game-1" as Id<"games">, playerId: "p1", ...args }
            );
        await run(announceCast, { cardInstanceId: "raiders" });
        if (harness.state().pendingCast) {
            await run(autoTapForPayment, {});
        }
        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((i) => i.card.id)).toEqual([
            monssGoblinRaiders().id,
        ]);
        expect(
            getPlayer(after, "p1").battlefield.find((c) => c.id === "frs")
                ?.isTapped
        ).toBe(true);
    });
});

describe("Pulse of Llanowar — the auto-tap search stays polynomial (CR 601.2g)", () => {
    // Eight basics that each tap for any colour: an unmemoised walk of a cost
    // it cannot pay expands ~6^8 search nodes. Counted, not timed: every node
    // the solver expands reads its source's option list once.
    it("an unpayable cost over eight any-colour Forests expands few search nodes", () => {
        const forests = Array.from({ length: 8 }, (_, i) =>
            perm(forest().id, `f${i}`, "p1")
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        perm(pulseOfLlanowar().id, "pulse", "p1"),
                        ...forests,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        let expanded = 0;
        const sources = buildAutoTapSources(
            state.players[0].battlefield,
            manaGateBattlefields(state),
            undefined,
            state
        ).map((src) => {
            const options = src.options;
            return Object.defineProperty({ ...src }, "options", {
                get: () => {
                    expanded++;
                    return options;
                },
            });
        });
        expect(sources.every((s) => s.options.length >= 5)).toBe(true);
        expanded = 0;
        // {C} is a type no Forest under Pulse produces.
        expect(
            solveAutoTap(
                {},
                { W: 1, U: 1, B: 1, R: 1, G: 1, C: 1 },
                [],
                sources
            )
        ).toBeNull();
        expect(expanded).toBeLessThan(20_000);
    });
});
