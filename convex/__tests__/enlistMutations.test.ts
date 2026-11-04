// Enlist through the registered `game.ts` mutations (CR 508.1g / 702.154a, issue
// #4009). Same harness discipline as `combatDeclarationVersions.test.ts`: a stub
// `MutationCtx` driving each mutation's own `_handler`, never a reimplementation.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears, llanowarElves } from "../cards/sets/lea/green.cards";
import {
    autoTapForAttackTax,
    cancelAttackTax,
    confirmAttackers,
    declareAttackers,
    tapForAttackTax,
    toggleAttacker,
    toggleEnlist,
} from "../game";
import type { Id } from "../_generated/dataModel";
import type { CardInstanceState, GameState } from "../gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const BASE = { gameId: GAME_ID, playerId: "p1" };
const PAIR = { attackerId: "attacker", enlistedId: "partner" };

function creature(
    id: string,
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...over,
    });
}

function openState(
    battlefield: CardInstanceState[] = [
        creature("attacker", { staticAbilities: ["enlist"] }),
        creature("partner"),
    ],
    combat: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield }),
            makePlayer("p2", { battlefield: [] }),
        ],
        combat: {
            attackerIds: ["attacker"],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combat,
        },
    });
}

const stub = (state: GameState) =>
    makeMutationCtx("p1", [gameStateSeed(state, 1)]);

const run = <A, R = unknown>(mutation: unknown, h: MutationStub, args: A) =>
    runMutation<typeof BASE & A, R>(
        mutation as unknown as Handler<never, never>,
        h.ctx,
        { ...BASE, ...args }
    );

const saved = (h: MutationStub): GameState => h.state();

describe("toggleEnlist (CR 508.1g / 702.154a)", () => {
    it("records the choice while the declaration is open", async () => {
        const h = stub(openState());
        await run(toggleEnlist, h, PAIR);
        expect(saved(h).combat?.enlists).toEqual([PAIR]);
    });

    it("refuses a creature that can't pay, and saves nothing", async () => {
        const h = stub(
            openState([
                creature("attacker", { staticAbilities: ["enlist"] }),
                creature("partner", { isSummoningSick: true }),
            ])
        );
        await expect(run(toggleEnlist, h, PAIR)).rejects.toThrow(
            /can't be tapped to enlist/
        );
    });

    it("refuses once the declaration is locked in", async () => {
        const h = stub(openState(undefined, { confirmed: true }));
        await expect(run(toggleEnlist, h, PAIR)).rejects.toThrow();
    });

    it("refuses a caller who isn't the active player", async () => {
        const state = openState();
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        await expect(run(toggleEnlist, stub(state), PAIR)).rejects.toThrow();
    });
});

describe("declareAttackers carries the enlist costs in one version", () => {
    it("declares and chooses together", async () => {
        const h = stub(openState(undefined, { attackerIds: [] }));
        const result = await run<
            { attackerIds: string[]; enlists: (typeof PAIR)[] },
            { rejected: unknown[] }
        >(declareAttackers, h, { attackerIds: ["attacker"], enlists: [PAIR] });
        expect(result.rejected).toEqual([]);
        expect(saved(h).combat?.enlists).toEqual([PAIR]);
        expect(h.writes.filter((w) => w.id === "gs-1")).toHaveLength(1);
    });

    it("re-sending a choice in place changes nothing and costs no version", async () => {
        const h = stub(openState(undefined, { enlists: [PAIR] }));
        await run(declareAttackers, h, {
            attackerIds: ["attacker"],
            enlists: [PAIR],
        });
        expect(h.writes.filter((w) => w.id === "gs-1")).toHaveLength(0);
    });

    it("reports a refused partner and keeps the attack", async () => {
        const h = stub(
            openState(
                [
                    creature("attacker", { staticAbilities: ["enlist"] }),
                    creature("partner", { isTapped: true }),
                ],
                { attackerIds: [] }
            )
        );
        const result = await run<
            { attackerIds: string[]; enlists: (typeof PAIR)[] },
            { rejected: { cardInstanceId: string }[] }
        >(declareAttackers, h, { attackerIds: ["attacker"], enlists: [PAIR] });
        expect(result.rejected.map((r) => r.cardInstanceId)).toEqual([
            "partner",
        ]);
        expect(saved(h).combat?.attackerIds).toEqual(["attacker"]);
    });
});

describe("the selection keeps the choice meaningful (CR 702.154a)", () => {
    it("withdrawing the attacker withdraws its choice", async () => {
        const h = stub(openState(undefined, { enlists: [PAIR] }));
        await run(toggleAttacker, h, { cardInstanceId: "attacker" });
        expect(saved(h).combat?.enlists).toBeUndefined();
    });

    it("choosing the partner to attack withdraws the choice", async () => {
        const h = stub(openState(undefined, { enlists: [PAIR] }));
        await run(toggleAttacker, h, { cardInstanceId: "partner" });
        expect(saved(h).combat?.enlists).toBeUndefined();
    });
});

describe("confirmAttackers pays what was chosen (CR 508.1j)", () => {
    it("taps the partner and puts the trigger on the stack", async () => {
        const h = stub(openState(undefined, { enlists: [PAIR] }));
        await run(confirmAttackers, h, {});
        const after = saved(h);
        expect(
            after.players[0].battlefield.find((c) => c.id === "partner")
                ?.isTapped
        ).toBe(true);
        expect(after.stack.map((i) => i.triggeredAbilityId)).toContain(
            "enlist"
        );
    });

    it("a must-attack partner folded in at confirm pays nothing (CR 508.1d)", async () => {
        const h = stub(
            openState(
                [
                    creature("attacker", { staticAbilities: ["enlist"] }),
                    creature("partner", { mustAttackThisTurn: true }),
                ],
                { enlists: [PAIR] }
            )
        );
        await run(confirmAttackers, h, {});
        const after = saved(h);
        expect(after.combat?.attackerIds).toContain("partner");
        expect(after.combat?.enlists).toBeUndefined();
    });
});

describe("the attack tax can't spend a chosen partner (CR 508.1h/1j)", () => {
    function taxed(): GameState {
        const elves = makeInstance(llanowarElves().id, {
            id: "partner",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return openState(
            [creature("attacker", { staticAbilities: ["enlist"] }), elves],
            {
                enlists: [PAIR],
                pendingAttackManaTax: {
                    playerId: "p1",
                    cost: { generic: 1 },
                    tappedLandIds: [],
                } as never,
            }
        );
    }

    it("a manual tap of the partner is refused", async () => {
        const h = stub(taxed());
        await expect(
            run(tapForAttackTax, h, { cardInstanceId: "partner" })
        ).rejects.toThrow(/tapping to enlist/);
    });

    it("cancelling the tax withdraws the choice with the attackers (CR 508.1g)", async () => {
        const h = stub(taxed());
        await run(cancelAttackTax, h, {});
        expect(saved(h).combat?.attackerIds).toEqual([]);
        expect(saved(h).combat?.enlists).toBeUndefined();
    });

    it("auto-tap leaves the partner untapped", async () => {
        const h = stub(taxed());
        await run(autoTapForAttackTax, h, {});
        expect(
            saved(h).players[0].battlefield.find((c) => c.id === "partner")
                ?.isTapped
        ).toBe(false);
    });
});
