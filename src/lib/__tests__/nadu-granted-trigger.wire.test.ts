// Frontend wiring for Nadu, Winged Wisdom's GRANTED triggered ability
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).
//
// The bug class this closes: a granted trigger's stack item carries the
// RECIPIENT creature's `card.id`, not the granting card's. A client that looks
// the ability up on `getDefinition(card.id).triggeredAbilities` finds nothing
// and <StackRow> renders a blank triggered ability — a card that is perfectly
// correct server-side and dead in the UI. The only thing that saves it is the
// `grantedTriggeredAbilities` provenance list riding along on the stack item,
// which means the assertion MUST be driven through the projection reducer: a
// hand-built stack item would mask a dropped field.

import { describe, it, expect } from "vitest";
import { getTriggeredAbilityOracleText } from "../card-utils";
import { naduWingedWisdom } from "../../../convex/cards/sets/mh3/multicolor";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup";
import {
    applySourceStaticEffects,
    type StackItem,
} from "../../../convex/gre/state";
import { projectPublicState } from "../../../convex/gameProjections";

describe("Nadu's granted trigger renders on the stack (frontend wiring)", () => {
    it("resolves the granted ability's oracle text off a PROJECTED stack item", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const nadu = makeInstance(naduWingedWisdom.id, {
            id: "nadu-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(nadu, bear);
        applySourceStaticEffects(state, nadu);
        // The recipient now carries the grant provenance the client needs.
        expect(bear.grantedTriggeredAbilities).toBeDefined();

        // A trigger item as `buildTriggerItem` builds it: the RECIPIENT's card
        // id, plus the provenance list copied off the permanent.
        state.stack.push({
            ...bear,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "nadu-became-target",
            triggerSourceId: bear.id,
        } as StackItem);

        const projected = projectPublicState(state, 1, "p1");
        const item = projected.stack[0];
        // The stack item's card is the BEAR — looking the ability up on its own
        // definition finds nothing, which is exactly the trap.
        expect(item.card.id).toBe(grizzlyBears.id);
        const text = getTriggeredAbilityOracleText(
            item.card.id,
            item.triggeredAbilityId!,
            item.grantedTriggeredAbilities
        );
        expect(text).toBe(
            "Whenever this creature becomes the target of a spell or ability, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand. This ability triggers only twice each turn."
        );
    });
});
