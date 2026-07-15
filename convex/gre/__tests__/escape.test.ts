// Escape capability tests (CR 702.138). Built once here, reused by all four
// cube escape cards. Covers the whole GRE → game.ts → UI path the capability
// crosses:
//   - the escape cost lookup (printed + Underworld Breach's granted, convex/gre/escape.ts)
//   - the cast affordance gate (getLegalActions offers "cast" from the graveyard)
//   - the real cast-commit seam (locateCastSource / castRawManaCost /
//     graveyardCastStackFlags exported from game.ts, driven in announceCast's order)
//   - the escaped marker riding onto the resulting permanent (CR 702.138e) via
//     resolveTopOfStack, and NO exile-on-resolve (unlike Flashback)
//   - the "unless it escaped" DSL branch (the `escaped` EffectValue) through the
//     real ETB trigger path (Uro's sacrifice-unless-escaped)
//   - the variable "any number with N+ card types" exile cost (Nethergoyf)
//   - serialization round-trip of the escaped flag
//   - the frontend wiring SURFACE: projectPublicState tags the viewer's own
//     graveyard escape card with legalActions
import { describe, it, expect } from "vitest";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type GameState,
    type StackItem,
    type CardInstanceState,
    type PendingTarget,
} from "../state";
import {
    getEscapeCost,
    getEscapeManaCost,
    hasEscape,
    findEscapeCastable,
    countDistinctCardTypes,
    getEscapeExileSpec,
    getGrantedEscape,
} from "../escape";
import {
    locateCastSource,
    castRawManaCost,
    graveyardCastStackFlags,
    recordCastExileCostPick,
    finalizeTargetSelection,
} from "../../game";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { uroTitanOfNaturesWrath } from "../../cards/sets/thb/multicolor";
import { underworldBreach } from "../../cards/sets/thb/red";
import { phlageTitanOfFiresFury } from "../../cards/sets/mh3/multicolor";
import { nethergoyf } from "../../cards/sets/mh3/black";
import {
    grizzlyBears,
    mountain,
    ancestralRecall,
    disenchant,
    lightningBolt,
} from "../../cards/sets/lea";

