// Bot-driver coverage for the pile-division divide-then-choose family (ADR
// 0053, issue #1067). The class-level guard (`bot-action-dispatch.test.ts`)
// proves `botActionRealisation` routes every "resolution-choice" BotAction to
// the executor; this file proves the vs-AI/solo path actually REACHES that
// point without stalling for BOTH roles a pile card can hand the bot — the
// DIVIDER (a `divide-piles` choice) and the CHOOSER (a `pick-pile` choice) —
// using a real pile card (Fact or Fiction) through the full
// project → buildBotView → decideBotAction → chooseResolution path.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { buildBotView } from "../bot-view";
import { decideBotAction } from "../brain";

const factOrFiction = getCardByName("Fact or Fiction");

describe("Pile division bot dispatch (ADR 0053, issue #1067)", () => {
    it("the bot as DIVIDER produces a legal divide-piles submission (never stalls)", () => {
        const libCards = ["bot-ff-1", "bot-ff-2", "bot-ff-3"].map((id) =>
            makeInstance(factOrFiction.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: libCards }),
            ],
        });
        // The bot (p2) casts Fact or Fiction — it is the divider.
        pushSpell(state, factOrFiction.id, "p2");
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("divide-piles");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");

        const projected = projectPublicState(state, 1, "p2");
        const view = buildBotView(projected, "p2");
        const action = decideBotAction(view);
        // A legal-default, non-"none" action — the game keeps advancing.
        expect(action.kind).toBe("resolution-choice");
        if (action.kind !== "resolution-choice") throw new Error("unreachable");
        // ADR 0016 minimal-legal default: an empty pile A is always legal
        // (count.min === 0).
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: state.pendingChoices![0].stackItemId,
            step: state.pendingChoices![0].step,
            choiceId: state.pendingChoices![0].choiceId,
            cardInstanceIds: action.cardInstanceIds,
        });
        // Progressed to the next choice (pick-pile, owed to the opponent) —
        // not stalled.
        expect(state.pendingChoices?.[0]?.kind).toBe("pick-pile");
    });

    it("the bot as CHOOSER produces a legal pick-pile submission (never stalls)", () => {
        const libCards = ["bot-ff2-1", "bot-ff2-2"].map((id) =>
            makeInstance(factOrFiction.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: libCards }),
                makePlayer("p2"),
            ],
        });
        // p1 casts Fact or Fiction — the bot (p2) is the chooser.
        pushSpell(state, factOrFiction.id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["bot-ff2-1"],
        });
        expect(state.pendingChoices?.[0]?.kind).toBe("pick-pile");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");

        const projected = projectPublicState(state, 1, "p2");
        const view = buildBotView(projected, "p2");
        const action = decideBotAction(view);
        expect(action.kind).toBe("resolution-choice");
        if (action.kind !== "resolution-choice") throw new Error("unreachable");
        expect(action.cardInstanceIds).toHaveLength(1);
        expect(["A", "B"]).toContain(action.cardInstanceIds[0]);

        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: action.cardInstanceIds,
        });
        // Resolution completed — no more pending choices, game advances.
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
