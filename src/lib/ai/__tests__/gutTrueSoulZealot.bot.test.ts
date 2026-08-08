// Gut, True Soul Zealot (CLB, issue #2373) — bot decision-surface proof.
//
// `sacrifice-permanents` has no registered `CHOICE_CANDIDATE_GENERATORS`
// entry (`convex/gre/ai/choiceCandidates.ts`) — it is not (yet) an in-tree
// ISMCTS search node, a PRE-EXISTING gap shared by every other
// `sacrifice-permanents` card (Minsc & Boo included, `sets/clb/
// multicolor.ts`), not something this card introduces. `enumerateMoves`
// (proven `[]` for this pending choice in `convex/cards/sets/clb/__tests__/
// red.bot.test.ts`) therefore is NOT how the bot answers it — the driver
// instead answers through the ADR 0016 heuristic default (`chooseResolution`,
// `src/lib/ai/brain.ts`), the SAME mechanism `resolution-choice-integration.
// bot.test.ts` proves for every other resolution-choice kind. This file adds
// the `sacrifice-permanents` case to that same proof shape.
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
