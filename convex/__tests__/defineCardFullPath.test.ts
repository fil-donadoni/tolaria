// Full path for hand-written definitions declared with `defineCard` (issue
// #4857, PRD #4849): the REGISTERED `game.ts` mutations play the three
// converted cards on the stub `MutationCtx` — Breath of Darigaaz (`resolve()`),
// Aura Blast (an Effect Script, targeted) and Witch Enchanter played as its
// modal back face, Witch-Blessed Meadow (CR 712.12) — and every outcome
// reaches the client through `projectPublicState`.
//
// The game graph is loaded FRESH, so loading `game.ts` builds no factory —
// exactly a cold Convex request — and each card is built once, when the game
// first asks for it.
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as literalProjections from "../gameProjections";
import { getCardByName } from "../cards";
import type { CardFactory } from "../cards/types";
import { modalBackFaceDefinitionId } from "../cards/modalDfc";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getPlayer, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

type GameModule = typeof import("../game");
type ProjectionsModule = typeof literalProjections;

let game: GameModule;
let projections: ProjectionsModule;
let breath: CardFactory;
let blast: CardFactory;
let enchanter: CardFactory;

beforeAll(async () => {
    vi.resetModules();
    try {
        game = await import("../game");
        projections = await import("../gameProjections");
        breath = (await import("../cards/sets/inv/red.cards")).breathOfDarigaaz;
        blast = (await import("../cards/sets/pls/white.cards")).auraBlast;
        enchanter = (await import("../cards/sets/mom/white.cards"))
            .witchEnchanter;
    } finally {
        // The next file in this worker (`isolate: false`) must not inherit
        // this graph from the module cache.
        vi.resetModules();
    }
}, 120_000);

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

const id = (name: string) => getCardByName(name).id;

const card = (
    name: string,
    instanceId: string,
    owner: string,
    zone: "hand" | "battlefield" | "library"
) =>
    makeInstance(id(name), {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    card("Breath of Darigaaz", "breath", ME, "hand"),
                    card("Aura Blast", "blast", ME, "hand"),
                    card("Witch Enchanter", "enchanter", ME, "hand"),
                ],
                library: [card("Forest", "my-lib-0", ME, "library")],
                manaPool: { W: 1, U: 0, B: 0, R: 1, G: 0, C: 2 },
            }),
            makePlayer(OPP, {
                battlefield: [
                    card("Grizzly Bears", "bears", OPP, "battlefield"),
                    card("Castle", "castle", OPP, "battlefield"),
                ],
                library: [card("Forest", "opp-lib-0", OPP, "library")],
            }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
    });
}

async function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<void> {
    await runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

/** Both players pass until the stack is empty (CR 117.4). */
async function passUntilResolved(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 6; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, game.passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
    throw new Error("the stack never emptied");
}

describe("defineCard cards through the game mutations (issue #4857)", () => {
    it("loading game.ts builds no factory card", () => {
        expect([breath, blast, enchanter].map((f) => f.builds())).toEqual([
            0, 0, 0,
        ]);
    });

    it("plays a resolve() card, an Effect Script and a modal back face, each built once", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        // Breath of Darigaaz, unkicked (CR 702.33): 1 damage to each creature
        // without flying and each player.
        await call(harness, game.announceCast, {
            playerId: ME,
            cardInstanceId: "breath",
        });
        await passUntilResolved(harness);
        let state = harness.state();
        expect(getPlayer(state, ME).life).toBe(19);
        expect(getPlayer(state, OPP).life).toBe(19);
        expect(
            getPlayer(state, OPP).battlefield.find((c) => c.id === "bears")
                ?.damageMarked
        ).toBe(1);

        // Aura Blast: destroy target enchantment, draw a card.
        await call(harness, game.announceCast, {
            playerId: ME,
            cardInstanceId: "blast",
        });
        await call(harness, game.selectTargets, {
            playerId: ME,
            targets: [{ targetType: "permanent", targetId: "castle" }],
        });
        await passUntilResolved(harness);
        state = harness.state();
        expect(getPlayer(state, OPP).graveyard.map((c) => c.id)).toContain(
            "castle"
        );
        expect(getPlayer(state, ME).hand.map((c) => c.id)).toContain(
            "my-lib-0"
        );

        // Witch Enchanter played as its back face, a land (CR 712.12),
        // paying 3 life so it enters untapped (CR 614.12).
        await call(harness, game.playCard, {
            playerId: ME,
            cardInstanceId: "enchanter",
            face: "back",
        });
        await call(harness, game.submitLandEntryChoice, {
            playerId: ME,
            accept: true,
        });
        state = harness.state();
        expect(getPlayer(state, ME).life).toBe(16);
        const meadow = projections
            .projectPublicState(state, 1, ME)
            .players[0].battlefield.find((c) => c.id === "enchanter");
        // CR 712.8f — on the battlefield it has only its back face's
        // characteristics: the derived `#back` twin, a Land.
        expect(meadow?.card.id).toBe(modalBackFaceDefinitionId(enchanter().id));
        expect(meadow?.types).toEqual(["Land"]);
        expect(meadow?.isTapped).toBe(false);

        // The game asked for each card many times; each was built once.
        expect([breath, blast, enchanter].map((f) => f.builds())).toEqual([
            1, 1, 1,
        ]);
    });
});