/** Five filler cards to pay a "exile five other cards" escape cost. */
function fiveFiller(owner: string): CardInstanceState[] {
    return Array.from({ length: 5 }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `filler-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        })
    );
}

describe("Escape capability (CR 702.138)", () => {
    describe("escape cost lookup (convex/gre/escape.ts)", () => {
        it("reads the printed escape cost (Uro)", () => {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [uro] }),
                    makePlayer("p2"),
                ],
            });
            expect(getEscapeCost(state, uro)).toEqual({
                mana: { G: 2, U: 2 },
                exile: { count: 5 },
            });
            expect(getEscapeManaCost(state, uro)).toEqual({ G: 2, U: 2 });
            expect(hasEscape(state, uro)).toBe(true);
        });

        it("Nethergoyf's escape exile cost is the variable minCardTypes shape", () => {
            const goyf = makeInstance(nethergoyf.id, { zone: "graveyard" });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [goyf] }),
                    makePlayer("p2"),
                ],
            });
            expect(getEscapeExileSpec(state, goyf)).toEqual({
                minCardTypes: 4,
            });
        });

        it("reads Phlage's printed escape cost and finds it castable in the graveyard", () => {
            const phlage = makeInstance(phlageTitanOfFiresFury.id, {
                id: "phlage",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [phlage] }),
                    makePlayer("p2"),
                ],
            });
            expect(getEscapeCost(state, phlage)).toEqual({
                mana: { R: 2, W: 2 },
                exile: { count: 5 },
            });
            expect(
                findEscapeCastable(state, state.players[0], "phlage")?.id
            ).toBe("phlage");
        });

        it("a card with no escape has no escape cost", () => {
            const bear = makeInstance(grizzlyBears.id, { zone: "graveyard" });
            const state = makeState();
            expect(hasEscape(state, bear)).toBe(false);
            expect(getEscapeCost(state, bear)).toBeUndefined();
        });
    });

    describe("Underworld Breach grant (CR 702.138)", () => {
        it("grants escape to a nonland graveyard card (own mana cost + exile 3)", () => {
            const breach = makeInstance(underworldBreach.id, {
                id: "breach",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bolt = makeInstance(ancestralRecall.id, {
                id: "recall",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [breach],
                        graveyard: [bolt],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(getGrantedEscape(state, bolt)).toEqual({
                mana: { U: 1 },
                exile: { count: 3 },
            });
            expect(hasEscape(state, bolt)).toBe(true);
        });

        it("does NOT grant escape to a land, or without the enchantment", () => {
            const land = makeInstance(mountain.id, {
                id: "land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const bolt = makeInstance(ancestralRecall.id, {
                id: "recall2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [land, bolt] }),
                    makePlayer("p2"),
                ],
            });
            // No Underworld Breach on the battlefield yet.
            expect(hasEscape(state, bolt)).toBe(false);
            // Add it; the land still doesn't gain escape ("Each NONLAND card").
            const breach = makeInstance(underworldBreach.id, {
                id: "breach2",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(breach);
            expect(hasEscape(state, land)).toBe(false);
            expect(hasEscape(state, bolt)).toBe(true);
        });
    });

    describe("card-type counting (CR 702.138a — Nethergoyf)", () => {
        it("counts DISTINCT card types among a set of cards", () => {
            const cards = [
                makeInstance(grizzlyBears.id), // Creature
                makeInstance(mountain.id), // Land
                makeInstance(ancestralRecall.id), // Instant
                makeInstance(disenchant.id), // Instant (dup type)
            ];
            // Creature, Land, Instant → 3 distinct.
            expect(countDistinctCardTypes(cards)).toBe(3);
        });
    });

    describe("cast-commit seam (game.ts)", () => {
        it("locateCastSource routes an escape card to the graveyard zone", () => {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                id: "uro",
                zone: "graveyard",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [uro, ...fiveFiller("p1")] }),
                    makePlayer("p2"),
                ],
            });
            const src = locateCastSource(state, getPlayer(state, "p1"), "uro");
            expect(src.zone).toBe("graveyard");
            expect(src.card?.id).toBe("uro");
            // CR 702.138a — the cost paid is the escape mana, not the printed cost.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                G: 2,
                U: 2,
            });
        });

        it("graveyardCastStackFlags marks escaped, NOT exileOnResolve (unlike Flashback)", () => {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [uro] }),
                    makePlayer("p2"),
                ],
            });
            const flags = graveyardCastStackFlags(state, uro, "graveyard");
            expect(flags.escaped).toBe(true);
            expect(flags.castFromGraveyard).toBe(true);
            expect(flags.exileOnResolve).toBeUndefined();
        });

        it("a TARGETED escape cast opens the exile picker at finalizeTargetSelection (Underworld Breach + Lightning Bolt)", () => {
            // Regression: a Breach-granted TARGETED spell (Lightning Bolt) casts
            // from the graveyard via the targeted path, which must still demand
            // the "exile N other cards" escape cost — previously only the
            // no-target announce path set it.
            const breach = makeInstance(underworldBreach.id, {
                id: "breach",
                controllerId: "p1",
                ownerId: "p1",
            });
            const bolt = makeInstance(lightningBolt.id, {
                id: "bolt",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [breach],
                        graveyard: [bolt, ...fiveFiller("p1")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const pt: PendingTarget = {
                playerId: "p1",
                cardInstanceId: "bolt",
                targetType: "any",
                count: 1,
                selected: [{ type: "player", id: "p2" }],
            };
            state.pendingTarget = pt;
            finalizeTargetSelection(state, pt, "p1");
            // The cast parked on the escape exile picker (exile three others),
            // carrying the chosen target — NOT committed straight to the stack.
            expect(state.pendingCast?.exileFromGraveyardChoice).toEqual({
                count: 3,
                excludeInstanceId: "bolt",
            });
            expect(
                (state.pendingCast as Record<string, unknown>).targets
            ).toEqual([{ type: "player", id: "p2" }]);
            expect(state.stack.some((s) => s.id === "bolt")).toBe(false);
        });
    });

    describe("exile-cost picker (game.ts recordCastExileCostPick)", () => {
        function stateWithPendingExile(
            choice: NonNullable<
                GameState["pendingCast"]
            >["exileFromGraveyardChoice"]
        ): GameState {
            const goyf = makeInstance(nethergoyf.id, {
                id: "goyf",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const graveyard = [
                goyf,
                makeInstance(grizzlyBears.id, {
                    id: "c-creature",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
                makeInstance(mountain.id, {
                    id: "c-land",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
                makeInstance(ancestralRecall.id, {
                    id: "c-instant",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
                makeInstance(underworldBreach.id, {
                    id: "c-enchantment",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
            ];
            const state = makeState({
                players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
            });
            state.pendingCast = {
                playerId: "p1",
                cardInstanceId: "goyf",
                manaCost: {},
                tappedLandIds: [],
                exileFromGraveyardChoice: choice,
            };
            return state;
        }

        it("accepts any number of OTHER cards meeting the card-type threshold (Nethergoyf)", () => {
            const state = stateWithPendingExile({
                count: 1,
                minCardTypes: 4,
                excludeInstanceId: "goyf",
            });
            // Creature + Land + Instant + Enchantment = 4 distinct types.
            recordCastExileCostPick(state, "p1", [
                "c-creature",
                "c-land",
                "c-instant",
                "c-enchantment",
            ]);
            expect(
                state.pendingCast!.exileFromGraveyardChoice!.pickedCardIds
            ).toHaveLength(4);
        });

        it("rejects a pick short of the card-type threshold", () => {
            const state = stateWithPendingExile({
                count: 1,
                minCardTypes: 4,
                excludeInstanceId: "goyf",
            });
            // Creature + Land + Instant = only 3 distinct types.
            expect(() =>
                recordCastExileCostPick(state, "p1", [
                    "c-creature",
                    "c-land",
                    "c-instant",
                ])
            ).toThrow(/card types/);
        });

        it("rejects exiling the escaping card itself (CR 702.138a 'other cards')", () => {
            const state = stateWithPendingExile({
                count: 1,
                minCardTypes: 4,
                excludeInstanceId: "goyf",
            });
            expect(() =>
                recordCastExileCostPick(state, "p1", ["goyf"])
            ).toThrow();
        });
    });

    describe("escaped marker + resolution (CR 702.138e)", () => {
        function escapeCastUro(escaped: boolean): GameState {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                id: "uro",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [uro],
                        // Library to satisfy the value trigger's draw.
                        library: [
                            makeInstance(mountain.id, {
                                id: "lib1",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            const removed = removeFromZone(
                getPlayer(state, "p1"),
                "uro",
                "graveyard"
            );
            const stackItem: StackItem = {
                ...removed,
                castById: "p1",
                ...(escaped ? { escaped: true, castFromGraveyard: true } : {}),
            };
            state.stack.push(stackItem);
            resolveTopOfStack(state);
            // ADR 0058 — Uro's two distinct ETB triggers (value + sacrifice) now
            // raise a `trigger-order` choice at the cast-time flush. These unit
            // tests isolate a SINGLE trigger by re-collecting manually below, so
            // discard the cast's off-stack batch + ordering prompt for a clean
            // slate.
            state.pendingChoices = undefined;
            state.pendingTriggerBatch = undefined;
            return state;
        }

        it("an escape cast enters the permanent with escaped=true and does not exile it", () => {
            const state = escapeCastUro(true);
            const uro = state.players[0].battlefield.find(
                (c) => c.id === "uro"
            );
            expect(uro).toBeDefined();
            expect(uro!.escaped).toBe(true);
            expect(state.players[0].exile.some((c) => c.id === "uro")).toBe(
                false
            );
        });

        it("sacrifice-unless-escaped: an ESCAPED Uro survives its ETB", () => {
            const state = escapeCastUro(true);
            // Fire the ETB triggers and resolve them all.
            // Isolate the sacrifice-unless-escaped trigger (the value trigger's
            // optional land pick would suspend the resolution loop).
            const triggers = collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "uro",
                    controllerId: "p1",
                    cardId: uroTitanOfNaturesWrath.id,
                    types: ["Creature"],
                },
            ]).filter(
                (t) => t.triggeredAbilityId === "uro-sacrifice-unless-escaped"
            );
            state.stack.push(...triggers);
            let guard = 0;
            while (
                state.stack.length > 0 &&
                !state.pendingChoices?.length &&
                guard++ < 20
            ) {
                resolveTopOfStack(state);
            }
            expect(
                state.players[0].battlefield.some((c) => c.id === "uro")
            ).toBe(true);
        });

        it("sacrifice-unless-escaped: a NON-escaped Uro is sacrificed on ETB", () => {
            const state = escapeCastUro(false);
            // Isolate the sacrifice-unless-escaped trigger (the value trigger's
            // optional land pick would suspend the resolution loop).
            const triggers = collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "uro",
                    controllerId: "p1",
                    cardId: uroTitanOfNaturesWrath.id,
                    types: ["Creature"],
                },
            ]).filter(
                (t) => t.triggeredAbilityId === "uro-sacrifice-unless-escaped"
            );
            state.stack.push(...triggers);
            let guard = 0;
            while (
                state.stack.length > 0 &&
                !state.pendingChoices?.length &&
                guard++ < 20
            ) {
                resolveTopOfStack(state);
            }
            expect(
                state.players[0].battlefield.some((c) => c.id === "uro")
            ).toBe(false);
            expect(state.players[0].graveyard.some((c) => c.id === "uro")).toBe(
                true
            );
        });
    });

    describe("serialization (CR 702.138e)", () => {
        it("round-trips the escaped flag on a battlefield permanent", () => {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                id: "uro",
                controllerId: "p1",
                ownerId: "p1",
                escaped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [uro] }),
                    makePlayer("p2"),
                ],
            });
            const restored = expandState(compactState(state));
            const back = restored.players[0].battlefield.find(
                (c) => c.id === "uro"
            );
            expect(back?.escaped).toBe(true);
        });
    });

    describe("frontend wiring SURFACE (projectPublicState)", () => {
        it("tags the viewer's own escape-castable graveyard card with legalActions", () => {
            const uro = makeInstance(uroTitanOfNaturesWrath.id, {
                id: "uro",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { graveyard: [uro, ...fiveFiller("p1")] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].graveyard.find(
                (c) => c.id === "uro"
            );
            expect(slim?.legalActions).toBeDefined();
        });
    });
});
