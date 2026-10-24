// `cost.returnToHandFilter` through the REAL mutations — CR 602.1a / 118.3 /
// 601.2h. "Return an Elf you control to its owner's hand: …" (Wirewood
// Symbiote).
//
// The GRE half (`gre/__tests__/returnToHandFilterActivationCost.test.ts`) drives
// the pure entry points; this file drives the registered `activateAbility` /
// `selectSacrifice` / `selectTarget` / `cancelActivation` handlers over the stub
// `MutationCtx`, and reads the parked pick back through `projectPublicState` —
// the wire the client renders its battlefield picker from.

import { describe, it, expect } from "vitest";
import {
    activateAbility,
    cancelActivation,
    selectSacrifice,
    selectTarget,
} from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import { projectPublicState } from "../gameProjections";
import { nextOwedPayment } from "../gre/owedPayment";
import type { CardDefinition } from "../cards/types";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const ELF = getCardByName("Llanowar Elves").id;

const SYMBIOTE_ID = "00000000-0000-4000-8000-000065000011";
const TARGETED_ID = "00000000-0000-4000-8000-000065000012";

preloadDefinitions([
    {
        id: SYMBIOTE_ID,
        name: "Synthetic Mutation Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "symbiote-gain",
                oracleText:
                    "Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { returnToHandFilter: { subtypes: ["Elf"] } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        id: TARGETED_ID,
        name: "Synthetic Mutation Targeted Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "targeted-untap",
                oracleText:
                    "Return an Elf you control to its owner's hand: Untap target creature.",
                cost: { returnToHandFilter: { subtypes: ["Elf"] } },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [
                    { op: "tapUntap", action: "untap", target: { target: 0 } },
                ],
            },
        ],
    } as CardDefinition,
]);

type ActivateArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};
type PickArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type TargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent";
    targetId: string;
};
type CancelArgs = { gameId: Id<"games">; playerId: string };

function board(sourceDef: string, elves: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(sourceDef, {
                        id: "src",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...Array.from({ length: elves }, (_, i) =>
                        makeInstance(ELF, {
                            id: `elf-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: i === 1,
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

const ctxFor = (state: GameState) =>
    makeMutationCtx("p1", [gameStateSeed(state)]);

const runActivate = (
    ctx: ReturnType<typeof ctxFor>,
    abilityId: string
): Promise<void> =>
    runMutation<ActivateArgs, void>(
        activateAbility as unknown as Handler<ActivateArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId: "src", abilityId }
    );
const runPick = (ctx: ReturnType<typeof ctxFor>, cardInstanceId: string) =>
    runMutation<PickArgs, void>(
        selectSacrifice as unknown as Handler<PickArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );
const runTarget = (ctx: ReturnType<typeof ctxFor>, targetId: string) =>
    runMutation<TargetArgs, void>(
        selectTarget as unknown as Handler<TargetArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "permanent", targetId }
    );
const runCancel = (ctx: ReturnType<typeof ctxFor>) =>
    runMutation<CancelArgs, void>(
        cancelActivation as unknown as Handler<CancelArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

const battlefieldIds = (state: GameState) =>
    state.players[0].battlefield.map((c) => c.id);

describe("returnToHandFilter through activateAbility → selectSacrifice (CR 602.1a)", () => {
    it("parks a RETURN pick that crosses the wire, then bounces the chosen Elf", async () => {
        const ctx = ctxFor(board(SYMBIOTE_ID, 2));

        await runActivate(ctx, "symbiote-gain");

        const parked = ctx.state();
        expect(nextOwedPayment(parked, "p1")?.kind).toBe(
            "activation:sacrificeSelection"
        );
        expect(parked.stack).toHaveLength(0);
        expect(battlefieldIds(parked)).toEqual(["src", "elf-0", "elf-1"]);
        // The client's picker reads the requirement off the PROJECTED state:
        // the return action must survive `projectPublicState`, or the banner
        // says "sacrifice" for a card that goes to hand.
        const view = projectPublicState(parked, 1, "p1");
        expect(
            view.pendingActivation?.sacrificeSelection?.requirements[0]
        ).toMatchObject({ count: 1, action: "return" });

        await runPick(ctx, "elf-1");

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(1);
        expect(after.players[0].hand.map((c) => c.id)).toEqual(["elf-1"]);
        expect(after.players[0].graveyard).toHaveLength(0);
        expect(battlefieldIds(after)).toEqual(["src", "elf-0"]);
    });

    it("cancelling the pick rewinds the activation — every Elf stays (CR 601.2h)", async () => {
        const ctx = ctxFor(board(SYMBIOTE_ID, 2));
        await runActivate(ctx, "symbiote-gain");

        await runCancel(ctx);

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(0);
        expect(battlefieldIds(after)).toEqual(["src", "elf-0", "elf-1"]);
        expect(after.players[0].hand).toHaveLength(0);
    });

    it("refuses the activation with no Elf to return (CR 118.3)", async () => {
        const ctx = ctxFor(board(SYMBIOTE_ID, 0));
        await expect(runActivate(ctx, "symbiote-gain")).rejects.toThrow(
            /return-to-hand cost/
        );
        expect(ctx.state().pendingActivation).toBeUndefined();
    });
});

describe("returnToHandFilter through activateAbility → selectTarget (CR 602.2b)", () => {
    it("bounces the Elf as the target is chosen — Wirewood Symbiote's shape", async () => {
        const ctx = ctxFor(board(TARGETED_ID, 1));

        await runActivate(ctx, "targeted-untap");
        expect(ctx.state().pendingTarget).toBeDefined();
        expect(battlefieldIds(ctx.state())).toEqual(["src", "elf-0"]);

        await runTarget(ctx, "src");

        const after = ctx.state();
        expect(after.stack).toHaveLength(1);
        expect(after.players[0].hand.map((c) => c.id)).toEqual(["elf-0"]);
        expect(battlefieldIds(after)).toEqual(["src"]);
    });

    it("refuses at finalize with no Elf to return — targets first, then costs (CR 601.2c / 601.2h)", async () => {
        const ctx = ctxFor(board(TARGETED_ID, 0));
        // A targeted activation announces its targets before paying (the
        // `sacrificeFilter` leg's ordering too), so the prompt opens …
        await runActivate(ctx, "targeted-untap");
        expect(ctx.state().pendingTarget).toBeDefined();

        // … and the unpayable cost refuses the finalize, nothing on the stack.
        await expect(runTarget(ctx, "src")).rejects.toThrow(
            /return-to-hand cost/
        );
        expect(ctx.state().stack).toHaveLength(0);
        expect(battlefieldIds(ctx.state())).toEqual(["src"]);
    });
});
