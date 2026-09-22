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
const GUIDED_PASSAGE = getCardByName("Guided Passage").id;
const FOREST = getCardByName("Forest").id;
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;
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

// Guided Passage — the CATEGORISED twin of the pick above (issue #3808).
//
// Same seam, one more thing that has to cross it: the `categories` buckets.
// `buildBotView` only forwards `head.categories` for the kinds it names, and
// `choose-library-card` had to be added to that list. Nothing else in the
// suite covers that line — `brain.bot.test.ts` hand-builds an `OwedChoice`
// with the buckets already set (so it tests the POLICY, not the projection),
// and the blade entry answers Gaea's Balance through the server-side
// candidate generator, never through `buildBotView`. `choose-library-card`
// has no generator at all, so this client path is the card's ONLY answer.
//
// Drop the forwarding and the bot hands over three cards chosen by raw value
// alone — for this library, three that cannot each answer a different
// description — the server throws, the state is unchanged, the policy is
// deterministic, and the game is frozen (ADR 0047).
describe("Guided Passage — the BOT answers the CATEGORISED opponent-side pick", () => {
    it("receives the category buckets and submits one card per description", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        // Two lands and two creatures, so raw "worst first"
                        // would reach for two of the same description.
                        [FOREST, "lib0"],
                        [FOREST, "lib1"],
                        [GRIZZLY_BEARS, "lib2"],
                        [GRIZZLY_BEARS, "lib3"],
                        [LIGHTNING_BOLT, "lib4"],
                    ].map(([cardId, id]) =>
                        makeInstance(cardId, {
                            id,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        })
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, GUIDED_PASSAGE, "p1");
        resolveTopOfStack(state);

        const pick = (state.pendingChoices ?? [])[0];
        expect(pick.playerId, "the opponent chooses").toBe("p2");

        const view = buildBotView(
            projectPublicState(state, 1, "p2") as PublicGameState,
            "p2"
        );
        const owed = view.owedChoice;
        expect(owed?.kind).toBe("choose-library-card");
        // Seam 1 — the whole revealed library crossed the wire.
        expect(owed!.candidates.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
            "lib2",
            "lib3",
            "lib4",
        ]);
        // Seam 2 — and so did the BUCKETS. Without them `chooseResolution`
        // falls back to `worstFirst().slice(0, min)`.
        expect(owed!.categories?.map((c) => c.label)).toEqual([
            "Creature card",
            "Land card",
            "Noncreature, nonland card",
        ]);

        // Seam 3 — the brain's answer is legal AND the server takes it.
        const answer = chooseResolution(owed!);
        expect(answer).toHaveLength(3);
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
        expect(p1.hand.map((c) => c.id).sort()).toEqual([...answer].sort());
        // One card per description, never two of one — the property the
        // buckets exist to enforce.
        const bucket: Record<string, string> = {
            lib0: "land",
            lib1: "land",
            lib2: "creature",
            lib3: "creature",
            lib4: "other",
        };
        expect(new Set(answer.map((id) => bucket[id])).size).toBe(3);
    });
});
