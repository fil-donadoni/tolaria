// Static graveyard-permanent-cast permission (CR 702.139, issue #1392 —
// Lurrus of the Dream-Den). Covers the whole GRE -> game.ts -> UI path the
// capability crosses:
//   - the permission lookup (convex/gre/rules.ts:
//     canCastPermanentFromGraveyardByPermission, markGraveyardPermanentCastUsed)
//   - the cast affordance gate (getLegalActions offers "cast" for an eligible
//     PERMANENT card in the controller's OWN graveyard while Lurrus (or any
//     `castsPermanentsFromGraveyard` grantor) is on the battlefield and the
//     once-per-turn use hasn't been spent — NOT otherwise)
//   - the real cast-commit seam (locateCastSource / castRawManaCost /
//     graveyardCastStackFlags exported from game.ts) — pays the card's
//     NORMAL printed mana cost, no exile-on-resolve, unlike Flashback/Escape
//   - the once-per-turn cap (debited at commit, cleared at CLEANUP — CR 514.2)
//   - the "ends the instant the source leaves the battlefield" behavior (no
//     stale flag — re-derived live every call, mirrors
//     `canPlayLandsFromGraveyard`/`canCastFromGraveyardByPermission`)
//   - serialization round-trip (already covered in serialize.test.ts)
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     eligible graveyard permanent with legalActions + castKind
//
// Distinct from `graveyardPlayPermission.test.ts` (the BROAD, turn-scoped,
// Op-granted Yawgmoth's Will shape, issue #1149): this permission is STATIC
// (battlefield-derived, no turn-scoped grant to set/clear), permanent-cards-
// only, mana-value-capped, and limited to once per turn.
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type StackItem,
} from "../state";
import { finalizeCleanup } from "../phases";
import {
    getLegalActions,
    assertLegalAction,
    canCastPermanentFromGraveyardByPermission,
    markGraveyardPermanentCastUsed,
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
import {
    lightningBolt,
    mountain,
    savannahLions,
    serraAngel,
} from "../../cards/sets/lea";
import { lurrus } from "../../cards/sets/iko/multicolor";

function withLurrusOnBattlefield(overrides: Parameters<typeof makePlayer>[1] = {}) {
    const onBattlefield = makeInstance(lurrus.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    return makePlayer("p1", {
        battlefield: [onBattlefield],
        ...overrides,
    });
}

describe("Static graveyard-permanent-cast permission (CR 702.139, issue #1392 — Lurrus)", () => {
    describe("permission lookup (convex/gre/rules.ts)", () => {
        it("is false with no castsPermanentsFromGraveyard grantor on the battlefield", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(false);
        });

        it("is true for a PERMANENT card at or under the grantor's maxManaValue while Lurrus is on the battlefield", () => {
            // Savannah Lions is MV 1.
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(true);
        });

        it("is false for a PERMANENT card above the grantor's maxManaValue", () => {
            // Serra Angel is well above mana value 2.
            const gyAngel = makeInstance(serraAngel.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyAngel] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyAngel
                )
            ).toBe(false);
        });

        it("is false for a LAND (never a castable permanent, CR 305.1)", () => {
            const gyMountain = makeInstance(mountain.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyMountain] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyMountain
                )
            ).toBe(false);
        });

        it("is false for a non-permanent (Instant/Sorcery, CR 300.1) even at mana value <= 2", () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyBolt
                )
            ).toBe(false);
        });

        it("is false once the once-per-turn use has already been spent", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
                graveyardPermanentCastUsedThisTurn: ["p1"],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(false);
        });

        it("the opponent's own use tracking doesn't block the other player", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
                graveyardPermanentCastUsedThisTurn: ["p2"],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(true);
        });

        it("ends the instant Lurrus leaves the battlefield — no stale flag", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            // Lurrus is NOT on the battlefield (e.g. it died/was bounced) —
            // re-derived live every call, so the permission is simply gone.
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyLions], battlefield: [] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(false);
        });
    });

    describe("markGraveyardPermanentCastUsed", () => {
        it("records the player id, idempotently", () => {
            const state = makeState();
            markGraveyardPermanentCastUsed(state, "p1");
            markGraveyardPermanentCastUsed(state, "p1");
            expect(state.graveyardPermanentCastUsedThisTurn).toEqual(["p1"]);
        });

        it("tracks multiple players independently", () => {
            const state = makeState();
            markGraveyardPermanentCastUsed(state, "p1");
            markGraveyardPermanentCastUsed(state, "p2");
            expect(state.graveyardPermanentCastUsedThisTurn).toEqual([
                "p1",
                "p2",
            ]);
        });
    });

    describe("cast affordance (getLegalActions)", () => {
        it('an eligible PERMANENT in the OWN graveyard HAS the "cast" action while Lurrus is on the battlefield', () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({
                        graveyard: [gyLions],
                        manaPool: { W: 1 },
                    }),
                    makePlayer("p2"),
                ],
            });
            const p1 = getPlayer(state, "p1");
            expect(getLegalActions(state, p1, gyLions)).toContain("cast");
            expect(() =>
                assertLegalAction(state, p1, gyLions, "cast")
            ).not.toThrow();
        });

        it('does NOT offer "cast" without a grantor on the battlefield', () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), gyLions)
            ).not.toContain("cast");
        });

        it('does NOT offer "cast" for a permanent above mana value 2', () => {
            const gyAngel = makeInstance(serraAngel.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyAngel] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), gyAngel)
            ).not.toContain("cast");
        });

        it('does NOT offer "cast" for an instant even while Lurrus is on the battlefield', () => {
            const gyBolt = makeInstance(lightningBolt.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyBolt] }),
                    makePlayer("p2"),
                ],
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), gyBolt)
            ).not.toContain("cast");
        });
    });

    describe("cast-commit seam (game.ts) — pays the normal printed mana cost", () => {
        it("locateCastSource routes an eligible card to the graveyard zone with viaGraveyardPermanentPermission, at its printed cost", () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                "gy-lions"
            );
            expect(src.zone).toBe("graveyard");
            expect(src.card?.id).toBe("gy-lions");
            expect(src.viaGraveyardPermanentPermission).toBe(true);
            // Normal printed cost {W} — NOT an alternative/flashback cost.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                W: 1,
            });
        });

        it("graveyardCastStackFlags marks castFromGraveyard only — NOT exileOnResolve or escaped", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            const flags = graveyardCastStackFlags(state, gyLions, "graveyard");
            expect(flags.castFromGraveyard).toBe(true);
            expect(flags.exileOnResolve).toBeUndefined();
            expect(flags.escaped).toBeUndefined();
        });

        it("casts Savannah Lions from the graveyard via Lurrus's permission, resolves onto the battlefield, and debits the once-per-turn use", () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
            });
            const p1 = getPlayer(state, "p1");

            const src = locateCastSource(state, p1, "gy-lions");
            expect(src.viaGraveyardPermanentPermission).toBe(true);
            const removed = removeFromZone(p1, "gy-lions", src.zone);
            const stackItem: StackItem = {
                ...removed,
                castById: "p1",
                ...graveyardCastStackFlags(state, removed, src.zone),
            };
            // Real commit sites (tryAutoCommitPendingCast,
            // finalizeTargetSelection, announceCast) debit the once-per-turn
            // use exactly here, at commit.
            if (src.viaGraveyardPermanentPermission) {
                markGraveyardPermanentCastUsed(state, "p1");
            }
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            // Resolves as a permanent — lands on the battlefield, not the
            // graveyard (unlike a spell that simply resolves without a
            // lasting effect).
            expect(
                getPlayer(state, "p1").battlefield.some(
                    (c) => c.id === "gy-lions"
                )
            ).toBe(true);
            expect(state.graveyardPermanentCastUsedThisTurn).toEqual(["p1"]);

            // The once-per-turn cap now blocks a second eligible card this
            // turn, even with Lurrus (now on a fresh battlefield instance)
            // still present.
            const secondLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].graveyard.push(secondLions);
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    secondLions
                )
            ).toBe(false);
        });
    });

    describe("CLEANUP expiry (CR 514.2)", () => {
        it("clears graveyardPermanentCastUsedThisTurn unconditionally at CLEANUP", () => {
            const state = makeState({
                phase: "CLEANUP",
                graveyardPermanentCastUsedThisTurn: ["p1"],
            });
            finalizeCleanup(state);
            expect(state.graveyardPermanentCastUsedThisTurn).toBeUndefined();
        });

        it("the once-per-turn use is available again after CLEANUP resets it", () => {
            const gyLions = makeInstance(savannahLions.id, {
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({ graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
                phase: "CLEANUP",
                graveyardPermanentCastUsedThisTurn: ["p1"],
            });
            finalizeCleanup(state);
            expect(
                canCastPermanentFromGraveyardByPermission(
                    state,
                    getPlayer(state, "p1"),
                    gyLions
                )
            ).toBe(true);
        });
    });

    describe("frontend wiring — projectPublicState tags the affordance", () => {
        it('attaches legalActions + castKind: "graveyard-permanent-permission" to the viewer\'s OWN eligible graveyard permanent', () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({
                        graveyard: [gyLions],
                        manaPool: { W: 1 },
                    }),
                    makePlayer("p2"),
                ],
                priorityPlayerId: "p1",
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-lions"
            )!;
            expect(slim.legalActions).toBeDefined();
            expect(slim.castKind).toBe("graveyard-permanent-permission");
        });

        it("does NOT tag the OPPONENT's view of the same card", () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    withLurrusOnBattlefield({
                        graveyard: [gyLions],
                        manaPool: { W: 1 },
                    }),
                    makePlayer("p2"),
                ],
                priorityPlayerId: "p1",
            });
            const projected = projectPublicState(state, 1, "p2");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-lions"
            )!;
            expect(slim.legalActions).toBeUndefined();
            expect(slim.castKind).toBeUndefined();
        });

        it("does NOT tag the card at all without a grantor on the battlefield", () => {
            const gyLions = makeInstance(savannahLions.id, {
                id: "gy-lions",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [gyLions] }),
                    makePlayer("p2"),
                ],
                priorityPlayerId: "p1",
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "gy-lions"
            )!;
            expect(slim.castKind).toBeUndefined();
        });
    });
});
