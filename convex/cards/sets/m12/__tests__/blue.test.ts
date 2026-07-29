// Phantasmal Image (M12, issue #1563) — the permanent test suite for the
// engine gap this card closes: `CopyEffectOptions.additionalSubtypes` /
// `additionalTriggeredAbilityIds` (`convex/cards/types.ts`, applied in
// `convex/gre/copy.ts`). `resolveSteps` (the copy-effect protocol shape,
// Clone-parity) is governed by the FULL Card testing convention — GRE unit
// tests plus a mandatory wire-format test, since the added subtype and P/T
// are visible client-side.
//
// The two mechanisms under test are already interpreter-suite-exercised
// (`sacrifice` targeting `$source`, the `BECAME_TARGET` event Ward already
// consumes) — no new Op. What's genuinely new here is `applyCopy` threading
// an ADDED subtype and a GRANTED triggered ability onto a copy, and that
// grant surviving through `effectiveTriggeredAbilities`'s trigger-scan path
// exactly as if printed on the copy.

import { describe, it, expect } from "vitest";
import { phantasmalImage } from "../blue";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { driveCopyChoice } from "../../lea/__tests__/helpers";
import { registerTokenDefinition } from "../../..";
import {
    resolveTopOfStack,
    emitBecameTargetEvents,
    processPendingActionTriggers,
} from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { PermanentView } from "../../../types";

// A synthetic targeted-removal instant so the "becomes the target of a
// spell" leg of the self-sac trigger can be exercised without depending on
// any specific real removal card's shape.
const REMOVAL_ID = "test-phantasmal-image-removal";
registerTokenDefinition({
    id: REMOVAL_ID,
    name: REMOVAL_ID,
    rarity: "common",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});

function bearState(): GameState {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [bear] })],
    });
}

describe("Phantasmal Image (copy + Illusion subtype + self-sac trigger, CR 707.2 / 603.2b)", () => {
    it("enters as a copy of the chosen creature, Illusion IN ADDITION TO its other subtypes (CR 707.2 except clause)", () => {
        const state = bearState();
        const item = pushSpell(state, phantasmalImage.id, "p1");
        item.id = "image1";
        driveCopyChoice(state, item, "bear");
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "image1"
        )!;
        expect(copy).toBeDefined();
        expect((copy.card as { id: string }).id).toBe(grizzlyBears.id);
        expect(copy.types).toEqual(["Creature"]);
        // Bear's own subtype PLUS the added Illusion (not a replacement).
        expect(copy.subtypes).toEqual(["Bear", "Illusion"]);
        expect(getEffectivePower(state, copy)).toBe(2);
        expect(getEffectiveToughness(state, copy)).toBe(2);
        expect(copy.copiedFrom).toBe(phantasmalImage.id);
    });

    it("enters as a printed 0/0 Illusion (no granted trigger) and dies to SBA when no creature is copied", () => {
        const state = makeState();
        const item = pushSpell(state, phantasmalImage.id, "p1");
        item.id = "image1";
        // No creatures on the battlefield → the step copies nothing, no
        // suspend — mirrors Clone's "enters as a 0/0" fallback (CR 704.5f).
        expect(resolveTopOfStack(state)).not.toBeNull();
        const copy = state.players[0].battlefield.find(
            (c) => c.id === "image1"
        );
        expect(copy).toBeDefined();
        expect(getEffectiveToughness(state, copy!)).toBe(0);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "image1")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "image1")).toBe(
            true
        );
    });

    it("the copy has the self-sacrifice trigger, and it fires when a SPELL becomes it (CR 603.2b)", () => {
        const state = bearState();
        const item = pushSpell(state, phantasmalImage.id, "p1");
        item.id = "image1";
        driveCopyChoice(state, item, "bear");
        expect(
            state.players[0].battlefield.some((c) => c.id === "image1")
        ).toBe(true);

        const removal = pushSpell(state, REMOVAL_ID, "p2", [
            { type: "permanent", id: "image1" },
        ]);
        emitBecameTargetEvents(state, removal.targets, "p2", removal.id);
        processPendingActionTriggers(state);
        // The self-sac trigger is now ON TOP of the removal spell — assert
        // this explicitly (not just the eventual graveyard outcome, which
        // "destroy" alone would ALSO produce once the removal spell resolves
        // on its own — a test that can't tell the two apart is worthless).
        expect(state.stack).toHaveLength(2);
        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            "phantasmal-image-sacrifice"
        );
        // Resolving ONLY the trigger (one resolveTopOfStack call) already
        // sacrifices the copy, BEFORE the removal spell underneath it ever
        // resolves — proves the sacrifice comes from the granted trigger,
        // not from "destroy" resolving normally.
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(removal.id);
        expect(
            state.players[0].battlefield.some((c) => c.id === "image1")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "image1")).toBe(
            true
        );
        // The self-sac trigger's own grant is dropped by `revertCopy`
        // (`gre/copy.ts`) on this exact departure — `sacrifice` is a
        // battlefield→graveyard move, the branch
        // `resetBattlefieldTransientState` does NOT cover (it only clears
        // grants for a hand/library move). Asserting this here is the whole
        // point: this test already runs the grant-drop code path, it just
        // never checked its outcome before.
        const gyCard = state.players[0].graveyard.find(
            (c) => c.id === "image1"
        )!;
        expect(gyCard.grantedTriggeredAbilities).toBeUndefined();
    });

    it("the trigger's matches() admits ANY spell or ability — no opponent-only restriction (unlike Ward)", () => {
        const template = phantasmalImage.triggeredGrantTemplates![0];
        expect(template.event).toBe("BECAME_TARGET");
        const self: PermanentView = {
            id: "image1",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: ["Bear", "Illusion"],
            isTapped: false,
            card: {},
        };
        // A spell/ability the SAME controller casts/activates still fires it
        // (Oracle text: "a spell or ability", no opponent restriction).
        expect(
            template.matches(
                {
                    type: "BECAME_TARGET",
                    target: { type: "permanent", id: "image1" },
                    targetControllerId: "p1",
                    sourceControllerId: "p1",
                    sourceInstanceId: "spell1",
                },
                self
            )
        ).toBe(true);
        // A different permanent becoming a target does not.
        expect(
            template.matches(
                {
                    type: "BECAME_TARGET",
                    target: { type: "permanent", id: "some-other-creature" },
                    targetControllerId: "p1",
                    sourceControllerId: "p1",
                    sourceInstanceId: "spell1",
                },
                self
            )
        ).toBe(false);
    });

    it("wire format: the added Illusion subtype AND effective P/T survive projectPublicState (mandatory)", () => {
        const state = bearState();
        const item = pushSpell(state, phantasmalImage.id, "p1");
        item.id = "image1";
        driveCopyChoice(state, item, "bear");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "image1"
        )!;
        expect(slim.subtypes).toEqual(["Bear", "Illusion"]);
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});
