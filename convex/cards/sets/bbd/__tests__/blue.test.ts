// BBD — per-card behavior tests for blue cards in
// `convex/cards/sets/bbd/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { spellseeker } from "../blue";
import { grizzlyBears } from "../../lea/green";
import { registerTokenDefinition } from "../../..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const CHEAP_INSTANT_ID = "test-bbd-cheap-instant";
registerTokenDefinition({
    id: CHEAP_INSTANT_ID,
    name: "Test Cheap Instant",
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Instant"],
});
const EXPENSIVE_SORCERY_ID = "test-bbd-expensive-sorcery";
registerTokenDefinition({
    id: EXPENSIVE_SORCERY_ID,
    name: "Test Expensive Sorcery",
    rarity: "common",
    manaCost: { X: 5 },
    types: ["Sorcery"],
});

describe("Spellseeker (CR 603.6a ETB / 701.23 / 400.7 / 701.24, issue #677)", () => {
    it("ETB: may search for an instant/sorcery card with mana value 2 or less, put it into hand", () => {
        const seeker = makeInstance(spellseeker.id, {
            id: "seeker1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cheap = makeInstance(CHEAP_INSTANT_ID, {
            id: "cheap1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const expensive = makeInstance(EXPENSIVE_SORCERY_ID, {
            id: "expensive1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [seeker],
                    library: [cheap, expensive, bear],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...seeker,
            id: "trig-seeker-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "spellseeker-etb-search",
            triggerSourceId: "seeker1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "seeker1",
                controllerId: "p1",
                types: seeker.types,
            },
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // Only the cheap instant matches: the expensive sorcery fails the
        // mana-value ceiling, the Bear fails the type filter.
        expect(head.candidateIds).toEqual(["cheap1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["cheap1"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("cheap1");
    });
});
