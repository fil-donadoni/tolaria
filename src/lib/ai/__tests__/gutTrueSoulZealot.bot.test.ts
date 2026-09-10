// Gut, True Soul Zealot (CLB, issue #2373) — bot decision-surface proof.
//
// HISTORICAL NOTE, kept because the file's shape only makes sense with it:
// `sacrifice-permanents` had NO registered `CHOICE_CANDIDATE_GENERATORS` entry
// until issue #3377, so the driver answered it through the ADR 0016 heuristic
// default (`chooseResolution`, `src/lib/ai/brain.ts`) and this file proved
// that path, in the same shape `resolution-choice-integration.bot.test.ts`
// uses for every other kind.
//
// SINCE #3377 the kind IS generator-covered, so `OwedChoice.searchable` is
// true for it and `answerOwedInput` returns `search-choice` — the heuristic
// below is now the FALLBACK the driver takes only when the search surfaces no
// move (`chooseResolution` is still `brain.ts`'s documented safety net), not
// the normal path. What it asserts stays true and is still worth pinning: the
// net must keep declining an optional sacrifice rather than eating a creature.
// The routing itself is proven in `root-choice-search-routing.bot.test.ts`,
// and the decline branch the SEARCH now sees in
// `convex/gre/ai/__tests__/sacrifice-choice-node.bot.test.ts`.
//
// Lives under `src/lib/ai/__tests__/`, not `convex/cards/sets/clb/__tests__/`
// — a convex-side test may not import `src/lib/ai` (the frontend-only bot
// heuristic modules), only the reverse (ADR 0074).

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { emitAttackersDeclaredEvents } from "@convex/gre/phases";
import { projectPublicState } from "@convex/gameProjections";
import { chooseResolution } from "../brain";
import { buildBotView } from "../bot-view";

const GUT = getCardByName("Gut, True Soul Zealot").id;
const BEARS = getCardByName("Grizzly Bears").id;

function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

function skeletonTokens(state: GameState) {
    return state.players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes?.includes("Skeleton")
    );
}

describe("Gut, True Soul Zealot — buildBotView / chooseResolution (ADR 0016)", () => {
    it("surfaces the owed choice with Gut excluded from the candidate pool", () => {
        const gut = makeInstance(GUT, { id: "gut" });
        const fodder = makeInstance(BEARS, { id: "fodder" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gut, fodder] }),
                makePlayer("p2"),
            ],
        });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const view = buildBotView(projected, "p1");
        const owed = view.owedChoice;
        expect(owed).toBeDefined();
        expect(owed!.kind).toBe("sacrifice-permanents");
        expect(owed!.min).toBe(0);
        expect(owed!.max).toBe(1);
        const candidateIds = owed!.candidates.map((c) => c.id);
        expect(candidateIds).toContain(fodder.id);
        expect(candidateIds).not.toContain(gut.id);
    });

    it("ADR 0016 minimal-legal default declines (min: 0) — a legal, non-freezing answer", () => {
        const gut = makeInstance(GUT, { id: "gut" });
        const fodder = makeInstance(BEARS, { id: "fodder" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gut, fodder] }),
                makePlayer("p2"),
            ],
        });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const owed = buildBotView(projected, "p1").owedChoice!;
        const pick = chooseResolution(owed);
        expect(pick).toEqual([]);

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: pick,
        });
        expect(skeletonTokens(state)).toHaveLength(0);
    });

    it("a real sacrifice pick (the road a smarter policy would take) is ALSO a legal, engine-accepted answer", () => {
        const gut = makeInstance(GUT, { id: "gut" });
        const fodder = makeInstance(BEARS, { id: "fodder" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gut, fodder] }),
                makePlayer("p2"),
            ],
        });

        declareAttackers(state, [gut.id]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const owed = buildBotView(projected, "p1").owedChoice!;
        expect(owed.candidates.map((c) => c.id)).toContain(fodder.id);

        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [fodder.id],
        });
        expect(skeletonTokens(state)).toHaveLength(1);
    });
});
