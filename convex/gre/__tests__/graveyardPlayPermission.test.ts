// Graveyard-cast/land-play permission capability tests (CR 305.1-analog /
// 601, issue #1149 — the BROAD, turn-scoped shape that powers Yawgmoth's
// Will). Covers the whole GRE → game.ts path the capability crosses:
//   - the permission lookup (convex/gre/rules.ts: getGraveyardPlayPermission,
//     canPlayLandsFromGraveyard, canCastFromGraveyardByPermission)
//   - the cast/play affordance gate (getLegalActions offers "play" for a
//     graveyard LAND, "cast" for a graveyard SPELL, while the permission is
//     active and covers that zone — NOT otherwise)
//   - the real cast-commit seam (locateCastSource / castRawManaCost /
//     graveyardCastStackFlags exported from game.ts) — a permission cast pays
//     the card's NORMAL printed mana cost, no exile-on-resolve, unlike
//     Flashback/Escape
//   - the real play-commit seam (applyPlayLandFromGraveyard)
//   - CLEANUP expiry (CR 514.2)
//   - serialization round-trip (already covered in serialize.test.ts)
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     graveyard land/spell with legalActions + castKind
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type StackItem,
} from "../state";
import { finalizeCleanup } from "../phases";
import { applyPlayLandFromGraveyard } from "../playLand";
import {
    getLegalActions,
    assertLegalAction,
    canPlayLandsFromGraveyard,
    getGraveyardPlayPermission,
    canCastFromGraveyardByPermission,
} from "../rules";
import {
    locateCastSource,
    castRawManaCost,
    graveyardCastStackFlags,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { lightningBolt, mountain } from "../../cards/sets/lea";

describe("Graveyard-cast/land-play permission (CR 305.1-analog / 601, issue #1149)", () => {
    describe("permission lookup (convex/gre/rules.ts)", () => {
        it("getGraveyardPlayPermission is undefined with no grant", () => {
            const state = makeState();
            expect(getGraveyardPlayPermission(state, "p1")).toBeUndefined();
        });

        it("canPlayLandsFromGraveyard is true when the grant's zones include land", () => {
            const state = makeState({
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            expect(
                canPlayLandsFromGraveyard(state, getPlayer(state, "p1"))
            ).toBe(true);
            // The opponent's permission is unaffected.
            expect(
                canPlayLandsFromGraveyard(state, getPlayer(state, "p2"))
            ).toBe(false);
        });

        it("canPlayLandsFromGraveyard is false when the grant's zones exclude land", () => {
            const state = makeState({
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["spell"] },
                ],
            });
            expect(
                canPlayLandsFromGraveyard(state, getPlayer(state, "p1"))
            ).toBe(false);
        });

        it("canCastFromGraveyardByPermission respects the maxManaValue cap", () => {
            const cheapBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            }); // Lightning Bolt is MV 1.
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [cheapBolt] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["spell"], maxManaValue: 0 },
                ],
            });
            expect(
                canCastFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    cheapBolt
                )
            ).toBe(false);
        });

        it("canCastFromGraveyardByPermission is false for a LAND (lands go through the play branch)", () => {
            const gyMountain = makeInstance(mountain.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyMountain] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            expect(
                canCastFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyMountain
                )
            ).toBe(false);
        });
    });

    describe("land affordance (getLegalActions) — active", () => {
        // NOTE: getLegalActions's land branch is intentionally zone-agnostic
        // (mirrors the #1190 exile-land-play design, see
        // sets/eoe/__tests__/green.test.ts): the STRUCTURAL timing/land-drop
        // check doesn't know or care which zone the passed-in card instance
        // lives in. The permission gate lives at the two call sites that
        // decide WHICH zone's card is even allowed to ask the question:
        // `findPlayableGraveyardLand` (game.ts, mutation-level source
        // resolution — exercised indirectly via `canPlayLandsFromGraveyard`
        // above) and `projectGraveyardCard` (gameProjections.ts, wire-level
        // exposure — covered by the frontend-wiring describe block below).
        it('a LAND in the graveyard HAS the "play" action while the permission covers "land"', () => {
            const gyMountain = makeInstance(mountain.id, {
                id: "gy-mountain",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyMountain] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const p1 = getPlayer(state, "p1");
            expect(getLegalActions(state, p1, gyMountain)).toContain("play");
            expect(() =>
                assertLegalAction(state, p1, gyMountain, "play")
            ).not.toThrow();
        });
    });

    describe("spell affordance (getLegalActions) — active vs. inactive", () => {
        it('a NON-LAND card in the graveyard HAS the "cast" action while the permission covers "spell"', () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [gyBolt],
                        manaPool: { R: 1 },
                    }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const p1 = getPlayer(state, "p1");
            expect(getLegalActions(state, p1, gyBolt)).toContain("cast");
        });

        it('does NOT offer "cast" without the permission (a plain graveyard card is never castable)', () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), gyBolt)
            ).not.toContain("cast");
        });

        it('does NOT offer "cast" when the permission covers only "land"', () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land"] },
                ],
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), gyBolt)
            ).not.toContain("cast");
        });
    });

    describe("cast-commit seam (game.ts) — pays the normal printed mana cost", () => {
        it("locateCastSource routes a permission-covered card to the graveyard zone, at its printed cost", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                "gy-bolt"
            );
            expect(src.zone).toBe("graveyard");
            expect(src.card?.id).toBe("gy-bolt");
            // Normal printed cost {R} — NOT an alternative/flashback cost.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                R: 1,
            });
        });

        it("graveyardCastStackFlags marks castFromGraveyard only — NOT exileOnResolve or escaped", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const flags = graveyardCastStackFlags(state, gyBolt, "graveyard");
            expect(flags.castFromGraveyard).toBe(true);
            expect(flags.exileOnResolve).toBeUndefined();
            expect(flags.escaped).toBeUndefined();
        });

        it("casts Lightning Bolt from the graveyard, deals damage, and returns it to the graveyard (not exiled)", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyBolt] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });

            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                "gy-bolt"
            );
            const removed = removeFromZone(
                getPlayer(state, "p1"),
                "gy-bolt",
                src.zone
            );
            const stackItem: StackItem = {
                ...removed,
                castById: "p1",
                targets: [{ type: "player", id: "p2" }],
                ...graveyardCastStackFlags(state, removed, src.zone),
            };
            expect(stackItem.castFromGraveyard).toBe(true);
            expect(stackItem.exileOnResolve).toBeUndefined();
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            expect(getPlayer(state, "p2").life).toBe(17); // 20 - 3
            // Resolves like an ordinary spell — lands in the graveyard, never
            // exiled (unlike a Flashback cast).
            expect(
                getPlayer(state, "p1").graveyard.some((c) => c.id === "gy-bolt")
            ).toBe(true);
            expect(
                getPlayer(state, "p1").exile.some((c) => c.id === "gy-bolt")
            ).toBe(false);
        });
    });

    describe("play-commit seam (applyPlayLandFromGraveyard)", () => {
        it("moves the graveyard land to the battlefield and records the land drop (CR 305.2)", () => {
            const gyMountain = makeInstance(mountain.id, {
                id: "gy-mountain",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyMountain] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                activePlayerId: "p1",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            applyPlayLandFromGraveyard(state, p1, "gy-mountain");
            expect(p1.graveyard.map((c) => c.id)).toEqual([]);
            expect(p1.battlefield.map((c) => c.id)).toContain("gy-mountain");
            expect(p1.landsPlayedThisTurn).toBe(1);
        });

        // CR 400.7 — the card in the graveyard is a NEW object on re-entry. The
        // battlefield→graveyard departure deliberately PRESERVES `isTapped` (and
        // the rest of the transient block) as last-known information for death
        // triggers, so a land that died TAPPED carries `isTapped: true` in the
        // graveyard. Replaying it must not inherit that: every reanimation-style
        // entry funnels through `resetBattlefieldTransientState`, and the
        // play-a-land-from-graveyard seam has to do the same.
        it("re-enters UNTAPPED even when it died tapped (CR 400.7)", () => {
            const gyMountain = makeInstance(mountain.id, {
                id: "gy-mountain",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            // Last-known battlefield state preserved by the death move.
            gyMountain.isTapped = true;
            gyMountain.damageMarked = 3;
            gyMountain.hasAttackedThisTurn = true;
            const p1 = makePlayer("p1", { graveyard: [gyMountain] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                activePlayerId: "p1",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const played = applyPlayLandFromGraveyard(
                state,
                p1,
                "gy-mountain"
            )!;
            expect(played.isTapped).toBe(false);
            expect(played.damageMarked).toBeUndefined();
            expect(played.hasAttackedThisTurn).toBeUndefined();
        });
    });

    describe("CLEANUP expiry (CR 514.2)", () => {
        it("clears the permission unconditionally at CLEANUP", () => {
            const state = makeState({
                phase: "CLEANUP",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            finalizeCleanup(state);
            expect(state.graveyardPlayPermissionThisTurn).toBeUndefined();
        });

        it("no longer offers play/cast once the permission has expired", () => {
            const gyMountain = makeInstance(mountain.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyMountain, gyBolt] }),
                    makePlayer("p2"),
                ],
                phase: "CLEANUP",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            finalizeCleanup(state);
            const p1 = getPlayer(state, "p1");
            expect(getLegalActions(state, p1, gyMountain)).not.toContain(
                "play"
            );
            expect(getLegalActions(state, p1, gyBolt)).not.toContain("cast");
        });
    });

    describe("frontend wiring — projectPublicState tags the affordance", () => {
        it("attaches legalActions + castKind: graveyard-permission to the viewer's OWN non-land graveyard card", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyBolt] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                priorityPlayerId: "p1",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-bolt"
            )!;
            expect(slim.legalActions).toBeDefined();
            expect(slim.castKind).toBe("graveyard-permission");
        });

        it("does NOT tag the OPPONENT's view of the same card", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyBolt] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                priorityPlayerId: "p1",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const projected = projectPublicState(state, 1, "p2");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-bolt"
            )!;
            expect(slim.legalActions).toBeUndefined();
            expect(slim.castKind).toBeUndefined();
        });

        it("a LAND still gets legalActions with NO castKind (a play, not a keyword cast)", () => {
            const gyMountain = makeInstance(mountain.id, {
                id: "gy-mountain",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyMountain] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                priorityPlayerId: "p1",
                graveyardPlayPermissionThisTurn: [
                    { playerId: "p1", zones: ["land", "spell"] },
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-mountain"
            )!;
            expect(slim.legalActions).toBeDefined();
            expect(slim.castKind).toBeUndefined();
        });

        it("a LAND gets NO legalActions without the permission (the real gate — getLegalActions is zone-agnostic)", () => {
            const gyMountain = makeInstance(mountain.id, {
                id: "gy-mountain",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { graveyard: [gyMountain] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                priorityPlayerId: "p1",
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-mountain"
            )!;
            expect(slim.legalActions).toBeUndefined();
        });
    });
});
