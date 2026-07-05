// Per-card test for 5dn/green.ts. Eternal Witness's ETB uses a `choice`
// Op that suspends for player input — the catalogue-wide auto-generated smoke
// test (`effectScriptSmoke.test.ts`) explicitly SKIPS it ("covered by the
// card's own suspension/resume tests"), so per
// `.claude/rules/gre-development.md` § DSL-first authoring this card earns a
// hand-written test.
import { describe, it, expect } from "vitest";
import { eternalWitness } from "..";
import { swamp } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

describe("Eternal Witness (CR 603.6a optional ETB regrowth, CR 117.3a 'you may … up to one')", () => {
    it("returns a chosen card of ANY type from the graveyard to hand (no filter)", () => {
        const witness = makeInstance(eternalWitness.id, {
            id: "witness",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "gy1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [witness],
                    graveyard: [land],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "witness",
                controllerId: "p1",
                cardId: eternalWitness.id,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("choose-graveyard-card");
        expect(pending.candidateIds).toEqual(["gy1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["gy1"],
        });
        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "gy1")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "gy1")).toBe(false);
    });

    it("is a no-op with an empty graveyard (CR 608.2b — the optional pick clamps to zero candidates)", () => {
        const witness = makeInstance(eternalWitness.id, {
            id: "witness2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [witness] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "witness2",
                controllerId: "p1",
                cardId: eternalWitness.id,
                types: ["Creature"],
            },
        ]);
        state.stack.push(...triggers);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
