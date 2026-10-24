// The Bot answers the Wish pick (CR 400.11b, issue #6523), from the REAL wire:
// a GRE state with the `bringFromOutsideGame` pick pending, projected for the
// Bot's seat by `projectPublicState`, then read by the two Bot paths —
//
//  - the client resolver: `buildBotView` → `owedChoice` → `chooseResolution`;
//  - the search: `projectedToGameState` rebuilds the holder from the wire, and
//    the `choose-outside-game-card` candidate generator turns the pick into a
//    decision node whose move the engine's own submit path accepts.
import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import { getPlayer, resolveTopOfStack } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { CHOICE_CANDIDATE_GENERATORS } from "@convex/gre/ai/choiceCandidates";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { buildBotView } from "../bot-view";
import { chooseResolution } from "../brain";
import { projectedToGameState } from "../state-adapter";
import { determinize } from "@convex/gre/determinize";
import { makeRng } from "@convex/gre/rng";

const MIND_TWIST = getCardByName("Mind Twist").id;
const STONE_RAIN = getCardByName("Stone Rain").id;
const CRAW_WURM = getCardByName("Craw Wurm").id;

const WISH: CardDefinition = {
    id: "t6523-bot-wish",
    name: "t6523-bot-wish",
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

/** The Bot (p1) cast the wish; its pick is head-of-queue. */
function projectedForBot() {
    return withTemporaryDefinition(WISH, () => {
        const outside = (defId: string, id: string) =>
            makeInstance(defId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "exile",
            });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    outsideGame: [
                        outside(STONE_RAIN, "sb-rain"),
                        outside(MIND_TWIST, "sb-twist"),
                        outside(CRAW_WURM, "sb-wurm"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, WISH.id, "p1");
        resolveTopOfStack(state);
        return projectPublicState(state, 1, "p1");
    });
}

describe("the Bot answers a Wish pick (CR 400.11b)", () => {
    it("the client resolver takes a matching card instead of declining", () => {
        const owed = buildBotView(projectedForBot(), "p1").owedChoice!;
        expect(owed.kind).toBe("choose-outside-game-card");
        expect(owed.min).toBe(0);
        expect(owed.candidates.map((c) => c.id).sort()).toEqual([
            "sb-rain",
            "sb-twist",
        ]);
        const picks = chooseResolution(owed);
        expect(picks).toHaveLength(1);
        expect(["sb-rain", "sb-twist"]).toContain(picks[0]);
    });

    it("the search's rebuilt state holds the pool, and every generated move is one the engine accepts", () => {
        withTemporaryDefinition(WISH, () => {
            const projected = projectedForBot();
            const state = projectedToGameState(projected, undefined, "p1");
            expect(
                getPlayer(state, "p1").outsideGame?.map((c) => c.id)
            ).toEqual(["sb-rain", "sb-twist", "sb-wurm"]);
            const head = state.pendingChoices![0]!;
            const candidates = CHOICE_CANDIDATE_GENERATORS[
                "choose-outside-game-card"
            ]!(state, head);
            // The decline, then one node per distinct matching card.
            expect(candidates[0]!.key).toBe("choose-outside-game-card:none");
            const picks = candidates.slice(1).map((c) => {
                if (c.move.kind !== "resolution-choice")
                    throw new Error(c.move.kind);
                return c.move.cardInstanceIds;
            });
            expect(picks.flat().sort()).toEqual(["sb-rain", "sb-twist"]);
            for (const ids of [[], ...picks]) {
                const clone = structuredClone(state);
                applyPendingChoiceSubmit(clone, {
                    playerId: "p1",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: ids,
                });
                expect(getPlayer(clone, "p1").hand.map((c) => c.id)).toEqual(
                    ids
                );
            }
        });
    });
});

describe("the Bot never takes a card for ANOTHER seat's pool (ADR 0037)", () => {
    it("a controlled-cast pick offers the decline alone", () => {
        withTemporaryDefinition(WISH, () => {
            const state = projectedToGameState(
                projectedForBot(),
                undefined,
                "p1"
            );
            const head = {
                ...state.pendingChoices![0]!,
                playerId: "p2",
                zoneOwnerId: "p1",
            };
            const candidates = CHOICE_CANDIDATE_GENERATORS[
                "choose-outside-game-card"
            ]!(state, head);
            expect(candidates.map((c) => c.key)).toEqual([
                "choose-outside-game-card:none",
            ]);
        });
    });
});

describe("determinize hides another seat's sideboard (CR 400.11a)", () => {
    it("the observer keeps its own holder; the opponent's is gone", () => {
        const outside = (defId: string, id: string, owner: string) =>
            makeInstance(defId, {
                id,
                controllerId: owner,
                ownerId: owner,
                zone: "exile",
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    outsideGame: [outside(MIND_TWIST, "mine", "p1")],
                }),
                makePlayer("p2", {
                    outsideGame: [outside(STONE_RAIN, "theirs", "p2")],
                }),
            ],
        });
        const world = determinize(state, "p1", makeRng(7));
        expect(getPlayer(world, "p1").outsideGame?.map((c) => c.id)).toEqual([
            "mine",
        ]);
        expect(getPlayer(world, "p2").outsideGame).toBeUndefined();
    });
});
