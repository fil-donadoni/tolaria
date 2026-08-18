// SPM (Marvel's Spider-Man) — colorless behavior tests (ADR 0043 colour
// split). Multiversal Passage (issue #1306, parent PRD #620): CR 614.12
// land-entry pay-choice + CR 603.6b on-entry instance-scoped choice + CR
// 305.7 layer-4 subtype replacement, composing three independently-tested
// existing mechanisms (see the card's own doc comment in `../colorless.ts`
// for the precedent citations).

import { describe, it, expect } from "vitest";
import { multiversalPassage } from "../colorless";
import { forest } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    getPlayer,
    type GameState,
} from "../../../../gre/state";
import { getBasicLandMana } from "../../../../gre/constants";
import { applyPlayLand } from "../../../../gre/playLand";
import {
    applyLandEntrySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";

describe("Multiversal Passage (CR 614.12 pay-choice + CR 603.6b choice + CR 305.7 subtype-set)", () => {
    it("the subtype-set static applies ONLY to itself (a pre-set chosenSubtypes)", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        passage.chosenSubtypes = ["Island"];
        const otherLand = makeInstance(forest.id, {
            id: "other-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [passage, otherLand] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, passage);
        expect(passage.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(passage)).toBe("U");
        // The other land on the board is untouched — this is a SELF-only
        // static, not a swap over every matching land (Illusionary Terrain).
        expect(otherLand.subtypes).toEqual(["Forest"]);
    });

    it("has no subtype (and no intrinsic mana) before the choice resolves", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [passage] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, passage);
        expect(passage.subtypes).toEqual([]);
        expect(getBasicLandMana(passage)).toBeNull();
    });

    it("stores the chosen type on entry via the resolve()/requestOptionChoice protocol (CR 603.6b)", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [passage] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        state.stack.push({
            ...passage,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "multiversal-passage-choose-type",
            triggerSourceId: "passage-1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "passage-1",
                controllerId: "p1",
                types: ["Land"],
            } as GameState["stack"][number]["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);

        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["Mountain"],
        });

        const after = state.players[0].battlefield.find(
            (c) => c.id === "passage-1"
        )!;
        expect(after.chosenSubtypes).toEqual(["Mountain"]);
        applySourceStaticEffects(state, after);
        expect(after.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(after)).toBe("R");
    });

    it("end-to-end: decline the pay-choice (enters tapped), then choose the type", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [passage] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        applyPlayLand(state, player, "passage-1");
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const land = player.battlefield.find((c) => c.id === "passage-1")!;
        expect(land.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20);

        // The choose-type trigger is queued on the stack (CR 603.3b); it
        // isn't resolved until priority resolves it.
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["Swamp"],
        });

        expect(land.chosenSubtypes).toEqual(["Swamp"]);
        applySourceStaticEffects(state, land);
        expect(land.subtypes).toEqual(["Swamp"]);
        expect(getBasicLandMana(land)).toBe("B");
    });

    // Regression (#727 QA, relocated here by #2467). `setChosenSubtypes`
    // (`convex/gre/state.ts`) does two things: it writes `chosenSubtypes`, and
    // it then RE-MATERIALISES the source's continuous statics
    // (`applySourceStaticEffects`). The second half is load-bearing because
    // the `subtype-set` static was already materialised when the land entered
    // — with no type chosen yet, `subtypesFor` returned null, a no-op — and
    // NOTHING runs between the submission and the next board read.
    //
    // Illusionary Terrain (`ice/blue.ts`) used to be the only guard on that
    // line; #2467 moved it to a CR 614.12a as-enters choice made BEFORE the
    // permanent enters, which structurally removes the race for that card.
    // Multiversal Passage is still a POST-entry `enteredTrigger`, so it is now
    // the only card the re-materialisation is load-bearing for.
    //
    // Deliberately does NOT call `applySourceStaticEffects` itself: that call
    // is what the cases above use, and it is exactly what masks the bug.
    it("the chosen type is live on the board immediately after the submission, with no extra materialisation pass (CR 611.2c)", () => {
        const passage = makeInstance(multiversalPassage.id, {
            id: "passage-1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, hand: [passage] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        applyPlayLand(state, player, "passage-1");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "passage-1")!;
        // Entered with the static already materialised over an empty choice.
        expect(land.subtypes).toEqual([]);

        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["Island"],
        });

        expect(land.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(land)).toBe("U");
    });
});
