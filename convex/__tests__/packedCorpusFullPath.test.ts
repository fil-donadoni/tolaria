// Full path for the packed-corpus fallback (issue #4165, PRD #4161): the
// REGISTERED `game.ts` mutations, played with decks of COMPILED cards, end in
// the same state with the switch on as with it off — and the switched-on run
// opens no more packed blocks than the distinct compiled definitions it holds.
//
// The scenario is `castCostPathsCharacterisation.test.ts`'s cast shape (cast
// out of a floating pool through `announceCast`, both players pass, the spell
// resolves) on the same stub `MutationCtx`, with every non-land card a
// compiled row. Both runs share one seeded document, built ONCE in this file's
// literal graph; only the mutation handlers differ. The switched-on graph is
// loaded fresh (`TOLARIA_PACKED_CORPUS_LOOKUP=on`), so its registry holds no
// compiled row when the first mutation starts — exactly a cold Convex request,
// whose module globals (and so its block memo) start empty.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as literalGame from "../game";
import { compiledReadyDefinitions } from "../cards/compiledPool";
import { getCardByName } from "../cards";
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

type GameModule = typeof literalGame;
type CardsModule = typeof import("../cards");

let packedGame: GameModule;
let packedCards: CardsModule;

beforeAll(async () => {
    vi.stubEnv("TOLARIA_PACKED_CORPUS_LOOKUP", "on");
    vi.resetModules();
    try {
        packedCards = (await import("../cards")) as CardsModule;
        packedGame = (await import("../game")) as GameModule;
    } finally {
        vi.unstubAllEnvs();
        // The next file in this worker (`isolate: false`) must not inherit the
        // switched-on graph from the module cache.
        vi.resetModules();
    }
}, 120_000);

afterAll(() => {
    vi.resetModules();
});

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

const compiledId = (name: string): string => {
    const row = compiledReadyDefinitions.find((r) => r.name === name);
    if (!row) throw new Error(`${name} is no longer a compiled row`);
    return row.id;
};

const CASTER = compiledId("Centaur Courser");
const MY_DECK = [
    "Spined Wurm",
    "Orazca Frillback",
    "Trained Jackal",
    "Loxodon Convert",
].map(compiledId);
const OPP_DECK = ["Tolarian Scholar", "Hulking Devil", "Oreskos Swiftclaw"].map(
    compiledId
);

const library = (owner: string, ids: string[]) =>
    ids.map((definitionId, i) =>
        makeInstance(definitionId, {
            id: `${owner}-lib-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );

function compiledBoard(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    makeInstance(CASTER, {
                        id: "courser",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    }),
                ],
                library: library(ME, MY_DECK),
                battlefield: [
                    makeInstance(getCardByName("Forest").id, {
                        id: "forest",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "battlefield",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 },
            }),
            makePlayer(OPP, { library: library(OPP, OPP_DECK) }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
    });
}

/** Cast the compiled creature, both players pass, it resolves (CR 117.4 /
 *  608.3). */
async function play(game: GameModule, harness: MutationStub): Promise<void> {
    const run = (fn: unknown, args: Record<string, unknown>) =>
        runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, args);
    await run(game.announceCast, {
        gameId: GAME,
        playerId: ME,
        cardInstanceId: "courser",
    });
    await run(game.passPriority, { gameId: GAME, playerId: ME });
    await run(game.passPriority, { gameId: GAME, playerId: OPP });
}

describe("game mutations over compiled decks, packed-corpus switch on (issue #4165)", () => {
    it("ends in the same state as the literal path, opening no more blocks than the distinct compiled definitions it holds", async () => {
        const seed = gameStateSeed(compiledBoard());

        const literal = makeMutationCtx("u", [seed]);
        await play(literalGame, literal);
        const want = literal.state();
        // The scenario did what it says: the compiled creature resolved.
        expect(want.stack).toHaveLength(0);
        expect(getPlayer(want, ME).battlefield.map((c) => c.card.id)).toContain(
            CASTER
        );

        expect(packedCards.packedCorpusInflations()).toBe(0);
        const packed = makeMutationCtx("u", [seed]);
        await play(packedGame, packed);
        expect(packed.state()).toEqual(want);

        const distinctCompiled = new Set([CASTER, ...MY_DECK, ...OPP_DECK]);
        const opened = packedCards.packedCorpusInflations();
        expect(opened).toBeGreaterThan(0);
        expect(opened).toBeLessThanOrEqual(distinctCompiled.size);
    });
});
