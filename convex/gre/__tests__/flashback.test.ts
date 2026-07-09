// Flashback capability tests (CR 702.34). Built once here, reused by all six
// cube flashback cards. Covers the whole GRE → game.ts → UI path the capability
// crosses:
//   - the flashback cost lookup (printed + Snapcaster's granted, convex/gre/flashback.ts)
//   - the cast affordance gate (getLegalActions offers "cast" from the graveyard)
//   - the real cast-commit seam (locateCastSource / castRawManaCost /
//     flashbackStackFlags exported from game.ts, driven in the same order
//     announceCast drives them — the project has no convex-test harness, issue #944)
//   - exile-on-resolve (finalizeSpellResolution routes the card to exile, not
//     the graveyard) via resolveTopOfStack
//   - the "cast from a graveyard" clause accessor (wasCastFromGraveyard)
//   - the until-end-of-turn grant expiry at cleanup (CR 514.2)
//   - serialization round-trip of the two new fields
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     graveyard flashback card with legalActions (the affordance the UI reads)
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type GameState,
    type StackItem,
} from "../state";
import { getLegalActions } from "../rules";
import {
    getFlashbackCost,
    findFlashbackCastable,
    hasFlashback,
} from "../flashback";
import { finalizeCleanup } from "../phases";
import {
    locateCastSource,
    castRawManaCost,
    flashbackStackFlags,
} from "../../game";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { firebolt } from "../../cards/sets/ody/red";
import { faithlessLooting } from "../../cards/sets/dka/red";
import { grizzlyBears } from "../../cards/sets/lea";

