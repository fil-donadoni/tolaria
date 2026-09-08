// The Bot ANSWERS Intuition's opponent-side pick (issue #3205).
//
// Bot reachability for this card is NOT about enumerating the cast — it is
// about the CHOICE SURFACE on the other side of the table: Intuition raises a
// `choose-library-card` PendingChoice to the OPPONENT, and if the bot in that
// seat cannot answer it the game freezes with the spell half-resolved. Two
// things have to hold and neither is guaranteed by the engine change alone:
//
//  1. the bot's VIEW has to contain the candidate cards at all. They sit in
//     the OPPONENT'S library — a hidden zone the bot's own projection reduces
//     to a count — so they reach it only through the `libraryPeek` exposure
//     the projection grants the chooser (`readChoiceZone`, `bot-view.ts`);
//  2. `chooseResolution` has to have a branch for the kind. `brain.ts` ends in
//     `assertNever`, so a missing branch is a `tsc` error rather than a
//     freeze — but a branch that returns nothing legal is neither, and that is
//     what this asserts.
//
// Driven through the REAL projection and the REAL brain: `projectPublicState`
// → `buildBotView` → `chooseResolution`, no hand-built view anywhere.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { resolveTopOfStack } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { buildBotView } from "../bot-view";
import { chooseResolution } from "../brain";
import type { PublicGameState } from "@convex/gameProjections";

const INTUITION = getCardByName("Intuition").id;
const ISLAND = getCardByName("Island").id;
const COUNTERSPELL = getCardByName("Counterspell").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

describe("Intuition — the BOT can answer the opponent-side pick", () => {
    it("sees the three revealed cards and submits exactly one of them", () => {
        // p1 (the human) casts Intuition targeting p2 (the bot).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        ISLAND,
                        COUNTERSPELL,
                        GRIZZLY_BEARS,
                        ISLAND,
                        ISLAND,
                    ].map((cardId, i) =>
                        makeInstance(cardId, {
                            id: `lib${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        })
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, INTUITION, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        // p1 finds three; the pick then belongs to the bot.
        const search = (state.pendingChoices ?? [])[0];
        applyPendingChoiceSubmit(state, {
            playerId: search.playerId,
            stackItemId: search.stackItemId,
            step: search.step,
            choiceId: search.choiceId,
            cardInstanceIds: ["lib0", "lib1", "lib2"],
        });

        const pick = (state.pendingChoices ?? [])[0];
        expect(pick.playerId, "the bot is the chooser").toBe("p2");

        const view = buildBotView(
            projectPublicState(state, 1, "p2") as PublicGameState,
            "p2"
        );
        const owed = view.owedChoice;
        expect(owed, "the bot is owed the choice").toBeDefined();
        expect(owed!.kind).toBe("choose-library-card");
        // Seam 1 — the candidates crossed the wire. Without the `libraryPeek`
        // exposure this pool is EMPTY and the submission below is illegal.
        expect(owed!.candidates.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
            "lib2",
        ]);

        // Seam 2 — the brain answers, the answer is legal, and it is the
        // ADVERSARIAL answer. "Target opponent chooses one" is a gift the
        // opponent picks, so the bot must hand over the LEAST valuable card,
        // not whichever one the searcher happened to list first. The expected
        // id is derived from the values the view itself carries, so this
        // pins the policy without restating `brain.ts`'s ordering.
        const answer = chooseResolution(owed!);
        expect(answer).toHaveLength(1);
        expect(["lib0", "lib1", "lib2"]).toContain(answer[0]);
        const cheapest = [...owed!.candidates].sort(
            (a, b) => a.value - b.value
        )[0]!;
        const dearest = [...owed!.candidates].sort(
            (a, b) => b.value - a.value
        )[0]!;
        expect(
            dearest.value,
            "the fixture must have a real value spread, or this assertion is vacuous"
        ).toBeGreaterThan(cheapest.value);
        expect(answer[0]).toBe(cheapest.id);

        // And the server accepts it — the round trip, not just the intent.
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: pick.playerId,
                stackItemId: pick.stackItemId,
                step: pick.step,
                choiceId: pick.choiceId,
                cardInstanceIds: answer,
            })
        ).not.toThrow();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.hand.map((c) => c.id)).toEqual(answer);
    });
});
