// CR 106.6 / 614.12a (issue #9388) — mana keyed on a creature type its SOURCE
// chose ("Spend this mana only to cast a creature spell of the chosen type,
// and that spell can't be countered" — Cavern of Souls), walked through the
// real mutation handlers: the payment tap (`tapForPayment`), the reversal
// (`untapForPayment`), the priority tap (`tapUntap`), the wire projection the
// client reads (the label it renders: `src/lib/__tests__/restricted-mana.test.ts`).
//
// The source is a TEST variant of Delighted Halfling's shape (a {C} ability and
// an any-colour ability carrying a restriction + the can't-be-countered rider)
// re-keyed to `chosen-type-creature-spell` and made a Land, registered for the
// test's extent only (`withTemporaryDefinitionAsync`).

import { describe, it, expect } from "vitest";
import { tapForPayment, untapForPayment, tapUntap } from "../game";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { delightedHalfling } from "../cards/sets/ltr/index.cards";
import { llanowarElves } from "../cards/sets/lea/green.cards";
import { goblinKing } from "../cards/sets/lea/red.cards";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
/** Index 0 = the fixed {C} ability; 1-5 = the restricted ability's
 *  [{W},{U},{B},{R},{G}] choices. 5 = {G}. */
const GREEN_RESTRICTED = 5;

function chosenTypeLand(): CardDefinition {
    const base = delightedHalfling();
    const [colorless, anyColor] = base.activatedAbilities!;
    return {
        ...base,
        id: "test-chosen-type-mana-land",
        name: "Test Chosen-Type Mana Land",
        oracleText:
            "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
        manaCost: {},
        types: ["Land"],
        subtypes: [],
        power: undefined,
        toughness: undefined,
        activatedAbilities: [
            colorless,
            { ...anyColor, manaRestriction: "chosen-type-creature-spell" },
        ],
    };
}

type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
};
type UntapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

const runTapForPayment = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            payments: [
                { cardInstanceId: "land", manaChoiceIndex: GREEN_RESTRICTED },
            ],
        }
    );

/** The land (chose `chosen`) on the battlefield; `castCardId` pending with a
 *  generic cost of `generic` (overridden — what is under test is WHICH mana
 *  pays, the `tapSourceIntoPaymentRestrictedMana.test.ts` pattern). */
function castState(
    castCardId: string,
    generic: number,
    chosen: string[] | null = ["Elf"]
): GameState {
    const land = makeInstance("test-chosen-type-mana-land", {
        id: "land",
        controllerId: "p1",
        ownerId: "p1",
        ...(chosen ? { chosenSubtypes: chosen } : {}),
    });
    const cast = makeInstance(castCardId, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { X: generic },
        tappedLandIds: [],
    };
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [land], hand: [cast] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
}

describe("chosen-type-creature-spell mana — payment path (CR 106.6, issue #9388)", () => {
    it("a creature spell OF the chosen type commits off the mana and can't be countered", async () => {
        await withTemporaryDefinitionAsync(chosenTypeLand(), async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(castState(llanowarElves().id, 1)),
            ]);
            await runTapForPayment(stub.ctx);
            const state = stub.state();
            expect(state.pendingCast).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].dynamicCantBeCountered).toBe(true);
            expect(state.players[0].restrictedMana).toBeUndefined();
        });
    });

    it("a creature spell of ANOTHER type cannot spend it — the cast stays pending, the unit keeps its type", async () => {
        await withTemporaryDefinitionAsync(chosenTypeLand(), async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(castState(goblinKing().id, 1)),
            ]);
            await runTapForPayment(stub.ctx);
            const state = stub.state();
            expect(state.pendingCast).toBeDefined();
            expect(state.stack).toHaveLength(0);
            expect(state.players[0].manaPool.G ?? 0).toBe(0);
            expect(state.players[0].restrictedMana).toEqual([
                {
                    color: "G",
                    amount: 1,
                    restriction: "chosen-type-creature-spell",
                    chosenCreatureType: "Elf",
                    cantBeCounteredRider: true,
                },
            ]);
        });
    });

    it("a source that chose nothing yields mana that pays for nothing (fail closed)", async () => {
        await withTemporaryDefinitionAsync(chosenTypeLand(), async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(castState(llanowarElves().id, 1, null)),
            ]);
            await runTapForPayment(stub.ctx);
            const state = stub.state();
            expect(state.pendingCast).toBeDefined();
            expect(
                state.players[0].restrictedMana?.[0]?.chosenCreatureType
            ).toBeUndefined();
        });
    });

    it("untapForPayment reverses the chosen-type bucket (CR 106.4 key symmetry)", async () => {
        await withTemporaryDefinitionAsync(chosenTypeLand(), async () => {
            const stub = makeMutationCtx("p1", [
                gameStateSeed(castState(llanowarElves().id, 2)),
            ]);
            await runTapForPayment(stub.ctx);
            expect(stub.state().players[0].restrictedMana).toHaveLength(1);
            await runMutation<UntapForPaymentArgs, void>(
                untapForPayment as unknown as Handler<
                    UntapForPaymentArgs,
                    void
                >,
                stub.ctx,
                { gameId: GAME_ID, playerId: "p1", cardInstanceId: "land" }
            );
            const state = stub.state();
            expect(state.players[0].restrictedMana).toBeUndefined();
            expect(state.players[0].manaPool.G ?? 0).toBe(0);
            const land = state.players[0].battlefield.find(
                (c) => c.id === "land"
            )!;
            expect(land.isTapped).toBe(false);
        });
    });
});

describe("chosen-type-creature-spell mana — priority tap, wire and label (issue #9388)", () => {
    it("tapUntap snapshots the chosen type and the projection keeps it", async () => {
        await withTemporaryDefinitionAsync(chosenTypeLand(), async () => {
            const land = makeInstance("test-chosen-type-mana-land", {
                id: "land",
                controllerId: "p1",
                ownerId: "p1",
                chosenSubtypes: ["Merfolk"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runMutation<TapUntapArgs, void>(
                tapUntap as unknown as Handler<TapUntapArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    cardInstanceId: "land",
                    manaChoiceIndex: GREEN_RESTRICTED,
                }
            );
            const after = stub.state();
            const expected = {
                color: "G",
                amount: 1,
                restriction: "chosen-type-creature-spell",
                chosenCreatureType: "Merfolk",
                cantBeCounteredRider: true,
            };
            expect(after.players[0].restrictedMana).toEqual([expected]);
            const projected = projectPublicState(after, 1, "p1");
            expect(projected.players[0].restrictedMana).toEqual([expected]);
        });
    });
});