describe("Flashback capability (CR 702.34)", () => {
    describe("flashback cost lookup (convex/gre/flashback.ts)", () => {
        it("getFlashbackCost reads the printed flashback cost", () => {
            const fb = makeInstance(firebolt.id, { zone: "graveyard" });
            expect(getFlashbackCost(fb)).toEqual({ X: 4, R: 1 });
            expect(hasFlashback(fb)).toBe(true);
        });

        it("a card with no flashback has no flashback cost", () => {
            const bear = makeInstance(grizzlyBears.id, { zone: "graveyard" });
            expect(getFlashbackCost(bear)).toBeUndefined();
            expect(hasFlashback(bear)).toBe(false);
        });

        it("a granted flashback (Snapcaster) overrides the printed cost", () => {
            const bear = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                grantedFlashback: { X: 1, U: 1 },
            });
            expect(getFlashbackCost(bear)).toEqual({ X: 1, U: 1 });
        });

        it("findFlashbackCastable locates a flashback card in the graveyard", () => {
            const fb = makeInstance(firebolt.id, { zone: "graveyard" });
            const bear = makeInstance(grizzlyBears.id, { zone: "graveyard" });
            const p1 = makePlayer("p1", { graveyard: [fb, bear] });
            expect(findFlashbackCastable(p1, fb.id)?.id).toBe(fb.id);
            // A graveyard card without flashback is not castable from there.
            expect(findFlashbackCastable(p1, bear.id)).toBeUndefined();
        });
    });

    describe("cast affordance from the graveyard (getLegalActions)", () => {
        function stateWithGraveyardFirebolt(
            manaPool: Record<string, number>,
            phase: GameState["phase"] = "PRECOMBAT_MAIN"
        ): { state: GameState; fireboltId: string } {
            const fb = makeInstance(firebolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", {
                graveyard: [fb],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...manaPool },
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                phase,
            });
            return { state, fireboltId: fb.id };
        }

        it('offers "cast" for an affordable flashback card at sorcery timing', () => {
            const { state, fireboltId } = stateWithGraveyardFirebolt({ R: 5 });
            const card = getPlayer(state, "p1").graveyard.find(
                (c) => c.id === fireboltId
            )!;
            expect(
                getLegalActions(state, getPlayer(state, "p1"), card)
            ).toEqual(["cast"]);
        });

        it("does NOT offer cast when the flashback cost is unaffordable", () => {
            const { state, fireboltId } = stateWithGraveyardFirebolt({ R: 1 });
            const card = getPlayer(state, "p1").graveyard.find(
                (c) => c.id === fireboltId
            )!;
            expect(
                getLegalActions(state, getPlayer(state, "p1"), card)
            ).toEqual([]);
        });

        it("does NOT offer cast for a sorcery outside sorcery timing", () => {
            // Firebolt is a sorcery: not castable while the stack is non-empty.
            const { state, fireboltId } = stateWithGraveyardFirebolt({ R: 5 });
            state.stack.push(
                makeInstance(grizzlyBears.id, { zone: "stack" }) as StackItem
            );
            const card = getPlayer(state, "p1").graveyard.find(
                (c) => c.id === fireboltId
            )!;
            expect(
                getLegalActions(state, getPlayer(state, "p1"), card)
            ).toEqual([]);
        });

        it("a plain (non-flashback) graveyard card is never castable", () => {
            const bear = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", {
                graveyard: [bear],
                manaPool: { W: 0, U: 0, B: 0, R: 9, G: 0, C: 0 },
            });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            expect(getLegalActions(state, p1, bear)).toEqual([]);
        });
    });

    describe("flashback cast + exile-on-resolve (the real cast seam)", () => {
        it("casts Firebolt from the graveyard, deals damage, and exiles it (not graveyard)", () => {
            const fb = makeInstance(firebolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [fb] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            // Drive the REAL cast-source resolution announceCast uses.
            const src = locateCastSource(getPlayer(state, "p1"), fb.id);
            expect(src.zone).toBe("graveyard");
            expect(src.card?.id).toBe(fb.id);
            // CR 702.34a — the cost paid is the flashback cost, not the printed {R}.
            expect(castRawManaCost(src.card!, src.zone)).toEqual({
                X: 4,
                R: 1,
            });

            // Commit: move graveyard → stack with the flashback flags, then resolve.
            const removed = removeFromZone(
                getPlayer(state, "p1"),
                fb.id,
                src.zone
            );
            const stackItem: StackItem = {
                ...removed,
                castById: "p1",
                targets: [{ type: "player", id: "p2" }],
                ...flashbackStackFlags(src.zone),
            };
            expect(stackItem.exileOnResolve).toBe(true);
            expect(stackItem.castFromGraveyard).toBe(true);
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            // CR 115.4 — 2 damage to the targeted player.
            expect(getPlayer(state, "p2").life).toBe(18);
            // CR 702.34a — the flashback card is EXILED, never returned to the
            // graveyard.
            expect(
                getPlayer(state, "p1").exile.some((c) => c.id === fb.id)
            ).toBe(true);
            expect(
                getPlayer(state, "p1").graveyard.some((c) => c.id === fb.id)
            ).toBe(false);
        });
    });

    describe("until-end-of-turn grant expiry (CR 514.2)", () => {
        it("clears a granted flashback on a graveyard card at cleanup", () => {
            const granted = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
                grantedFlashback: { X: 1, U: 1 },
            });
            const p1 = makePlayer("p1", { graveyard: [granted] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                phase: "CLEANUP",
            });
            finalizeCleanup(state);
            expect(
                getPlayer(state, "p1").graveyard[0].grantedFlashback
            ).toBeUndefined();
        });
    });

    describe("serialization round-trip (grantedFlashback + castFromGraveyard)", () => {
        it("preserves the granted-flashback field on a graveyard card", () => {
            const granted = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
                grantedFlashback: { X: 2, R: 1 },
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [granted] }),
                    makePlayer("p2"),
                ],
            });
            const round = expandState(compactState(state));
            expect(
                getPlayer(round, "p1").graveyard[0].grantedFlashback
            ).toEqual({ X: 2, R: 1 });
        });

        it("preserves castFromGraveyard on a stack item", () => {
            const item: StackItem = {
                ...makeInstance(firebolt.id, {
                    zone: "stack",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                castById: "p1",
                exileOnResolve: true,
                castFromGraveyard: true,
            };
            const state = makeState({
                players: [makePlayer("p1"), makePlayer("p2")],
                stack: [item],
            });
            const round = expandState(compactState(state));
            expect(round.stack[0].castFromGraveyard).toBe(true);
            expect(round.stack[0].exileOnResolve).toBe(true);
        });
    });

    describe("frontend wiring — projectPublicState tags the affordance", () => {
        it("attaches legalActions to the viewer's OWN graveyard flashback card, not the opponent's", () => {
            const mine = makeInstance(faithlessLooting.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const theirs = makeInstance(firebolt.id, {
                zone: "graveyard",
                controllerId: "p2",
                ownerId: "p2",
            });
            const plainMine = makeInstance(grizzlyBears.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [mine, plainMine],
                        // Ample pool so the flashback cast is affordable → "cast".
                        manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
                    }),
                    makePlayer("p2", { graveyard: [theirs] }),
                ],
            });

            const projected = projectPublicState(state, 1, "p1");
            const p1gy = projected.players[0].graveyard;
            const p2gy = projected.players[1].graveyard;

            // Own flashback card carries the cast affordance the UI reads.
            const projMine = p1gy.find((c) => c.id === mine.id)!;
            expect(projMine.legalActions).toEqual(["cast"]);
            // Own non-flashback card carries no affordance.
            const projPlain = p1gy.find((c) => c.id === plainMine.id)!;
            expect(projPlain.legalActions).toBeUndefined();
            // The opponent's graveyard flashback card is never castable by p1.
            const projTheirs = p2gy.find((c) => c.id === theirs.id)!;
            expect(projTheirs.legalActions).toBeUndefined();
        });
    });
});
