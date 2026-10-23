// "If this land would enter, sacrifice a Forest instead. If you do, put this
// land onto the battlefield. If you don't, put it into its owner's graveyard."
// — the as-enters SACRIFICE (CR 614.1a + CR 701.21a), the mandatory sibling of
// the Mox Diamond discard (`AsEntersChoice` kind `sacrifice`).
//
//  - CR 614.12a — the sacrifice is offered BEFORE the land enters; only a
//    matching permanent of the entering permanent's controller is a victim;
//  - CR 701.21a — the victim goes battlefield → graveyard;
//  - CR 614.1a — with nothing to sacrifice the "instead" never applies: the
//    land never touches the battlefield, and no prompt is raised;
//  - mandatory: unlike `discard`, an empty submission is not a decline;
//  - the wire format and the real `submitResolutionChoice` mutation.
import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../gameProjections";
import { submitResolutionChoice } from "../../game";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards/index";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { applyPlayLand } from "../playLand";
import type { CardInstanceState, GameState } from "../state";

const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");

const GAME_ID = "game-1" as Id<"games">;

const HEART: CardDefinition = {
    id: "as-enters-sacrifice-test-land",
    name: "Heart of Yavimaya",
    types: ["Land"],
    oracleText:
        "If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.",
    entersWith: {
        asEnters: [
            {
                kind: "sacrifice",
                filter: { subtypes: "Forest" },
                ifDeclined: "graveyard",
            },
        ],
    },
};

function permanent(
    id: string,
    defId: string,
    zone: "hand" | "battlefield" = "battlefield"
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

function board(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [permanent("heart", HEART.id, "hand")],
                battlefield,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const head = (state: GameState) => (state.pendingChoices ?? [])[0];
const battlefieldIds = (state: GameState): string[] =>
    state.players.flatMap((p) => p.battlefield.map((c) => c.id));
const graveyardIds = (state: GameState): string[] =>
    state.players.flatMap((p) => p.graveyard.map((c) => c.id));

describe("as-enters sacrifice (CR 614.1a + CR 701.21a)", () => {
    it("offers a mandatory sacrifice BEFORE the land enters, restricted to Forests (CR 614.12a)", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([
                permanent("forest", forest.id),
                permanent("mountain", mountain.id),
            ]);

            applyPlayLand(state, state.players[0], "heart");

            expect(state.stagedEntries).toHaveLength(1);
            expect(battlefieldIds(state)).not.toContain("heart");
            const h = head(state);
            expect(h.kind).toBe("sacrifice-permanents");
            expect(h.asEntersKind).toBe("sacrifice");
            expect(h.asEntersCardId).toBe("heart");
            expect(h.zone).toBe("battlefield");
            // Mandatory: the floor of 1 is what separates it from `discard`.
            expect(h.count).toEqual({ min: 1, max: 1 });
            expect(h.candidateIds).toEqual(["forest"]);
        });
    });

    it("sacrificing the Forest puts the land onto the battlefield (CR 701.21a)", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([permanent("forest", forest.id)]);
            applyPlayLand(state, state.players[0], "heart");

            submitChoice(state, ["forest"]);

            expect(battlefieldIds(state)).toContain("heart");
            expect(battlefieldIds(state)).not.toContain("forest");
            expect(graveyardIds(state)).toContain("forest");
            expect(state.stagedEntries).toBeUndefined();
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    it("with no Forest the land goes to the graveyard and no prompt is raised (CR 614.1a)", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([permanent("mountain", mountain.id)]);

            applyPlayLand(state, state.players[0], "heart");

            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.stagedEntries).toBeUndefined();
            expect(battlefieldIds(state)).not.toContain("heart");
            expect(graveyardIds(state)).toContain("heart");
            // The Mountain is not a victim — nothing was sacrificed.
            expect(battlefieldIds(state)).toContain("mountain");
            // The land never entered: no ETB signal was ever emitted.
            expect(state.players[0].qualifyingActionThisTurn).toBeFalsy();
        });
    });

    it("an empty submission is refused — the sacrifice is not optional", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([permanent("forest", forest.id)]);
            applyPlayLand(state, state.players[0], "heart");

            expect(() => submitChoice(state, [])).toThrow(/at least 1/i);
            expect(battlefieldIds(state)).toContain("forest");
        });
    });

    it("a non-Forest id is refused and the Forest stays (fail-closed allow-list)", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([
                permanent("forest", forest.id),
                permanent("mountain", mountain.id),
            ]);
            applyPlayLand(state, state.players[0], "heart");

            expect(() => submitChoice(state, ["mountain"])).toThrow(
                /not an eligible choice/i
            );
            expect(battlefieldIds(state)).toContain("mountain");
        });
    });

    it("the pending choice survives the wire projection", () => {
        withTemporaryDefinition(HEART, () => {
            const state = board([permanent("forest", forest.id)]);
            applyPlayLand(state, state.players[0], "heart");

            const projected = projectPublicState(state, 1, "p1");
            const wire = (projected.pendingChoices ?? [])[0];
            expect(wire?.asEntersKind).toBe("sacrifice");
            expect(wire?.candidateIds).toEqual(["forest"]);
        });
    });
});

describe("as-enters sacrifice — full path through convex/game.ts", () => {
    type SubmitArgs = {
        gameId: Id<"games">;
        playerId: string;
        stackItemId: string;
        step: number;
        choiceId: string;
        cardInstanceIds: string[];
    };

    it("submitResolutionChoice accepts the stackless sacrifice and the land enters", async () => {
        await withTemporaryDefinitionAsync(HEART, async () => {
            const state = board([permanent("forest", forest.id)]);
            applyPlayLand(state, state.players[0], "heart");
            const h = head(state);

            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runMutation<SubmitArgs, void>(
                submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    stackItemId: h.stackItemId,
                    step: h.step,
                    choiceId: h.choiceId,
                    cardInstanceIds: ["forest"],
                }
            );

            const after = stub.state();
            expect(battlefieldIds(after)).toContain("heart");
            expect(graveyardIds(after)).toContain("forest");
        });
    });
});
