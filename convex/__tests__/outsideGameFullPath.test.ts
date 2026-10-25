// Full-path integration for OUTSIDE THE GAME (CR 400.11, issue #6523):
// game init → GRE → the registered `submitResolutionChoice` handler → wire.
//
//   CR 400.11a  Cards in a player's sideboard are outside the game.
//   CR 400.11b  Some effects bring cards into a game from outside the game.
//
// Three seams no GRE-only test reaches:
//
//  1. INIT — `buildInitialGameState` builds the holder from the Match deck's
//     sideboard snapshot, minus the one card the companion slot holds.
//  2. The SUBMISSION through the real mutation handler: it owns the save, and
//     the Definition Manifest widen — the opponent's client never listed the
//     caster's sideboard, so a card brought in and revealed must reach it.
//  3. The SURFACE, through `projectPublicState` over the SAVED state.

import { describe, expect, it } from "vitest";
import {
    buildInitialGameState,
    submitResolutionChoice,
    type PlayerInput,
} from "../game";
import { getCardByName } from "../cards";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import { resolveTopOfStack, getPlayer, type GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { stateDefinitionIds } from "../definitionManifest";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const MOUNTAIN = getCardByName("Mountain").id;
const CRAW_WURM = getCardByName("Craw Wurm").id;
const MIND_TWIST = getCardByName("Mind Twist").id;
const LURRUS = getCardByName("Lurrus of the Dream-Den").id;

const deckCard = (cardId: string) => ({ cardId, cardName: cardId });

function seat(id: string, cards: string[], sideboard: string[]): PlayerInput {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: {
            id: `d-${id}`,
            name: "Deck",
            format: "vintage-cube",
            cards: cards.map(deckCard),
            sideboard: sideboard.map(deckCard),
        },
    };
}

const defOf = (c: { card: unknown }) => (c.card as { id: string }).id;

describe("game init builds the outside-the-game holder (CR 400.11a)", () => {
    it("holds the sideboard minus the declared companion's one card", () => {
        // Every permanent in the maindeck has mana value ≤ 2: Lurrus declares.
        const state = buildInitialGameState([
            seat("p1", Array(10).fill(MOUNTAIN), [
                LURRUS,
                MIND_TWIST,
                MIND_TWIST,
            ]),
            seat("p2", Array(10).fill(MOUNTAIN), []),
        ]);
        const p1 = state.players[0]!;
        expect(defOf(p1.companion!.instance)).toBe(LURRUS);
        expect(p1.outsideGame?.map(defOf)).toEqual([MIND_TWIST, MIND_TWIST]);
        // Real, distinct instance ids — a brought-in card keeps its own.
        const ids = [
            p1.companion!.instance.id,
            ...p1.outsideGame!.map((c) => c.id),
            ...p1.library.map((c) => c.id),
        ];
        expect(new Set(ids).size).toBe(ids.length);
        expect(state.players[1]!.outsideGame).toBeUndefined();
    });

    it("an undeclared companion stays an ordinary sideboard card", () => {
        // Craw Wurm (mana value 6) fails Lurrus's condition: no slot.
        const state = buildInitialGameState([
            seat("p1", [CRAW_WURM, ...Array(9).fill(MOUNTAIN)], [LURRUS]),
            seat("p2", Array(10).fill(MOUNTAIN), []),
        ]);
        const p1 = state.players[0]!;
        expect(p1.companion).toBeUndefined();
        expect(p1.outsideGame?.map(defOf)).toEqual([LURRUS]);
    });
});

const GAME_ID = "game-1" as Id<"games">;

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

const WISH: CardDefinition = {
    id: "t6523-fullpath-wish",
    name: "t6523-fullpath-wish",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "bringFromOutsideGame",
            player: "controller",
            filter: { type: "Sorcery" },
            prompt: "Reveal a sorcery card you own from outside the game.",
        },
    ],
};

/** p1 owning a Mind Twist outside the game, nothing cast yet. */
function pickPendingState(): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                outsideGame: [
                    makeInstance(MIND_TWIST, {
                        id: "sb-twist",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "exile",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    return state;
}

/** The wish resolved to its pick, p1 owning a Mind Twist outside the game. */
function pickPending(): GameState {
    const state = pickPendingState();
    pushSpell(state, WISH.id, "p1");
    resolveTopOfStack(state);
    return state;
}

function submitThroughMutation(state: GameState, ids: string[]) {
    const head = state.pendingChoices![0]!;
    const stub = makeMutationCtx("p1", [
        gameStateSeed(state),
        { _id: GAME_ID, __table: "games", cardIds: [] },
        {
            _id: "m-p1",
            __table: "gameDefinitionManifests",
            gameId: GAME_ID,
            playerId: "p1",
            entries: [],
        },
        {
            _id: "m-p2",
            __table: "gameDefinitionManifests",
            gameId: GAME_ID,
            playerId: "p2",
            entries: [],
        },
    ]);
    return {
        stub,
        run: () =>
            runMutation<SubmitArgs, void>(
                submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: ids,
                }
            ),
    };
}

const manifestIds = (stub: ReturnType<typeof makeMutationCtx>, id: string) =>
    (stub.doc(id).entries as { definitionId: string }[]).map(
        (e) => e.definitionId
    );

describe("submitResolutionChoice — a card brought in from outside the game (CR 400.11b)", () => {
    it("saves the card in hand, widens the opponent's manifest, and shows it on the wire", async () => {
        await withTemporaryDefinitionAsync(WISH, async () => {
            const { stub, run } = submitThroughMutation(pickPending(), [
                "sb-twist",
            ]);
            await run();
            const saved = stub.state();
            expect(getPlayer(saved, "p1").hand.map((c) => c.id)).toEqual([
                "sb-twist",
            ]);
            // The opponent's client never listed p1's sideboard: it does now.
            expect(manifestIds(stub, "m-p2")).toContain(MIND_TWIST);
            expect(stub.doc(GAME_ID).cardIds).toContain(MIND_TWIST);
            const oppHand = projectPublicState(saved, 2, "p2").players.find(
                (p) => p.id === "p1"
            )!.hand;
            expect(oppHand.map((c) => c?.card.id)).toEqual([MIND_TWIST]);
        });
    });

    it("a declined pick writes no manifest", async () => {
        await withTemporaryDefinitionAsync(WISH, async () => {
            const { stub, run } = submitThroughMutation(pickPending(), []);
            await run();
            // Neither the `games` row nor any manifest is touched.
            const written = stub.writes.map((w) => w.id);
            expect(written).not.toContain(GAME_ID);
            expect(written).not.toContain("m-p2");
            expect(getPlayer(stub.state(), "p1").outsideGame).toHaveLength(1);
        });
    });
});

describe("the Definition Manifest names a seat's own holder only (CR 400.11a)", () => {
    it("the owner's walk includes it; the opponent's does not", () => {
        const state = pickPendingState();
        expect(stateDefinitionIds(state, "p1")).toContain(MIND_TWIST);
        expect(stateDefinitionIds(state, "p2")).not.toContain(MIND_TWIST);
    });
});
