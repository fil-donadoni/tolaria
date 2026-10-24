// CR 404.1 + CR 601.2c — "up to three target cards from a single graveyard":
// the cross-slot `sameController` constraint read on the graveyard's OWNER.
// Offered set (`getLegalTargets`), accepted set (`selectTarget`, the real
// mutation handler), the bot's tuple enumeration and the client mirror
// (`matchesGraveyardTarget`) all route through the one registry.

import { describe, it, expect } from "vitest";
import { selectTarget } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { blackLotus } from "../cards/sets/lea/colorless.cards";
import type { GameState, PendingTarget } from "../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../gre/rules";
import { enumerateRaisedTargetMoves } from "../gre/moves";
import type { TargetRequirement } from "../cards/types";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
};

const pick = (
    ctx: Parameters<typeof runMutation>[1],
    targetId: string,
    targetPlayerId: string
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            targetType: "graveyard-card",
            targetId,
            targetPlayerId,
        }
    );

const REQUIREMENT: TargetRequirement = {
    type: "card",
    count: { min: 0, max: 3 },
    zone: "graveyard",
    controller: "any",
    sameController: true,
};

const gy = (id: string, owner: string) =>
    makeInstance(blackLotus().id, { id, controllerId: owner, ownerId: owner });

function board(): GameState {
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "spell",
        targetType: "card",
        zone: "graveyard",
        controller: "any",
        sameController: true,
        count: { min: 0, max: 5 },
        selected: [],
    };
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        pendingTarget,
    });
    state.players[0].graveyard.push(gy("a1", "p1"), gy("a2", "p1"));
    state.players[1].graveyard.push(gy("b1", "p2"), gy("b2", "p2"));
    return state;
}

describe("getLegalTargets — a single graveyard (CR 404.1, CR 601.2c)", () => {
    it("the first pick may come from either graveyard", () => {
        const ids = getLegalTargets(board(), REQUIREMENT, NO_TARGETING_SOURCE)
            .map((t) => t.id)
            .sort();
        expect(ids).toEqual(["a1", "a2", "b1", "b2"]);
    });

    it("later picks are narrowed to the first pick's graveyard", () => {
        const ids = getLegalTargets(
            board(),
            REQUIREMENT,
            NO_TARGETING_SOURCE,
            undefined,
            undefined,
            [{ type: "graveyard-card", id: "b1", playerId: "p2" }]
        ).map((t) => t.id);
        expect(ids).toEqual(["b2"]);
    });
});

describe("selectTarget — a single graveyard (CR 404.1, CR 601.2c)", () => {
    it("rejects a second pick from the OTHER graveyard", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
        await pick(harness.ctx, "a1", "p1");
        await expect(pick(harness.ctx, "b1", "p2")).rejects.toThrow(
            /same graveyard/
        );
        expect(harness.state().pendingTarget?.selected).toHaveLength(1);
    });

    it("accepts a second pick from the SAME graveyard", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
        await pick(harness.ctx, "a1", "p1");
        await pick(harness.ctx, "a2", "p1");
        expect(
            harness
                .state()
                .pendingTarget?.selected.map((s) => s.id)
                .sort()
        ).toEqual(["a1", "a2"]);
    });
});

describe("bot enumeration — a single graveyard", () => {
    it("proposes only same-graveyard tuples (CR 404.1)", () => {
        const state = board();
        state.pendingTarget = {
            ...(state.pendingTarget as PendingTarget),
            kind: "trigger",
            count: { min: 2, max: 2 },
        };
        const submits = enumerateRaisedTargetMoves(state, "p1").filter(
            (m) => m.kind === "submit-target"
        );
        // {a1,a2} and {b1,b2}; the four cross-graveyard pairs are dropped.
        expect(submits).toHaveLength(2);
        for (const m of submits) {
            const owners = new Set(
                m.targets.map((t) =>
                    t.type === "graveyard-card" ? t.playerId : ""
                )
            );
            expect(owners.size).toBe(1);
        }
    });
});
