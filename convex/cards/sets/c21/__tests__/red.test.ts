// C21 — per-card behavior tests for red cards in
// `convex/cards/sets/c21/red.ts` (set split by colour, ADR 0043).
//
// Laelia, the Blade Reforged (issue #1558): ability 1 is the shipped
// impulse-draw protocol (Robber of the Rich / Headliner Scarlett idiom);
// ability 2 is the new `CARDS_EXILED` consumer (CR 400.1 / 603.3b / 608.2i).
// The batching/emission plumbing itself (millCards, exileWithAttachments,
// ctx.exile/exileFaceDown) is exercised generically in
// `convex/gre/__tests__/cardsExiled.test.ts`; this file proves Laelia's
// TRIGGER-SIDE consumer behavior: scope ("your" library/graveyard only),
// fromZone filtering (library/graveyard only, not battlefield/hand), and the
// official once-per-occurrence ruling.

import { describe, it, expect } from "vitest";
import { laeliaTheBladeReforged } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    buildSpellContext,
    exileWithAttachments,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";

const CHEAP_CARD_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus stub

function attackEvent(attackerId: string): StackItem["triggerEvent"] {
    return {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "p1",
        attackerIds: [attackerId],
    };
}

function pushAttackTrigger(
    state: GameState,
    laelia: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...laelia,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "laelia-attack",
        triggerSourceId: laelia.id,
        triggerEvent: attackEvent(laelia.id),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Resolves every trigger `collectTriggers` finds for the CURRENT
 *  `state.pendingEvents` batch (does not flush — callers that need to keep
 *  scanning after should read pendingEvents themselves). */
function resolveCollectedTriggers(state: GameState): void {
    const triggers = collectTriggers(state, state.pendingEvents ?? []);
    for (const t of triggers) {
        state.stack.push(t);
        resolveTopOfStack(state);
    }
}

function counterCount(state: GameState, id: string): number {
    const card = state.players[0].battlefield.find((c) => c.id === id);
    return card?.counters?.["+1/+1"] ?? 0;
}

describe("Laelia, the Blade Reforged (issue #1558, CR 400.1 / 603.3b / 608.2i)", () => {
    it("is a {2}{R} Legendary Spirit Warrior 2/2 with haste", () => {
        expect(laeliaTheBladeReforged.manaCost).toEqual({ X: 2, R: 1 });
        expect(laeliaTheBladeReforged.types).toEqual(["Creature"]);
        expect(laeliaTheBladeReforged.supertypes).toEqual(["Legendary"]);
        expect(laeliaTheBladeReforged.subtypes).toEqual(["Spirit", "Warrior"]);
        expect(laeliaTheBladeReforged.power).toBe(2);
        expect(laeliaTheBladeReforged.toughness).toBe(2);
        expect(laeliaTheBladeReforged.staticAbilities).toEqual(["haste"]);
    });

    describe("ability 1 — attack impulse-draw (CR 508.1)", () => {
        it("exiles the top card of its controller's library face down, castable this turn", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
                isAttacking: true,
            });
            const top = makeInstance(CHEAP_CARD_ID, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [laelia],
                        library: [top],
                    }),
                    makePlayer("p2"),
                ],
                combat: {
                    attackerIds: ["laelia"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            pushAttackTrigger(state, laelia);
            expect(state.players[0].library).toHaveLength(0);
            const exiled = state.players[0].exile.find((c) => c.id === "top")!;
            expect(exiled).toBeDefined();
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(exiled.knownTo).toEqual(["p1"]);
        });

        it("does nothing when the library is empty", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
                isAttacking: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia], library: [] }),
                    makePlayer("p2"),
                ],
                combat: {
                    attackerIds: ["laelia"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            expect(() => pushAttackTrigger(state, laelia)).not.toThrow();
            expect(state.players[0].exile).toHaveLength(0);
        });
    });

    describe("ability 2 — CARDS_EXILED counter (CR 400.1 / 603.3b / 608.2i)", () => {
        it("puts a +1/+1 counter on Laelia when a card is exiled from her controller's library", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const top = makeInstance(CHEAP_CARD_ID, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia], library: [top] }),
                    makePlayer("p2"),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exileFaceDown("p1", "top", "library", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(1);
        });

        it("puts a +1/+1 counter on Laelia when a card is exiled from her controller's graveyard", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const dead = makeInstance(CHEAP_CARD_ID, {
                id: "dead",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [laelia],
                        graveyard: [dead],
                    }),
                    makePlayer("p2"),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exileFaceDown("p1", "dead", "graveyard", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(1);
        });

        it("does NOT trigger when a card is exiled from the battlefield (fromZone filter)", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const victim = makeInstance(CHEAP_CARD_ID, {
                id: "victim",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia, victim] }),
                    makePlayer("p2"),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exile({ type: "permanent", id: "victim" });
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(0);
        });

        it("does NOT trigger on an OPPONENT's library exile (owner scope, 'your' library only)", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const oppTop = makeInstance(CHEAP_CARD_ID, {
                id: "opp-top",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia] }),
                    makePlayer("p2", { library: [oppTop] }),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exileFaceDown("p2", "opp-top", "library", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(0);
        });

        it("fires ONCE (one counter) for a batch that exiles multiple cards in a single occurrence, per the official ruling", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const host: ReturnType<typeof makeInstance> = makeInstance(
                CHEAP_CARD_ID,
                {
                    id: "host",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                    types: ["Artifact"],
                }
            );
            const aura: ReturnType<typeof makeInstance> = makeInstance(
                CHEAP_CARD_ID,
                {
                    id: "aura",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                    types: ["Enchantment"],
                    subtypes: ["Aura"],
                    attachedTo: "host",
                }
            );
            // Both `host` and `aura` are exiled from the BATTLEFIELD (not
            // library/graveyard), so this exercises pure event-batching (one
            // CARDS_EXILED occurrence → at most one trigger firing), not the
            // fromZone filter — see the dedicated library-batch case below for
            // the qualifying-zone version.
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia, host, aura] }),
                    makePlayer("p2"),
                ],
            });
            expect(counterCount(state, "laelia")).toBe(0);
            exileWithAttachments(state, "host", {
                sourceId: "source",
                returnTapped: false,
            });
            resolveCollectedTriggers(state);
            // Battlefield source doesn't qualify Laelia's filter — asserts 0,
            // proving the SAME occurrence that batches 2 cards still respects
            // the fromZone gate (no accidental double/triple counting either).
            expect(counterCount(state, "laelia")).toBe(0);
        });

        it("fires TWO separate times (two counters) for TWO separate exile occurrences from the library", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const c1 = makeInstance(CHEAP_CARD_ID, {
                id: "c1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const c2 = makeInstance(CHEAP_CARD_ID, {
                id: "c2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [laelia],
                        library: [c1, c2],
                    }),
                    makePlayer("p2"),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exileFaceDown("p1", "c1", "library", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(1);
            ctx.exileFaceDown("p1", "c2", "library", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(2);
        });

        it("self-feeds off ability 1: attacking impulse-exiles a library card, which triggers ability 2 for a +1/+1 counter", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
                isAttacking: true,
            });
            const top = makeInstance(CHEAP_CARD_ID, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [laelia],
                        library: [top],
                    }),
                    makePlayer("p2"),
                ],
                combat: {
                    attackerIds: ["laelia"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            // Ability 1 resolves and impulse-exiles the top card, emitting
            // CARDS_EXILED. `resolveTopOfStack` ITSELF scans pendingEvents and
            // places any matching trigger on the stack after each resolution
            // (state.ts ~3690) — so ability 2 is already queued behind ability
            // 1's resolution; drain the rest of the stack to resolve it too.
            pushAttackTrigger(state, laelia);
            while (state.stack.length > 0) resolveTopOfStack(state);
            expect(state.players[0].exile.some((c) => c.id === "top")).toBe(
                true
            );
            expect(counterCount(state, "laelia")).toBe(1);
        });

        it("wire format: the +1/+1 counter survives projectPublicState", () => {
            const laelia = makeInstance(laeliaTheBladeReforged.id, {
                id: "laelia",
                controllerId: "p1",
                ownerId: "p1",
            });
            const top = makeInstance(CHEAP_CARD_ID, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [laelia], library: [top] }),
                    makePlayer("p2"),
                ],
            });
            const stackItem = {
                ...laelia,
                zone: "stack" as const,
                castById: "p1",
            };
            const ctx = buildSpellContext(state, stackItem);
            ctx.exileFaceDown("p1", "top", "library", "p1");
            resolveCollectedTriggers(state);
            expect(counterCount(state, "laelia")).toBe(1);

            for (const viewerId of ["p1", "p2"]) {
                const projected = projectPublicState(state, 1, viewerId);
                const slim = projected.players
                    .find((p) => p.id === "p1")!
                    .battlefield.find((c) => c.id === "laelia")!;
                expect(slim.counters?.["+1/+1"]).toBe(1);
            }
        });
    });
});
