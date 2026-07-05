// Per-card test for usg/black.ts. Exhume's `forEach(players)` construct
// iterates a runtime-selected set — `effectScriptSmoke.test.ts` explicitly
// SKIPS it ("covered by the card's own tests"), so per
// `.claude/rules/gre-development.md` § DSL-first authoring this card earns a
// hand-written test.
import { describe, it, expect } from "vitest";
import { exhume } from "..";
import { grizzlyBears } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Exhume (CR 400.7 reanimation, CR 101.4 APNAP order — Innocent Blood pattern)", () => {
    it("each player puts a creature card from their OWN graveyard onto the battlefield, active player first", () => {
        const p1Bear = makeInstance(grizzlyBears.id, {
            id: "p1bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const p2Bear = makeInstance(grizzlyBears.id, {
            id: "p2bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { graveyard: [p1Bear] }),
                makePlayer("p2", { graveyard: [p2Bear] }),
            ],
        });
        pushSpell(state, exhume.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on p1's pick first (CR 101.4)
        let pending = state.pendingChoices![0];
        expect(pending.kind).toBe("choose-graveyard-card");
        expect(pending.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p1bear"],
        });
        // p1's sacrifice/reanimation resolves before p2's pick is even raised
        // (engine simplification, CR 101.4d — flagged on Innocent Blood).
        expect(
            state.players[0].battlefield.some((c) => c.id === "p1bear")
        ).toBe(true);
        pending = state.pendingChoices![0];
        expect(pending.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p2bear"],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2bear")
        ).toBe(true);
    });

    it("skips a player with no creature cards in their graveyard entirely (CR 608.2b)", () => {
        const p1Bear = makeInstance(grizzlyBears.id, {
            id: "p1bear2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { graveyard: [p1Bear] }),
                makePlayer("p2"), // no creature cards in graveyard
            ],
        });
        pushSpell(state, exhume.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["p1bear2"],
        });
        // p2 has nothing to pick — no prompt raised, script completes.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "p1bear2")
        ).toBe(true);
    });
});
