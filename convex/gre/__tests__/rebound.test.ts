// Rebound (CR 702.88) — the resolution-time exile redirect + next-upkeep
// reflexive Cast/Decline capability. Exercised once here for the mechanic
// itself (built once, reused by every rebound card — Ephemerate today); the
// per-card behaviour lives in the parallel colour test file
// (`cards/sets/mh1/__tests__/white.test.ts`). Covers the full CR 702.88
// timing, driven through the REAL engine path (resolveTopOfStack →
// fireDelayedTriggers → resolveTopOfStack → declineRebound):
//   - CR 702.88a: a spell cast from HAND with rebound is exiled (not
//     graveyarded) as it resolves, and a caster-scoped next-upkeep delayed
//     trigger is scheduled
//   - the delayed trigger fires ONLY on the caster's OWN next upkeep, never
//     the opponent's ("at the beginning of YOUR next upkeep")
//   - firing builds a reflexive Cast/Decline StackItem; resolving it opens
//     the caster's single cast window (castableFromExileBy +
//     castFromExileWithoutPayingManaCost + state.reboundCastWindow)
//   - CR 702.88d: the exile recast (no `reboundFromHand`) resolves to the
//     graveyard normally and never reboundes again
//   - CR 702.88c: declining leaves the card in exile, NOT the graveyard
//   - the frontend-wiring SURFACE: projectPublicState carries the cast
//     affordance to the caster and hides it from the opponent
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    getPlayer,
    removeFromZone,
    resolveTopOfStack,
    type StackItem,
} from "../state";
import { getLegalActions } from "../rules";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    locateCastSource,
    castRawManaCost,
    reboundCastStackFlags,
} from "../../game";
import {
    hasRebound,
    declineRebound,
    consumeReboundCastChoice,
    openReboundWindowCard,
} from "../rebound";
import { ephemerate } from "../../cards/sets/mh1/white";
import { grizzlyBears } from "../../cards/sets/lea";

/** Advances `state` one step at a time (the raw engine transition, bypassing
 *  priority-pass gating — the same helper used across `phases.test.ts`)
 *  until it reaches `activePlayerId`'s own UPKEEP step, which is where
 *  `fireDelayedTriggers(state, "next-upkeep")` runs (phases.ts). A safety cap
 *  guards against an infinite loop if the phase cycle is ever broken. */
function advanceToOwnUpkeep(
    state: ReturnType<typeof makeState>,
    playerId: string
): void {
    for (let i = 0; i < 40; i++) {
        if (state.phase === "UPKEEP" && state.activePlayerId === playerId) {
            return;
        }
        advancePhase(state);
    }
    throw new Error("advanceToOwnUpkeep: safety cap exceeded");
}

