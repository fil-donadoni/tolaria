// CR 601.2b / 602.2b — the value announced for X is public. Every commit that
// puts a spell or ability carrying `chosenX` onto the stack writes a `chosen-x`
// `lastChoiceAnnouncement` (the board's notice toast), and the stack item keeps
// `chosenX` on the wire (the card preview's `X = n` Live text line). Both are
// asserted through `projectPublicState` for BOTH seats, never a hand-built view.
import { describe, it, expect } from "vitest";
import { announceCast, activateAbilityOnState } from "../game";
import { toxicDeluge } from "../cards/sets/c13/index.cards";
import { darkRitual } from "../cards/sets/lea/black.cards";
import { swamp } from "../cards/sets/lea/colorless.cards";
import { aladdinsLamp } from "../cards/sets/arn/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
};

/** p1 holds `cardId` with `{B}{B}{B}` floating, so `announceCast` commits the
 *  cast in one mutation (the immediate-commit branch). */
function floatingManaBoard(cardId: string): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(cardId, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: 6 }, (_, i) =>
                    makeInstance(swamp().id, {
                        id: `swamp-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
                manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function cast(cardId: string, chosenX?: number): Promise<GameState> {
    const harness = makeMutationCtx("p1", [
        gameStateSeed(floatingManaBoard(cardId)),
    ]);
    await runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "spell",
            ...(chosenX !== undefined ? { chosenX } : {}),
        }
    );
    return harness.state();
}

describe("chosen-X announcement — a cast spell (CR 601.2b)", () => {
    it("Toxic Deluge paying 3 life: both seats read X = 3 on the stack item and in the announcement", async () => {
        const after = await cast(toxicDeluge().id, 3);
        expect(after.stack).toHaveLength(1);
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(after, 1, viewer);
            expect(view.stack[0].chosenX).toBe(3);
            expect(view.lastChoiceAnnouncement).toMatchObject({
                kind: "chosen-x",
                chooserId: "p1",
                cardName: "Toxic Deluge",
                xValue: 3,
            });
            expect(view.lastChoiceAnnouncement?.isAbility).toBeUndefined();
            expect(view.lastChoiceAnnouncement?.key).toContain(
                after.stack[0].id
            );
        }
    });

    it("X = 0 is announced (a real choice)", async () => {
        const after = await cast(toxicDeluge().id, 0);
        const view = projectPublicState(after, 1, "p2");
        expect(view.stack[0].chosenX).toBe(0);
        expect(view.lastChoiceAnnouncement).toMatchObject({
            kind: "chosen-x",
            xValue: 0,
        });
    });

    it("a spell with no X announces nothing", async () => {
        const after = await cast(darkRitual().id);
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].chosenX).toBeUndefined();
        expect(after.lastChoiceAnnouncement).toBeUndefined();
    });
});

describe("chosen-X announcement — an activated ability (CR 602.2b)", () => {
    it("Aladdin's Lamp for X = 2: the ability on the stack is announced to both seats", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(aladdinsLamp().id, {
                            id: "lamp",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "lamp",
            abilityId: "aladdins-lamp-look",
            chosenX: 2,
        });
        expect(state.stack).toHaveLength(1);
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(state, 1, viewer);
            expect(view.stack[0].chosenX).toBe(2);
            expect(view.lastChoiceAnnouncement).toMatchObject({
                kind: "chosen-x",
                chooserId: "p1",
                cardName: "Aladdin's Lamp",
                xValue: 2,
                isAbility: true,
            });
        }
    });
});
