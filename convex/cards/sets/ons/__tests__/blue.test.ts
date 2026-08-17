// ONS — blue per-card behaviour tests (ADR 0043 colour split). Chain of Vapor
// is a resolveSteps (protocol) card, so it earns a dedicated describe block
// exercising the bounce + the optional land-sacrifice "chain" copy end to end
// (per the Card testing convention). Shared fixtures live in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { chainOfVapor } from "../blue";
import { grizzlyBears, island } from "../../lea";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

// ---------------------------------------------------------------------------
// Chain of Vapor — {U} instant: return target nonland permanent to hand, then
// that permanent's controller may sacrifice a land to copy this spell and
// retarget the copy (CR 400.7 bounce, CR 608.2 stepped resolution, CR 701.21
// sacrifice cost, CR 707.12 "copy this spell").
// ---------------------------------------------------------------------------
describe("Chain of Vapor (CR 400.7 / 608.2 / 701.21 / 707.12)", () => {
    type Targets = NonNullable<StackItem["targets"]>;

    // Mirrors finalizeTargetSelection's "copy-retarget" branch in game.ts:
    // writes the chosen targets onto the spell copy and clears the prompt.
    // Pure helper (mirrors the Chain Lightning tests in leg/red.test.ts).
    function applyCopyRetarget(state: GameState, newTargets: Targets): void {
        const pt = state.pendingTarget!;
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (copy) copy.targets = newTargets;
        state.pendingTarget = undefined;
    }

    it("definition: {U} instant targeting a nonland permanent (Scryfall)", () => {
        expect(chainOfVapor.manaCost).toEqual({ U: 1 });
        expect(chainOfVapor.types).toEqual(["Instant"]);
        expect(chainOfVapor.rarity).toBe("uncommon");
        expect(chainOfVapor.targetRequirement?.excludeTypes).toBe("Land");
        expect(chainOfVapor.targetRequirement?.count).toBe(1);
        expect(getDefinition(chainOfVapor.id)).toBe(chainOfVapor);
    });

    it("returns the target nonland permanent to its owner's hand and offers the controller a may-sacrifice (CR 400.7 return / 701.21 sacrifice)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "p2-bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const land = makeInstance(island.id, {
            id: "p2-island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bears, land] }),
            ],
        });
        pushSpell(state, chainOfVapor.id, "p1", [
            { type: "permanent", id: "p2-bears" },
        ]);

        resolveTopOfStack(state); // step 0 bounce → step 1 suspends on may-sac

        // Bounced to its OWNER's hand (p2), off the battlefield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-bears")
        ).toBeUndefined();
        expect(
            state.players[1].hand.some(
                (c) => (c.card as { id: string }).id === grizzlyBears.id
            )
        ).toBe(true);
        // The bounced permanent's controller (p2) is offered the sacrifice.
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");

        // Wire format: the bounce survives the projection (the card is off the
        // projected battlefield — no fat field read masks the zone change).
        const projected = projectPublicState(state, 2, "p2");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "p2-bears")
        ).toBeUndefined();
    });

    it("declining the may-sacrifice ends the chain — no copy (CR 707.12)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "p2-bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const land = makeInstance(island.id, {
            id: "p2-island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bears, land] }),
            ],
        });
        pushSpell(state, chainOfVapor.id, "p1", [
            { type: "permanent", id: "p2-bears" },
        ]);
        resolveTopOfStack(state);

        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.stack).toHaveLength(0); // no copy
        expect(state.pendingTarget).toBeUndefined();
        // The land was NOT sacrificed (decline paid nothing).
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2-island")
        ).toBe(true);
        // The real Chain of Vapor went to its owner's graveyard.
        expect(
            state.players[0].graveyard.map((c) => (c.card as { id: string }).id)
        ).toEqual([chainOfVapor.id]);
    });

    it("sacrificing a land copies the spell; the copy retargets and bounces another permanent (CR 701.21 / 707.12)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "p2-bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const land = makeInstance(island.id, {
            id: "p2-island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        // p1 controls its own creature — the copy's new target.
        const p1Bears = makeInstance(grizzlyBears.id, {
            id: "p1-bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Bears] }),
                makePlayer("p2", { battlefield: [bears, land] }),
            ],
        });
        pushSpell(state, chainOfVapor.id, "p1", [
            { type: "permanent", id: "p2-bears" },
        ]);
        resolveTopOfStack(state);

        // p2 sacrifices their island to copy the spell (CR 701.21 / 707.12).
        applyMayPaySubmit(state, {
            playerId: "p2",
            accept: true,
            sacrificeIds: ["p2-island"],
        });
        expect(
            state.players[1].graveyard.some((c) => c.id === "p2-island")
        ).toBe(true);

        // A copy controlled by p2 awaits a (new) target; p2 — who sacrificed —
        // chooses (CR 707.10 / 707.10c).
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        expect(pt.playerId).toBe("p2");
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        expect(copy.isCopy).toBe(true);
        expect(copy.controllerId).toBe("p2");
        expect((copy.card as { id: string }).id).toBe(chainOfVapor.id);

        // p2 points the copy at p1's creature; resolve it.
        applyCopyRetarget(state, [{ type: "permanent", id: "p1-bears" }]);
        resolveTopOfStack(state);

        // The copy bounced p1's creature to p1's hand.
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-bears")
        ).toBeUndefined();
        expect(
            state.players[0].hand.some(
                (c) => (c.card as { id: string }).id === grizzlyBears.id
            )
        ).toBe(true);
        // The copy now offers ITS controller-of-target (p1) a may-sacrifice —
        // the chain can continue. p1 declines to end it.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.stack).toHaveLength(0);
        // Only the original real card is in a graveyard; the copy ceased to
        // exist (CR 707.10a).
        const allGy = [
            ...state.players[0].graveyard,
            ...state.players[1].graveyard,
        ];
        expect(allGy.some((c) => c.id === copy.id)).toBe(false);
    });
});