describe("Rebound capability (CR 702.88)", () => {
    describe("resolution-time exile redirect (CR 702.88a)", () => {
        it("exiles a hand-cast rebound spell instead of the graveyard, and schedules a caster-scoped next-upkeep delayed trigger", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            // A raw hand-cast commit stamps `reboundFromHand` — mirror it here
            // since `pushSpell` is a bare stack-push fixture, not the real
            // `game.ts` cast-commit path (covered separately below).
            item.reboundFromHand = true;

            resolveTopOfStack(state);

            const player = getPlayer(state, "p1");
            expect(player.graveyard.some((c) => c.id === item.id)).toBe(
                false
            );
            const exiled = player.exile.find((c) => c.id === item.id);
            expect(exiled).toBeDefined();
            expect(exiled!.reboundExiled).toBe(true);
            expect(exiled!.castableFromExileBy).toBeUndefined();

            // A caster-scoped next-upkeep delayed trigger was scheduled.
            expect(state.delayedTriggers).toHaveLength(1);
            const trig = state.delayedTriggers![0];
            expect(trig.timing).toBe("next-upkeep");
            expect(trig.controller).toBe("p1");
            expect(trig.targetPlayerId).toBe("p1");
            expect(trig.reboundCardInstanceId).toBe(item.id);
        });

        it("a spell without rebound resolves to the graveyard as normal (control)", () => {
            const bear = makeInstance(grizzlyBears.id, { zone: "hand" });
            expect(hasRebound(bear)).toBe(false);
            const p1 = makePlayer("p1", { hand: [bear] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            const item = pushSpell(state, grizzlyBears.id, "p1");
            resolveTopOfStack(state);

            // Grizzly Bears is a creature — resolves to the battlefield, not
            // exile/graveyard, but the important assertion is no rebound
            // machinery engaged at all.
            expect(state.delayedTriggers ?? []).toHaveLength(0);
            const player = getPlayer(state, "p1");
            expect(player.battlefield.some((c) => c.id === item.id)).toBe(
                true
            );
            expect(player.exile.some((c) => c.id === item.id)).toBe(false);
        });
    });

    describe("cast-stack-flag gate (CR 702.88a / 702.88d)", () => {
        it("stamps reboundFromHand only for a hand cast of a rebound card", () => {
            const card = makeInstance(ephemerate.id, { zone: "hand" });
            expect(reboundCastStackFlags(card, "hand")).toEqual({
                reboundFromHand: true,
            });
        });

        it("omits the flag for a non-hand cast zone — CR 702.88d's 'no second rebound' is free from this single gate", () => {
            const card = makeInstance(ephemerate.id, { zone: "exile" });
            expect(reboundCastStackFlags(card, "exile")).toEqual({});
        });

        it("omits the flag for a hand-cast card with no rebound", () => {
            const bear = makeInstance(grizzlyBears.id, { zone: "hand" });
            expect(reboundCastStackFlags(bear, "hand")).toEqual({});
        });
    });

    describe("reflexive cast-trigger fires at the caster's OWN next upkeep only", () => {
        it("does NOT fire on the opponent's next upkeep", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);
            expect(state.delayedTriggers).toHaveLength(1);

            // p2's upkeep passes (targetPlayerId "p1" doesn't match).
            advanceToOwnUpkeep(state, "p2");
            expect(state.delayedTriggers).toHaveLength(1);
            expect(state.stack.some((s) => s.reboundTrigger)).toBe(false);
        });

        it("fires at the caster's own next upkeep, and resolving the reflexive trigger opens the Cast/Decline window", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);

            advanceToOwnUpkeep(state, "p1");
            // The delayed trigger fired: dequeued and a reflexive StackItem
            // pushed, controlled by the caster.
            expect(state.delayedTriggers ?? []).toHaveLength(0);
            expect(state.stack).toHaveLength(1);
            const trig = state.stack[0];
            expect(trig.reboundTrigger).toBe(item.id);
            expect(trig.controllerId).toBe("p1");

            resolveTopOfStack(state);
            expect(state.stack).toHaveLength(0);

            const exiled = getPlayer(state, "p1").exile.find(
                (c) => c.id === item.id
            )!;
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(exiled.castFromExileWithoutPayingManaCost).toBe(true);
            expect(state.reboundCastWindow).toEqual({
                cardId: item.id,
                ownerId: "p1",
            });
            const head = state.pendingChoices?.[0];
            expect(head?.kind).toBe("rebound-cast");
            expect(head?.playerId).toBe("p1");
            expect(head?.cardInstanceId).toBe(item.id);
            expect(state.priorityPlayerId).toBe("p1");

            // The free-cast waiver is live: castRawManaCost resolves to the
            // empty cost from exile.
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                item.id
            );
            expect(src.zone).toBe("exile");
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({});
            expect(getLegalActions(state, getPlayer(state, "p1"), exiled)).toContain(
                "cast"
            );
        });
    });

    describe("decline → stays exiled (CR 702.88c)", () => {
        it("declineRebound leaves the card in exile, NOT the graveyard", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);
            advanceToOwnUpkeep(state, "p1");
            resolveTopOfStack(state); // opens the window

            expect(openReboundWindowCard(state)).toBeDefined();
            expect(declineRebound(state)).toBe(true);

            const player = getPlayer(state, "p1");
            const exiled = player.exile.find((c) => c.id === item.id);
            expect(exiled).toBeDefined(); // CR 702.88c — remains exiled
            expect(player.graveyard.some((c) => c.id === item.id)).toBe(
                false
            );
            expect(exiled!.reboundExiled).toBeUndefined();
            expect(exiled!.castableFromExileBy).toBeUndefined();
            expect(state.reboundCastWindow).toBeUndefined();
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    describe("exile recast (CR 702.88d) — resolves to graveyard, never reboundes again", () => {
        it("an exile-cast rebound spell (no reboundFromHand) resolves normally to the graveyard", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const secondTarget = makeInstance(grizzlyBears.id, {
                id: "bear2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", {
                battlefield: [target, secondTarget],
            });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);
            advanceToOwnUpkeep(state, "p1");
            resolveTopOfStack(state); // opens the window

            // Accept: consume the choice, then commit the cast exactly like
            // `announceCast` does — exile → stack (a FRESH target this time),
            // with NO `reboundFromHand` (this is an exile cast, not a hand
            // cast).
            consumeReboundCastChoice(state, "p1", item.id);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.reboundCastWindow).toBeUndefined();

            const moved = removeFromZone(getPlayer(state, "p1"), item.id, "exile");
            expect(moved.reboundExiled).toBeUndefined();
            expect(moved.castableFromExileBy).toBeUndefined();
            const stackItem: StackItem = {
                ...moved,
                castById: "p1",
                targets: [{ type: "permanent", id: "bear2" }],
                // Explicitly NOT reboundFromHand — this is the exile recast.
            };
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            const player = getPlayer(state, "p1");
            // CR 702.88d — lands in the graveyard, not exiled again.
            expect(player.graveyard.some((c) => c.id === item.id)).toBe(true);
            expect(player.exile.some((c) => c.id === item.id)).toBe(false);
            // No new delayed trigger was scheduled — it never reboundes again.
            expect(state.delayedTriggers ?? []).toHaveLength(0);
        });
    });

    describe("serialization round-trip", () => {
        it("preserves the rebound-exile marker and the scheduled delayed trigger before the window opens", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);

            const round = expandState(compactState(state));
            const exiled = getPlayer(round, "p1").exile.find(
                (c) => c.id === item.id
            );
            expect(exiled?.reboundExiled).toBe(true);
            expect(exiled?.castableFromExileBy).toBeUndefined();
            expect(round.delayedTriggers).toHaveLength(1);
            expect(round.delayedTriggers![0].reboundCardInstanceId).toBe(
                item.id
            );
            expect(round.delayedTriggers![0].targetPlayerId).toBe("p1");
        });

        it("preserves the open cast window (castableFromExileBy + reboundCastWindow)", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);
            advanceToOwnUpkeep(state, "p1");
            resolveTopOfStack(state); // opens the window

            const round = expandState(compactState(state));
            const exiled = getPlayer(round, "p1").exile.find(
                (c) => c.id === item.id
            );
            expect(exiled?.reboundExiled).toBe(true);
            expect(exiled?.castableFromExileBy).toBe("p1");
            expect(exiled?.castFromExileWithoutPayingManaCost).toBe(true);
            expect(round.reboundCastWindow).toEqual({
                cardId: item.id,
                ownerId: "p1",
            });
        });
    });

    describe("frontend wiring — projectPublicState (CR 702.88a)", () => {
        it("carries the cast affordance to the caster and hides it from the opponent while the window is open", () => {
            const target = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const p1 = makePlayer("p1", { battlefield: [target] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            const item = pushSpell(state, ephemerate.id, "p1", [
                { type: "permanent", id: "bear" },
            ]);
            item.reboundFromHand = true;
            resolveTopOfStack(state);
            advanceToOwnUpkeep(state, "p1");
            resolveTopOfStack(state); // opens the window

            const ownView = projectPublicState(state, 1, "p1");
            const ownExile = ownView.players[0].exile.find(
                (c) => c.id === item.id
            )!;
            expect(ownExile.castableFromExileBy).toBe("p1");
            expect(ownExile.legalActions).toContain("cast");

            const oppView = projectPublicState(state, 1, "p2");
            const oppExile = oppView.players[0].exile.find(
                (c) => c.id === item.id
            )!;
            expect(oppExile.legalActions ?? []).not.toContain("cast");
        });
    });

    describe("card definitions", () => {
        it("Ephemerate carries the rebound keyword and targets a creature you control", () => {
            const e = makeInstance(ephemerate.id, { zone: "hand" });
            expect(hasRebound(e)).toBe(true);
            expect(ephemerate.staticAbilities).toContain("rebound");
            expect(ephemerate.targetRequirement).toEqual({
                type: "Creature",
                count: 1,
                controller: "you",
            });
        });
    });
});
