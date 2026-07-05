// Per-card tests for c14/green.ts. Titania's two triggered abilities each use
// a DSL Op combination (`choice(zone: "graveyard", filter)` + `moveZone`
// cards-shape; `createToken`) that the catalogue-wide auto-generated smoke
// test (`effectScriptSmoke.test.ts`) explicitly SKIPS — "Op 'choice' suspends
// for player input — covered by the card's own suspension/resume tests" — so
// per `.claude/rules/gre-development.md` § DSL-first authoring, this card
// earns a hand-written test.
import { describe, it, expect } from "vitest";
import { titaniaProtectorOfArgoth } from "..";
import { grizzlyBears, swamp } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

describe("Titania, Protector of Argoth (CR 603.6a ETB reanimation + CR 603.6e LTB elemental token)", () => {
    it("ETB: returns a chosen LAND card from the controller's graveyard, filtering out a non-land card", () => {
        const titania = makeInstance(titaniaProtectorOfArgoth.id, {
            id: "titania",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(swamp.id, {
            id: "landGY",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bearGY",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [titania],
                    graveyard: [land, bear],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "titania",
                controllerId: "p1",
                cardId: titaniaProtectorOfArgoth.id,
                types: ["Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the choice
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("choose-graveyard-card");
        // Only the land is offered — the Bear is filtered out (CR 205).
        expect(pending.candidateIds).toEqual(["landGY"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pending.stackItemId,
            step: pending.step,
            choiceId: pending.choiceId,
            cardInstanceIds: ["landGY"],
        });
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "landGY")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "landGY")).toBe(false);
    });

    it("LTB: creates a 5/3 green Elemental token when a controlled land is put into a graveyard from the battlefield", () => {
        const titania = makeInstance(titaniaProtectorOfArgoth.id, {
            id: "titania",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [titania] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_LEFT",
                instanceId: "landX",
                controllerId: "p1",
                ownerId: "p1",
                cardId: swamp.id,
                types: ["Land"],
                wasAura: false,
                toZone: "graveyard",
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const token = p1.battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        expect(token!.power).toBe(5);
        expect(token!.toughness).toBe(3);
    });

    it("does NOT create a token when an opponent's land dies (controller-scoped, CR 109.5)", () => {
        const titania = makeInstance(titaniaProtectorOfArgoth.id, {
            id: "titania",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [titania] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_LEFT",
                instanceId: "oppLand",
                controllerId: "p2",
                ownerId: "p2",
                cardId: swamp.id,
                types: ["Land"],
                wasAura: false,
                toZone: "graveyard",
            },
        ]);
        expect(triggers).toHaveLength(0);
    });
});
